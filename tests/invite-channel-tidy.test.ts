import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { backupLine, CHANNEL_SWEEP_DELETE_PAUSE_MS, resetCleanupWarnings, runInviteChannelSweeps } from "../src/services/invite-cleanup.js";
import { handleInviteMessage, handleInviteNameButton, CONFIRM_NAME_PREFIX, FIX_NAME_PREFIX } from "../src/services/invite-channel.js";
import { handleRequesterLeft } from "../src/services/invite-expiry.js";

vi.mock("../src/permissions.js", () => ({ hasPermission: (member: { officer?: boolean }) => Boolean(member.officer) }));

const NOW = new Date("2026-11-20T12:00:00Z");
const ago = (ms: number) => NOW.getTime() - ms;
const MIN = 60_000, DAY = 86_400_000;

interface Msg { id: string; createdTimestamp: number; author: { id: string; username: string }; content: string; pinned?: boolean; components?: unknown[] }
function channelWith(list: Msg[], opts: { manage?: boolean } = {}) {
  const deleted: string[] = [];
  const bulk: string[][] = [];
  const live = new Map(list.map((m) => [m.id, m]));
  const message = (m: Msg) => ({ ...m, pinned: Boolean(m.pinned), delete: vi.fn(async () => { deleted.push(m.id); live.delete(m.id); }) });
  const channel = {
    id: "chan", guildId: "d1",
    isTextBased: () => true,
    permissionsFor: () => ({ has: () => opts.manage !== false }),
    messages: { fetch: vi.fn(async (arg: { limit: number; before?: string } | string) => {
      if (typeof arg === "string") { const found = live.get(arg); if (!found) throw new Error("Unknown Message"); return message(found); }
      const { before } = arg;
      const sorted = [...live.values()].sort((a, b) => b.createdTimestamp - a.createdTimestamp);
      const from = before ? sorted.findIndex((m) => m.id === before) + 1 : 0;
      const page = sorted.slice(from, from + 100).map(message);
      return { size: page.length, values: () => page, last: () => page[page.length - 1] };
    }) },
    bulkDelete: vi.fn(async (ids: string[]) => { bulk.push(ids); ids.forEach((id) => { deleted.push(id); live.delete(id); }); return { size: ids.length }; })
  };
  const guild = { id: "d1", client: { user: { id: "bot" } }, channels: { fetch: vi.fn(async () => channel) } };
  return { guild, channel, deleted, bulk };
}

function database(over: { sweepEnabled?: boolean; sweptAt?: Date | null; open?: string[]; channelId?: string; guideId?: string | null } = {}) {
  const state = { sweptAt: over.sweptAt === undefined ? new Date(NOW.getTime() - 2 * DAY) : over.sweptAt, channelId: over.channelId ?? "chan", guideId: over.guideId === undefined ? "guide" : over.guideId };
  const due = (w: { OR?: Array<{ inviteSweptAt?: null | { lte: Date } }> }) => !state.sweptAt || (w.OR ?? []).some((c) => c.inviteSweptAt && typeof c.inviteSweptAt === "object" && "lte" in c.inviteSweptAt && state.sweptAt! <= c.inviteSweptAt.lte);
  return {
    state,
    guildSettings: {
      findMany: vi.fn(async ({ where }: { where: { OR: Array<{ inviteSweptAt?: null | { lte: Date } }> } }) =>
        (over.sweepEnabled ?? true) && due(where) ? [{ guildId: "g1", inviteChannelId: state.channelId, inviteGuideMessageId: state.guideId, inviteSweptAt: state.sweptAt, guild: { discordId: "d1" } }] : []),
      count: vi.fn(async () => 1),
      updateMany: vi.fn(async ({ where, data }: { where: { OR?: Array<{ inviteSweptAt?: null | { lte: Date } }> }; data: { inviteSweptAt: Date | null } }) => {
        if (where.OR && !due(where as never)) return { count: 0 };
        state.sweptAt = data.inviteSweptAt; return { count: 1 };
      })
    },
    inviteRequest: { findMany: vi.fn(async () => (over.open ?? ["open1"]).map((id) => ({ messageId: id, notifyMessageId: `${id}-tag`, doneNoteMessageId: null }))) }
  };
}

const chat: Msg[] = [
  { id: "guide", createdTimestamp: ago(30 * DAY), author: { id: "bot", username: "Guilded" }, content: "Invite panel" },
  { id: "pin", createdTimestamp: ago(20 * DAY), author: { id: "o1", username: "Officer" }, content: "rules", pinned: true },
  { id: "open1", createdTimestamp: ago(3 * DAY), author: { id: "u1", username: "Amy" }, content: "Amy Archer" },
  { id: "open1-tag", createdTimestamp: ago(3 * DAY), author: { id: "bot", username: "Guilded" }, content: "invite Amy Archer" },
  { id: "fresh", createdTimestamp: ago(5 * MIN), author: { id: "u2", username: "Bob" }, content: "just typed" },
  { id: "closed1", createdTimestamp: ago(2 * DAY), author: { id: "u3", username: "Cat" }, content: "Cat Carter\nplease" },
  { id: "notice", createdTimestamp: ago(3 * DAY), author: { id: "bot", username: "Guilded" }, content: "old notice" },
  { id: "banter", createdTimestamp: ago(30 * MIN), author: { id: "o1", username: "Officer" }, content: "see you tonight" },
  { id: "ancient", createdTimestamp: ago(40 * DAY), author: { id: "u4", username: "Dee" }, content: "hello" }
];

describe("the hourly tidy of the invite channel", () => {
  it("removes everything older than 10 minutes except pinned messages, the panel and open requests, after saving a plain-text copy", async () => {
    const dir = await mkdtemp(join(tmpdir(), "invite-backup-"));
    const { guild, deleted, bulk } = channelWith(chat);
    const logs: string[] = [];
    const sleeps: number[] = [];
    const removed = await runInviteChannelSweeps({ guilds: { fetch: async () => guild } } as never, database() as never, { now: NOW, backupDir: dir, log: (l) => logs.push(l), sleep: async (ms) => { sleeps.push(ms); } });
    expect(removed).toBe(4);
    expect(deleted.sort()).toEqual(["ancient", "banter", "closed1", "notice"]);
    // Younger than 14 days: one bulk delete. Older: a single delete, paced at one a second.
    expect(bulk).toHaveLength(1);
    expect(bulk[0]!.sort()).toEqual(["banter", "closed1", "notice"]);
    expect(sleeps).toEqual([CHANNEL_SWEEP_DELETE_PAUSE_MS]);
    // The dry-run count is logged before anything is deleted.
    expect(logs[0]).toContain("(dry run)");
    expect(logs[0]).toContain("4 messages would be removed");
    expect(logs.findIndex((l) => l.includes("copy of"))).toBeGreaterThan(0);
    // The copy: author, time and text, one line each, oldest first.
    const files = await readdir(dir);
    expect(files).toHaveLength(1);
    const text = await readFile(join(dir, files[0]!), "utf8");
    expect(text.trim().split("\n")).toHaveLength(4);
    expect(text).toContain("Dee (u4): hello");
    expect(text).toContain("Cat (u3): Cat Carter ⏎ please");
    expect(text).toContain("[2026-11-20T11:30:00.000Z] Officer (o1): see you tonight");
    expect(text).not.toContain("Invite panel");
  });
  it("runs at most once an hour", async () => {
    const dir = await mkdtemp(join(tmpdir(), "invite-backup-"));
    const db = database();
    const a = channelWith(chat);
    await runInviteChannelSweeps({ guilds: { fetch: async () => a.guild } } as never, db as never, { now: NOW, backupDir: dir, log: () => undefined, sleep: async () => undefined });
    const b = channelWith(chat);
    expect(await runInviteChannelSweeps({ guilds: { fetch: async () => b.guild } } as never, db as never, { now: new Date(NOW.getTime() + 30 * MIN), backupDir: dir, log: () => undefined })).toBe(0);
    expect(b.deleted).toEqual([]);
    expect(await runInviteChannelSweeps({ guilds: { fetch: async () => b.guild } } as never, db as never, { now: new Date(NOW.getTime() + 61 * MIN), backupDir: dir, log: () => undefined, sleep: async () => undefined })).toBeGreaterThan(0);
  });
  it("does nothing when an officer switched it off", async () => {
    const { guild, deleted } = channelWith(chat);
    expect(await runInviteChannelSweeps({ guilds: { fetch: async () => guild } } as never, database({ sweepEnabled: false }) as never, { now: NOW, log: () => undefined })).toBe(0);
    expect(deleted).toEqual([]);
  });
  it("degrades quietly without Manage Messages: nothing is deleted and nothing is written", async () => {
    resetCleanupWarnings();
    const dir = await mkdtemp(join(tmpdir(), "invite-backup-"));
    const { guild, deleted } = channelWith(chat, { manage: false });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(await runInviteChannelSweeps({ guilds: { fetch: async () => guild } } as never, database() as never, { now: NOW, backupDir: dir, log: () => undefined })).toBe(0);
    expect(deleted).toEqual([]);
    expect(await readdir(dir)).toEqual([]);
    warn.mockRestore();
  });
  it("deletes nothing when the copy cannot be saved", async () => {
    resetCleanupWarnings();
    const dir = await mkdtemp(join(tmpdir(), "invite-backup-"));
    const blocker = join(dir, "not-a-folder");
    await writeFile(blocker, "x");
    const { guild, deleted } = channelWith(chat);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(await runInviteChannelSweeps({ guilds: { fetch: async () => guild } } as never, database() as never, { now: NOW, backupDir: blocker, log: () => undefined })).toBe(0);
    expect(deleted).toEqual([]);
    warn.mockRestore();
  });
  it("leaves a channel that holds only the panel, pins and open requests alone", async () => {
    const { guild, deleted } = channelWith(chat.filter((m) => ["guide", "pin", "open1", "open1-tag", "fresh"].includes(m.id)));
    expect(await runInviteChannelSweeps({ guilds: { fetch: async () => guild } } as never, database() as never, { now: NOW, log: () => undefined })).toBe(0);
    expect(deleted).toEqual([]);
  });
  it("the very first run on a server only counts and saves a copy: nothing is deleted until the next hourly run", async () => {
    const dir = await mkdtemp(join(tmpdir(), "invite-backup-"));
    const db = database({ sweptAt: null });
    const first = channelWith(chat);
    const logs: string[] = [];
    expect(await runInviteChannelSweeps({ guilds: { fetch: async () => first.guild } } as never, db as never, { now: NOW, backupDir: dir, log: (l) => logs.push(l), sleep: async () => undefined })).toBe(0);
    expect(first.deleted).toEqual([]);
    expect(first.bulk).toEqual([]);
    expect(await readdir(dir)).toHaveLength(1);
    expect(logs.some((l) => l.includes("first run, nothing deleted (4 counted and saved)"))).toBe(true);
    expect(logs.some((l) => l.includes(dir))).toBe(true);
    const second = channelWith(chat);
    expect(await runInviteChannelSweeps({ guilds: { fetch: async () => second.guild } } as never, db as never, { now: new Date(NOW.getTime() + 61 * MIN), backupDir: dir, log: () => undefined, sleep: async () => undefined })).toBe(5);
  });
  it("a first run that stops early or counts nothing stays a first run (the claim is reset)", async () => {
    resetCleanupWarnings();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    // Panel missing, no permission, nothing to remove, copy cannot be saved: each leaves inviteSweptAt empty.
    const cases: Array<{ name: string; db: ReturnType<typeof database>; ch: ReturnType<typeof channelWith>; dir?: string }> = [
      { name: "panel", db: database({ sweptAt: null, guideId: "gone" }), ch: channelWith(chat) },
      { name: "permission", db: database({ sweptAt: null }), ch: channelWith(chat, { manage: false }) },
      { name: "nothing", db: database({ sweptAt: null }), ch: channelWith(chat.filter((m) => ["guide", "pin", "open1", "open1-tag", "fresh"].includes(m.id))) }
    ];
    const dir = await mkdtemp(join(tmpdir(), "invite-backup-"));
    const blocker = join(dir, "not-a-folder");
    await writeFile(blocker, "x");
    cases.push({ name: "backup", db: database({ sweptAt: null }), ch: channelWith(chat), dir: blocker });
    for (const c of cases) {
      await runInviteChannelSweeps({ guilds: { fetch: async () => c.ch.guild } } as never, c.db as never, { now: NOW, backupDir: c.dir ?? dir, log: () => undefined });
      expect(c.db.state.sweptAt, c.name).toBeNull();
      expect(c.ch.deleted, c.name).toEqual([]);
    }
    warn.mockRestore();
  });
  it("logs every reason for skipping a server, once", async () => {
    resetCleanupWarnings();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const logs: string[] = [];
    const run = async (db: ReturnType<typeof database>, ch: ReturnType<typeof channelWith>) => runInviteChannelSweeps({ guilds: { fetch: async () => ch.guild } } as never, db as never, { now: NOW, log: (l) => logs.push(l) });
    await run(database({ guideId: null }), channelWith(chat));
    expect(logs.some((l) => l.includes("skipped") && l.includes("(none was ever posted)") && l.includes("/mod invites questions"))).toBe(true);
    await run(database({ guideId: null }), channelWith(chat));
    expect(logs.filter((l) => l.includes("(none was ever posted)"))).toHaveLength(1);
    const noPerm = channelWith(chat, { manage: false });
    await run(database(), noPerm);
    expect(logs.some((l) => l.includes("needs View Channel, Read Message History and Manage Messages"))).toBe(true);
    const wrong = channelWith(chat); wrong.channel.id = "other";
    await run(database(), wrong);
    expect(logs.some((l) => l.includes("not readable as the configured invite text channel"))).toBe(true);
    await run(database({ sweepEnabled: false }), channelWith(chat));
    expect(logs.some((l) => l.includes("no server is due (servers with an invite channel: 1;"))).toBe(true);
    const gone = database();
    await runInviteChannelSweeps({ guilds: { fetch: async () => { throw new Error("x"); } } } as never, gone as never, { now: NOW, log: (l) => logs.push(l) });
    expect(logs.some((l) => l.includes("the Discord server could not be fetched"))).toBe(true);
    warn.mockRestore();
  });
  it("posts the bot's own guide once when none is stored, and the next pass is a dry run again", async () => {
    resetCleanupWarnings();
    const noGuide = chat.filter((m) => m.id !== "guide");
    const { guild, channel, deleted } = channelWith(noGuide);
    const posted = { id: "newguide", pin: vi.fn(async () => undefined) };
    const send = vi.fn(async () => posted);
    const guildChannel = Object.assign(channel, { send, client: { user: { id: "bot" } } });
    const db = database({ guideId: null });
    const sent: string[] = [];
    (db.guildSettings as unknown as { findUnique: unknown; update: unknown }).findUnique = vi.fn(async () => ({ inviteChannelId: "chan", inviteGuideMessageId: null, inviteQuestions: [], language: "en" }));
    (db.guildSettings as unknown as { findUnique: unknown; update: unknown }).update = vi.fn(async ({ data }: { data: { inviteGuideMessageId: string } }) => { db.state.guideId = data.inviteGuideMessageId; return {}; });
    const logs: string[] = [];
    const client = { guilds: { fetch: async () => guild }, channels: { fetch: async () => guildChannel } };
    expect(await runInviteChannelSweeps(client as never, db as never, { now: NOW, log: (l) => { logs.push(l); sent.push(l); } })).toBe(0);
    expect(send).toHaveBeenCalledTimes(1);
    expect(posted.pin).toHaveBeenCalled();
    expect(logs.some((l) => l.includes("posted and pinned the guide newguide"))).toBe(true);
    expect(db.state.guideId).toBe("newguide");
    expect(db.state.sweptAt).toBeNull();
    expect(deleted).toEqual([]);
  });
  it("never runs on an empty invite channel id", async () => {
    const { guild, deleted } = channelWith(chat);
    expect(await runInviteChannelSweeps({ guilds: { fetch: async () => guild } } as never, database({ channelId: "" }) as never, { now: NOW, log: () => undefined })).toBe(0);
    expect(guild.channels.fetch).not.toHaveBeenCalled();
    expect(deleted).toEqual([]);
  });
  it("skips the whole run when the panel message cannot be found", async () => {
    resetCleanupWarnings();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    for (const guideId of [null, "gone"] as const) {
      const { guild, deleted } = channelWith(chat);
      expect(await runInviteChannelSweeps({ guilds: { fetch: async () => guild } } as never, database({ guideId }) as never, { now: NOW, log: () => undefined })).toBe(0);
      expect(deleted).toEqual([]);
    }
    warn.mockRestore();
  });
  it("skips a channel that is not the configured one", async () => {
    const { guild, channel, deleted } = channelWith(chat);
    channel.id = "other";
    expect(await runInviteChannelSweeps({ guilds: { fetch: async () => guild } } as never, database() as never, { now: NOW, log: () => undefined })).toBe(0);
    expect(deleted).toEqual([]);
  });
  it("never deletes the bot's own request panel (a bot message with the Request an invite button)", async () => {
    const withPanel: Msg[] = [...chat, { id: "panel2", createdTimestamp: ago(5 * DAY), author: { id: "bot", username: "Guilded" }, content: "Request an invite", components: [{ components: [{ customId: "invite:ask:d1" }] }] }];
    const { guild, deleted } = channelWith(withPanel);
    await runInviteChannelSweeps({ guilds: { fetch: async () => guild } } as never, database() as never, { now: NOW, backupDir: await mkdtemp(join(tmpdir(), "invite-backup-")), log: () => undefined, sleep: async () => undefined });
    expect(deleted).not.toContain("panel2");
    expect(deleted).toContain("notice");
  });
  it("writes author, time and text only (no attachments)", () => {
    expect(backupLine({ createdTimestamp: Date.UTC(2026, 10, 1, 8, 0, 0), content: "hi", author: { id: "7", username: "Zed" }, ...{ attachments: ["x.png"] } } as never)).toBe("[2026-11-01T08:00:00.000Z] Zed (7): hi");
  });
});

describe("closing a request frees its messages", () => {
  it("marks a closed request for the existing clean-up (due now, not yet cleaned)", async () => {
    const rows = [{ id: "a", guildId: "g1", discordUserId: "u1", status: "PENDING", cleanupAt: null as Date | null, cleanedAt: new Date() as Date | null, closeReason: null as string | null }];
    const db = {
      guildSettings: { findMany: async () => [{ guildId: "g1" }] },
      inviteRequest: { updateMany: async ({ data }: { data: Record<string, unknown> }) => { Object.assign(rows[0]!, data); return { count: 1 }; } }
    };
    await handleRequesterLeft(db as never, "d1", "u1");
    expect(rows[0]).toMatchObject({ status: "CLOSED", closeReason: "left_discord", cleanedAt: null });
    expect(rows[0]!.cleanupAt).toBeInstanceOf(Date);
  });
});

describe("a name inside a sentence in the channel", () => {
  const settings = { guildId: "g1", language: "en", inviteChannelId: "chan" };
  const db = () => ({
    guildSettings: { findFirst: vi.fn(async () => settings) },
    inviteRequest: { upsert: vi.fn(async ({ create }: { create: Record<string, unknown> }) => create) }
  });
  const post = (content: string, over: Record<string, unknown> = {}) => {
    const question = { delete: vi.fn(async () => undefined) };
    return { question, id: "m1", guildId: "guild", channelId: "chan", content, author: { id: "u1", bot: false }, member: { officer: false }, webhookId: null,
      reply: vi.fn(async (...args: unknown[]) => { void args; return question; }), react: vi.fn(async () => undefined), ...over };
  };
  it("asks Yes / No before recording, and records nothing yet", async () => {
    const message = post("hello i would like to join the guilde my name is blah blah");
    const database = db();
    expect(await handleInviteMessage(message as never, database as never)).toBe("asked");
    const sent = message.reply.mock.calls[0]![0] as { content: string; components: unknown[] };
    expect(sent.content).toBe("I'll invite **Blah Blah**, is that right?");
    expect(JSON.stringify(sent.components)).toContain(`${CONFIRM_NAME_PREFIX}m1`);
    expect(JSON.stringify(sent.components)).toContain(`${FIX_NAME_PREFIX}m1`);
    expect(database.inviteRequest.upsert).not.toHaveBeenCalled();
  });
  it("asks for the last name when only a first name is given, and for the full name when there is none", async () => {
    const first = post("salut je m'appelle Éloïse");
    expect(await handleInviteMessage(first as never, db() as never)).toBe("hinted");
    expect(first.reply.mock.calls[0]![0]).toMatchObject({ content: expect.stringContaining("Éloïse") });
    const none = post("can I join the guild please?");
    expect(await handleInviteMessage(none as never, db() as never)).toBe("hinted");
    expect(none.reply.mock.calls[0]![0]).toMatchObject({ content: expect.stringContaining("First Last") });
  });
  it("does not read officers' chat as a request", async () => {
    expect(await handleInviteMessage(post("my name is blah blah", { member: { officer: true } }) as never, db() as never)).toBe("ignored");
  });
  it("two filler words are not recorded as a name", async () => {
    expect(await handleInviteMessage(post("Thank you") as never, db() as never)).toBe("hinted");
  });

  const press = (customId: string, userId: string, typed: { delete: () => Promise<unknown> }) => {
    const calls: Array<{ kind: string; payload: { content?: string } }> = [];
    const botPost = { id: "bp1", delete: vi.fn(async () => undefined), react: vi.fn(async () => undefined) };
    const channel = { isTextBased: () => true, id: "chan", messages: { fetch: vi.fn(async () => typed) }, send: vi.fn(async () => botPost) };
    const interaction = {
      customId, user: { id: userId }, message: { delete: vi.fn(async () => undefined) },
      client: {
        channels: { fetch: vi.fn(async () => channel) },
        guilds: { fetch: vi.fn(async () => ({ members: { fetch: vi.fn(async () => ({ displayName: "Blah" })) } })) }
      },
      update: vi.fn(async (payload: { content?: string }) => { calls.push({ kind: "update", payload }); }),
      reply: vi.fn(async (payload: { content?: string }) => { calls.push({ kind: "reply", payload }); })
    };
    return { interaction, calls };
  };
  it("Yes records the request through the bot's own post and deletes the typed message; only the author can answer", async () => {
    const message = post("hey, I'm Drakka Whitefang and I'd love to join");
    const database = Object.assign(db(), {
      guildSettings: { findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => ("inviteChannelId" in where && typeof where["inviteChannelId"] === "object" ? { guildId: "g1", inviteChannelId: "chan", language: "en" } : settings)) },
      inviteRequest: { upsert: vi.fn(async ({ create }: { create: Record<string, unknown> }) => create), findFirst: vi.fn(async () => null) },
      member: { upsert: vi.fn(async () => ({})) }, character: { count: vi.fn(async () => 0) }
    });
    await handleInviteMessage(message as never, database as never);
    const typed = { delete: vi.fn(async () => undefined) };
    const stranger = press(`${CONFIRM_NAME_PREFIX}m1`, "someone-else", typed);
    await handleInviteNameButton(stranger.interaction as never, database as never);
    expect(stranger.calls[0]!.kind).toBe("reply");
    expect(typed.delete).not.toHaveBeenCalled();
    const author = press(`${CONFIRM_NAME_PREFIX}m1`, "u1", typed);
    await handleInviteNameButton(author.interaction as never, database as never);
    expect(typed.delete).toHaveBeenCalled();
    expect(author.calls[0]!.payload.content).toContain("Drakka Whitefang");
    expect(database.inviteRequest.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ displayName: "Drakka Whitefang", messageId: "bp1", discordUserId: "u1" }) }));
  });
  it("No, let me fix it asks for just the full name and removes the typed message", async () => {
    const message = post("mon nom est Jean Tremblay");
    await handleInviteMessage(message as never, db() as never);
    const typed = { delete: vi.fn(async () => undefined) };
    const { interaction, calls } = press(`${FIX_NAME_PREFIX}m1`, "u1", typed);
    await handleInviteNameButton(interaction as never, db() as never);
    expect(calls[0]!.payload.content).toContain("Type just your full character name");
    expect(typed.delete).toHaveBeenCalled();
  });
  it("an answer after a restart says the question expired", async () => {
    const { interaction, calls } = press(`${CONFIRM_NAME_PREFIX}unknown`, "u1", { delete: async () => undefined });
    await handleInviteNameButton(interaction as never, db() as never);
    expect(calls[0]!.payload.content).toContain("timed out");
  });
});
