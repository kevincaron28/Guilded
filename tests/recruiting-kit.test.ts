import { describe, expect, it, vi } from "vitest";
import {
  cooldownState, ensureInviteGuide, guideText, markRecruitPosted, parseInviteAnswers, parseQuestions, questionsBlock, sendRecruitReminders, storedQuestions, updateRecruit
} from "../src/services/recruiting-kit.js";
import { formatInviteList, recordInviteRequest } from "../src/services/invite-queue.js";

const HOUR = 3_600_000;

describe("interview questions and answers", () => {
  it("splits questions on | or lines, trims, and keeps five", () => {
    expect(parseQuestions(" Class? | Raid nights?\nWhy us? ||")).toEqual(["Class?", "Raid nights?", "Why us?"]);
    expect(parseQuestions("1|2|3|4|5|6|7")).toHaveLength(5);
    expect(parseQuestions("x".repeat(400))[0]).toHaveLength(150);
    expect(parseQuestions("")).toEqual([]);
    expect(storedQuestions(["A?", 3, " ", "B?"])).toEqual(["A?", "B?"]);
    expect(storedQuestions("nope")).toEqual([]);
  });
  it("takes the lines under the name as the answers", () => {
    expect(parseInviteAnswers("Amy Archer\n1. Mage\n2. Tuesdays\n")).toBe("1. Mage\n2. Tuesdays");
    expect(parseInviteAnswers("Amy Archer")).toBeNull();
    expect(parseInviteAnswers("\n\nAmy Archer\n\nMage")).toBe("Mage");
    expect(parseInviteAnswers("Amy Archer\n" + "y".repeat(3000))!.length).toBe(1000);
  });
  it("shows the questions in the DM block and the pinned guide, in both languages", () => {
    expect(questionsBlock("en", ["Class?"])).toBe("Under your name, answer these questions (one answer per line):\n1. Class?");
    expect(questionsBlock("fr", [])).toBe("");
    expect(guideText("fr", ["Classe ?"])).toContain("1. Classe ?");
    expect(guideText("en", [])).not.toContain("1.");
  });
  it("keeps the answers on the record and out of nothing but the officer view", async () => {
    const created: Record<string, unknown>[] = [];
    const database = { inviteRequest: { upsert: vi.fn(async ({ create }: { create: Record<string, unknown> }) => { created.push(create); return create; }) } };
    await recordInviteRequest(database as never, { guildId: "g", parsed: { displayName: "Amy Archer", nameKey: "amy archer" }, discordUserId: "u", channelId: "c", messageId: "m", answers: "Mage" });
    expect(created[0]).toMatchObject({ answers: "Mage", source: "discord" });
    const text = formatInviteList([{ displayName: "Amy Archer", discordUserId: "u", createdAt: new Date(), channelId: "c", messageId: "m", note: "good raider", answers: "Mage\nTuesdays", source: "website" }], "guild");
    expect(text).toContain("📝 good raider"); expect(text).toContain("💬 Mage Tuesdays"); expect(text).toContain("(website)");
  });
});

describe("recruit stages and notes", () => {
  it("updates every post of a name, trims the note, and clears it with null", async () => {
    const updateMany = vi.fn(async () => ({ count: 2 }));
    expect(await updateRecruit({ inviteRequest: { updateMany } } as never, "g", "AMY  Archer", { stage: "JOINED", note: "x".repeat(900) })).toBe(2);
    const call = (updateMany.mock.calls as unknown as [{ where: unknown; data: { status: string; note: string } }][])[0]![0];
    expect(call.where).toEqual({ guildId: "g", nameKey: "amy archer" });
    expect(call.data.status).toBe("JOINED"); expect(call.data.note).toHaveLength(500);
    await updateRecruit({ inviteRequest: { updateMany } } as never, "g", "Amy Archer", { note: null });
    expect((updateMany.mock.calls as unknown as [{ data: Record<string, unknown> }][])[1]![0].data).toEqual({ note: null });
    expect(await updateRecruit({ inviteRequest: { updateMany } } as never, "g", "Amy Archer", {})).toBe(0);
  });
});

describe("the shared recruiting cooldown", () => {
  const settings = (hoursAgo: number | null, hours = 72) => ({ recruitLastPostAt: hoursAgo === null ? null : new Date(Date.now() - hoursAgo * HOUR), recruitLastPostBy: "officer-1", recruitCooldownHours: hours });
  it("cools for the configured hours after a post", () => {
    expect(cooldownState(settings(null)).cooling).toBe(false);
    expect(cooldownState(settings(10)).cooling).toBe(true);
    expect(cooldownState(settings(80)).cooling).toBe(false);
    expect(cooldownState(settings(10, 6)).cooling).toBe(false);
  });
  const store = (row: ReturnType<typeof settings> | null) => ({
    guildSettings: { findUnique: vi.fn(async () => row), upsert: vi.fn(async () => ({})) }
  });
  it("records a post, and refuses a second one inside the cooldown", async () => {
    const free = store(settings(100));
    expect((await markRecruitPosted(free as never, "g", "officer-2")).ok).toBe(true);
    expect(free.guildSettings.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: expect.objectContaining({ recruitLastPostBy: "officer-2", recruitRemindedAt: null }) }));
    const busy = store(settings(5));
    const result = await markRecruitPosted(busy as never, "g", "officer-2");
    expect(result.ok).toBe(false); expect(result.state.by).toBe("officer-1");
    expect(busy.guildSettings.upsert).not.toHaveBeenCalled();
  });
  const rows = (hoursAgo: number) => [{ guildId: "g", logChannelId: "log", language: "en", recruitLastPostBy: "o", recruitCooldownHours: 72, recruitLastPostAt: new Date(Date.now() - hoursAgo * HOUR), guild: { discordId: "d" } }];
  const client = () => { const send = vi.fn(async () => undefined); return { send, channels: { fetch: vi.fn(async () => ({ isTextBased: () => true, send })) } }; };
  it("reminds the officer log once when the cooldown is over, not before", async () => {
    const c = client(); const update = vi.fn(async () => ({}));
    const early = { guildSettings: { findMany: vi.fn(async () => rows(10)), update } };
    expect(await sendRecruitReminders(c as never, early as never)).toBe(0);
    const over = { guildSettings: { findMany: vi.fn(async () => rows(80)), update } };
    expect(await sendRecruitReminders(c as never, over as never)).toBe(1);
    expect(c.send).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining("cooldown is over") }));
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ data: { recruitRemindedAt: expect.any(Date) } }));
    expect(over.guildSettings.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ recruitRemindedAt: null }) }));
  });
});

describe("the pinned guide in the invite channel", () => {
  it("posts and pins it once, then edits it", async () => {
    const pin = vi.fn(async () => undefined); const posted = { id: "p1", pin };
    const send = vi.fn(async () => posted);
    const channel = { isTextBased: () => true, send, messages: { fetch: vi.fn(async () => null) } };
    const client = { channels: { fetch: vi.fn(async () => channel) } };
    const update = vi.fn(async () => ({}));
    const db = { guildSettings: { findUnique: vi.fn(async (): Promise<Record<string, unknown>> => ({ inviteChannelId: "c", inviteGuideMessageId: null, inviteQuestions: ["Class?"], language: "en" })), update } };
    expect(await ensureInviteGuide(client as never, db as never, "g")).toBe("p1");
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining("1. Class?") }));
    expect(pin).toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({ where: { guildId: "g" }, data: { inviteGuideMessageId: "p1" } });
    const edit = vi.fn(async () => undefined);
    channel.messages.fetch = vi.fn(async () => ({ id: "p1", editable: true, content: "old", edit }) as never);
    db.guildSettings.findUnique = vi.fn(async () => ({ inviteChannelId: "c", inviteGuideMessageId: "p1", inviteQuestions: [], language: "fr" }));
    expect(await ensureInviteGuide(client as never, db as never, "g")).toBe("p1");
    expect(edit).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining("Comment joindre") }));
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("does nothing without an invite channel", async () => {
    const db = { guildSettings: { findUnique: vi.fn(async () => ({ inviteChannelId: null })) } };
    expect(await ensureInviteGuide({ channels: { fetch: vi.fn() } } as never, db as never, "g")).toBeNull();
  });
});
