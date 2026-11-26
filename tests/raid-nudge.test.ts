import { describe, expect, it, vi } from "vitest";
import { deliverRaidNudge, isNudgeDue, nudgeMessage, nudgeTargets, runRaidNudges } from "../src/services/raid-nudge.js";

const HOUR = 3_600_000;
const now = new Date("2026-12-08T20:00:00Z");
const at = (hours: number) => new Date(now.getTime() + hours * HOUR);
const MAYBE = "111111111111111111", SILENT = "222222222222222222", DECLINED = "333333333333333333", GONE = "444444444444444444";

const seat = (memberId: string, discordUserId: string, status = "ACTIVE") => ({ memberId, member: { discordUserId, status } });
const signup = (memberId: string, status: string, discordUserId: string) => ({ memberId, status, member: { discordUserId } });

describe("day-before raid message", () => {
  const due = { now, scheduledAt: at(20), createdAt: at(-48), signupsCloseAt: null, sentAt: null };

  it("is due once, from a day to three hours before, and not for a raid just posted or with closed signups", () => {
    expect(isNudgeDue(due)).toBe(true);
    expect(isNudgeDue({ ...due, sentAt: at(-1) })).toBe(false);
    expect(isNudgeDue({ ...due, scheduledAt: at(25) })).toBe(false);
    expect(isNudgeDue({ ...due, scheduledAt: at(2) })).toBe(false);
    expect(isNudgeDue({ ...due, createdAt: at(-1) })).toBe(false);
    expect(isNudgeDue({ ...due, signupsCloseAt: at(-1) })).toBe(false);
  });

  it("mentions unanswered core members and Maybe answers only", () => {
    const targets = nudgeTargets(
      [signup("m", "MAYBE", MAYBE), signup("d", "DECLINED", DECLINED)],
      [seat("m", MAYBE), seat("d", DECLINED), seat("s", SILENT), seat("g", GONE, "LEFT"), seat("p", "addon:somebody")]
    );
    expect(targets).toEqual({ unanswered: [SILENT], maybe: [MAYBE] });
  });

  it("stays under Discord's message limit and allows only the mentions it shows", () => {
    const ids = Array.from({ length: 100 }, (_, index) => String(100000000000000000n + BigInt(index)));
    const message = nudgeMessage("fr", { title: "x".repeat(100), scheduledAt: at(20), unanswered: ids, maybe: [MAYBE], postUrl: "https://discord.com/channels/1/2/3" });
    expect(message.content.length).toBeLessThanOrEqual(2000);
    expect(message.users.every((id) => message.content.includes(`<@${id}>`))).toBe(true);
    expect(message.content).toContain("Réponds sur le message d'inscription");
  });

  const raid = (overrides: Record<string, unknown> = {}) => ({
    id: "r1", guildId: "guild", title: "Molten Core", status: "PLANNED", scheduledAt: at(20), createdAt: at(-48), signupsCloseAt: null, nudgeSentAt: null,
    signupChannelId: "chan", signupMessageId: "post",
    guild: { discordId: "g", settings: { raidNudge: true, raidSignupChannelId: null, language: "en" } },
    signups: [signup("m", "MAYBE", MAYBE)], core: { members: [seat("s", SILENT)] }, ...overrides
  });

  it("sends one message with the post link, then marks the raid", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const channel = { isTextBased: () => true, send, messages: { fetch: vi.fn().mockResolvedValue([]) } };
    const guild = { id: "g", client: { user: { id: "bot" } }, channels: { fetch: vi.fn().mockResolvedValue(channel) } };
    const update = vi.fn().mockResolvedValue({});
    const database = { raid: { findFirst: vi.fn().mockResolvedValue(raid()), update } };
    const job = { id: "job1", guildId: "guild", payload: { raidId: "r1", scheduledAt: at(20).toISOString() } };
    await deliverRaidNudge(guild as never, database as never, job as never, now);
    expect(send.mock.calls[0]?.[0].content).toContain("https://discord.com/channels/g/chan/post");
    expect(send.mock.calls[0]?.[0].allowedMentions).toEqual({ parse: [], users: [SILENT, MAYBE] });
    expect(update).toHaveBeenCalledWith({ where: { id: "r1" }, data: { nudgeSentAt: now } });
  });

  it("says nothing when officers turned it off or the raid moved", async () => {
    const guild = { id: "g", client: { user: { id: "bot" } }, channels: { fetch: vi.fn() } };
    const job = { id: "job1", guildId: "guild", payload: { raidId: "r1", scheduledAt: at(20).toISOString() } };
    for (const row of [raid({ guild: { discordId: "g", settings: { raidNudge: false } } }), raid({ scheduledAt: at(22) })]) {
      await deliverRaidNudge(guild as never, { raid: { findFirst: vi.fn().mockResolvedValue(row) } } as never, job as never, now);
    }
    expect(guild.channels.fetch).not.toHaveBeenCalled();
  });

  it("closes the window quietly when there is nobody to chase", async () => {
    const update = vi.fn().mockResolvedValue({});
    const database = { raid: { findMany: vi.fn().mockResolvedValue([raid({ signups: [], core: null })]), update }, discordJob: { upsert: vi.fn() } };
    expect(await runRaidNudges({} as never, database as never, now)).toBe(0);
    expect(database.discordJob.upsert).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith({ where: { id: "r1" }, data: { nudgeSentAt: now } });
  });
});
