import { ChannelType, Collection, MessageType, type Guild, type Message } from "discord.js";
import type { CommunityKudos, CommunityParticipationDay, CommunityPoint } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { createParticipationService } from "../src/services/participation.js";
import { createParticipationTracker, eligibleVoiceUsers } from "../src/services/participation-discord.js";
import { memberEligible, messageFingerprint, participationDay, participationRules, participationWeek, voiceSegments } from "../src/services/participation-rules.js";
import { commands } from "../src/commands/index.js";

const at = new Date("2026-10-01T16:00:00Z");
const rules = participationRules.parse({ textChannels: ["text"], voiceChannels: ["voice"], allText: false, allVoice: false });
const later = (minutes: number) => new Date(at.getTime() + minutes * 60_000);
function store() {
  const season = { id: "season", guildId: "guild", game: "DISCORD", status: "ACTIVE", audienceRoleId: null, channelId: "text", guild: { settings: { timezone: "America/Toronto" } } };
  const cfg = { seasonId: season.id, enabled: true, rules, revision: 1, season };
  const days: CommunityParticipationDay[] = [], points: CommunityPoint[] = [], claims: CommunityKudos[] = [];
  const deleted = new Set<string>();
  const keyMatch = (row: CommunityParticipationDay, key: { seasonId: string; userId: string; day: string }) => row.seasonId === key.seasonId && row.userId === key.userId && row.day === key.day;
  type Filter = { id?: string; seasonId?: string; userId?: string; actorId?: string; kind?: string; reference?: string | { startsWith: string }; createdAt?: { gte?: Date; lte?: Date; lt?: Date }; season?: { guildId: string; status: string } };
  const matching = (where: Filter) => points.filter(row => (!where.id || row.id === where.id) && (!where.seasonId || row.seasonId === where.seasonId) && (!where.userId || row.userId === where.userId) && (!where.actorId || row.actorId === where.actorId) && (!where.kind || row.kind === where.kind) &&
    (!where.reference || (typeof where.reference === "string" ? row.reference === where.reference : row.reference.startsWith(where.reference.startsWith))) &&
    (!where.createdAt?.gte || row.createdAt >= where.createdAt.gte) && (!where.createdAt?.lte || row.createdAt <= where.createdAt.lte) && (!where.createdAt?.lt || row.createdAt < where.createdAt.lt) && (!where.season || where.season.guildId === season.guildId && season.status === where.season.status));
  const tx = {
    $executeRaw: vi.fn(async () => 1),
    communitySeason: { findFirst: vi.fn(async ({ where }) => where.guildId === season.guildId && where.id === season.id && (!where.status || where.status === season.status) ? { ...season, participation: cfg } : null) },
    communityParticipationConfig: {
      findFirst: vi.fn(async ({ where }) => (!where.enabled || cfg.enabled) && season.status === "ACTIVE" && (!where.season.guildId || where.season.guildId === season.guildId) ? cfg : null),
      upsert: vi.fn(async ({ update }) => { cfg.enabled = update.enabled; cfg.rules = update.rules; cfg.revision++; return cfg; })
    },
    communityParticipationDay: {
      findUnique: vi.fn(async ({ where }) => days.find(row => keyMatch(row, where.seasonId_userId_day)) ?? null),
      findFirst: vi.fn(async ({ where }) => days.filter(row => row.userId === where.userId && row.seasonId === where.seasonId && row.lastMessageAt).sort((a, b) => b.lastMessageAt!.getTime() - a.lastMessageAt!.getTime())[0] ?? null),
      upsert: vi.fn(async ({ create }) => {
        let row = days.find(row => keyMatch(row, create));
        if (!row) { row = { ...create, id: `day-${days.length}`, messages: 0, reactions: 0, voiceMs: 0, voicePoints: 0, lastVoiceAt: null, lastMessageAt: null, messageHashes: [] }; days.push(row!); }
        return row!;
      }),
      update: vi.fn(async ({ where, data }) => {
        const row = days.find(row => row.id === where.id)!;
        if (data.messages) row.messages += data.messages.increment;
        if (data.reactions) row.reactions += data.reactions.increment;
        for (const key of ["voiceMs", "voicePoints", "lastVoiceAt", "lastMessageAt", "messageHashes"] as const) if (data[key] !== undefined) Object.assign(row, { [key]: data[key] });
        return row;
      })
    },
    communityPoint: {
      findUnique: vi.fn(async ({ where }) => matching(where.seasonId_reference)[0] ?? null),
      findFirst: vi.fn(async ({ where }: { where: Filter }) => matching(where)[0] ?? null),
      count: vi.fn(async ({ where }: { where: Filter }) => matching(where).length),
      findMany: vi.fn(async ({ where }: { where: Filter & { OR?: Filter[] } }) => where.OR ? points.filter(point => where.OR!.some(filter => matching({ ...filter, seasonId: where.seasonId!, kind: "AWARD" }).includes(point))) : points),
      create: vi.fn(async ({ data }) => { const row = { ...data, id: `point-${points.length}` } as CommunityPoint; points.push(row); return row; })
    },
    communityParticipationDeletion: {
      findUnique: vi.fn(async ({ where }) => deleted.has(where.seasonId_messageId.messageId) ? {} : null),
      upsert: vi.fn(async ({ create }) => { deleted.add(create.messageId); return create; })
    },
    communityKudos: {
      findUnique: vi.fn(async ({ where }) => { const key = where.seasonId_nominatorId_userId_week; return claims.find(row => row.seasonId === key.seasonId && row.nominatorId === key.nominatorId && row.userId === key.userId && row.week === key.week) ?? null; }),
      findFirst: vi.fn(async ({ where }) => claims.find(row => row.id === where.id && row.seasonId === where.seasonId) ?? null),
      count: vi.fn(async ({ where }) => claims.filter(row => row.seasonId === where.seasonId && row.nominatorId === where.nominatorId && row.week === where.week).length),
      create: vi.fn(async ({ data }) => { const row = { ...data, id: `claim-${claims.length}`, status: "PENDING", reviewedBy: null, reviewNote: null } as CommunityKudos; claims.push(row); return row; }),
      update: vi.fn(async ({ where, data }) => Object.assign(claims.find(row => row.id === where.id)!, data))
    }
  };
  let queue = Promise.resolve();
  const database = { ...tx, $transaction: <T>(work: (transaction: typeof tx) => Promise<T>) => { const result = queue.then(() => work(tx)); queue = result.then(() => undefined, () => undefined); return result; } };
  return { tx, database, service: createParticipationService(database as never), cfg, season, days, points, claims };
}
const input = (messageId: string, time = at, hash: string | null = "hash") => ({ userId: "member", messageId, channelId: "text", hash, contentAvailable: true, at: time, revision: 1 });
const reaction = (messageId: string, reactorId: string) => ({ userId: "member", messageId, reactorId, channelId: "text", at, revision: 1 });

describe("participation rules", () => {
  it("caps voice at four hours and uses the guild's local day and week", () => {
    expect(rules.voiceDailyMinutes).toBe(240);
    expect(rules.voiceBlockPoints).toBe(2);
    expect(participationRules.safeParse({ voiceBlockPoints: 0 }).success).toBe(false);
    expect(participationRules.safeParse({ voiceBlockPoints: 5 }).success).toBe(false);
    expect(participationRules.safeParse({ voiceDailyMinutes: 241 }).success).toBe(false);
    expect(participationDay(new Date("2026-10-02T02:00Z"), "America/Toronto")).toBe("2026-10-01");
    expect(participationWeek(at, "America/Toronto")).toBe("2026-09-28");
  });
  it("splits midnight correctly and rejects downtime or backwards intervals", () => {
    const segments = voiceSegments(new Date("2026-11-02T04:59:40Z"), new Date("2026-11-02T05:00:20Z"), "America/Toronto");
    expect(segments.map(row => [row.day, row.end.getTime() - row.start.getTime()])).toEqual([["2026-11-01", 20_000], ["2026-11-02", 20_000]]);
    expect(voiceSegments(at, later(2), "America/Toronto")).toEqual([]);
    expect(voiceSegments(later(1), at, "America/Toronto")).toEqual([]);
  });
  it("filters short, command, link-only and repeated-text variants without storing text", () => {
    for (const text of ["hi", "aaaaaaaaaaaaaaaa", "/help anything", "https://example.com/longpath", "<@123456789012345> 👍👍👍"]) expect(messageFingerprint(text)).toBeNull();
    expect(messageFingerprint("Thanks for helping me yesterday!")).toBe(messageFingerprint("THANKS   for helping me yesterday."));
    expect(messageFingerprint("A useful question about the guild")).toMatch(/^[a-f0-9]{64}$/);
  });
  it("requires established human members and access", () => {
    const member = { bot: false, createdAt: at.getTime() - 10 * 86400000, joinedAt: at.getTime() - 5 * 86400000, canView: true, audience: true };
    expect(memberEligible(member, rules, at)).toBe(true);
    for (const changes of [{ bot: true }, { joinedAt: null }, { createdAt: at.getTime() }, { joinedAt: at.getTime() }, { canView: false }, { audience: false }]) expect(memberEligible({ ...member, ...changes }, rules, at)).toBe(false);
  });
  it("excludes solo, AFK, deafened and ineligible users while allowing muted listeners", () => {
    const a = { id: "a", channelId: "voice", eligible: true, deaf: false };
    expect([...eligibleVoiceUsers([a], ["voice"], null)]).toEqual([]);
    expect([...eligibleVoiceUsers([a, { ...a, id: "b" }], ["voice"], null)]).toEqual(["a", "b"]);
    for (const change of [{ deaf: true }, { eligible: false }, { channelId: "other" }]) expect([...eligibleVoiceUsers([a, { ...a, id: "b", ...change }], ["voice"], null)]).toEqual([]);
    expect([...eligibleVoiceUsers([a, { ...a, id: "b" }], ["voice"], "voice")]).toEqual([]);
  });
  it("counts every voice channel except AFK when all voice channels are on", () => {
    const a = { id: "a", channelId: "temporary-group", eligible: true, deaf: false };
    expect([...eligibleVoiceUsers([a, { ...a, id: "b" }], null, null)]).toEqual(["a", "b"]);
    // Still two members in the same channel, and never the AFK channel.
    expect([...eligibleVoiceUsers([a, { ...a, id: "b", channelId: "elsewhere" }], null, null)]).toEqual([]);
    expect([...eligibleVoiceUsers([a, { ...a, id: "b" }], null, "temporary-group")]).toEqual([]);
    // Every text and voice channel counts unless an officer turns that off.
    expect(participationRules.parse({})).toMatchObject({ allText: true, allVoice: true });
  });
  it("counts a message in any text channel when all text channels are on, and only listed ones when off", async () => {
    const s = store();
    expect(await s.service.message("guild", "season", { ...input("listed-only"), channelId: "private" })).toBe(false);
    s.cfg.rules = participationRules.parse({});
    expect(await s.service.message("guild", "season", { ...input("anywhere"), channelId: "private" })).toBe(true);
  });
});

describe("persistent participation accounting", () => {
  it("limits messages across channels and midnight, and never rewards replayed IDs", async () => {
    const s = store();
    expect(await s.service.message("guild", "season", input("one"))).toBe(true);
    expect(await s.service.message("guild", "season", input("one", later(6), "other"))).toBe(false);
    expect(await s.service.message("guild", "season", input("two", later(4), "other"))).toBe(false);
    expect(await s.service.message("guild", "season", input("two", later(5)))).toBe(false);
    expect(await s.service.message("guild", "season", input("two", later(5), "other"))).toBe(true);
    const beforeMidnight = new Date("2026-10-02T03:59Z"), afterMidnight = new Date("2026-10-02T04:01Z");
    expect(await s.service.message("guild", "season", input("late", beforeMidnight, "late"))).toBe(true);
    expect(await s.service.message("guild", "season", input("early", afterMidnight, "early"))).toBe(false);
    expect(s.points.reduce((sum, row) => sum + row.amount, 0)).toBe(3);
  });
  it("keeps message caps after recreation and supports metadata-only counting", async () => {
    const s = store();
    for (let i = 0; i < 12; i++) await createParticipationService(s.database as never).message("guild", "season", { ...input(`m${i}`, later(i * 5), null), contentAvailable: false });
    expect(s.points).toHaveLength(10);
    expect(s.days[0]!.messages).toBe(10);
    expect(await s.service.message("guild", "season", input("short", later(100), null))).toBe(false);
  });
  it("ignores other guilds, disallowed channels, paused/ended seasons and stale settings", async () => {
    const s = store();
    expect(await s.service.message("other", "season", input("one"))).toBe(false);
    expect(await s.service.message("guild", "season", { ...input("one"), channelId: "private" })).toBe(false);
    expect(await s.service.message("guild", "season", { ...input("one"), revision: 2 })).toBe(false);
    s.cfg.enabled = false;
    expect(await s.service.message("guild", "season", input("one"))).toBe(false);
    s.cfg.enabled = true; s.season.status = "ENDED";
    expect(await s.service.message("guild", "season", input("one"))).toBe(false);
    expect(s.points).toHaveLength(0);
  });
  it("limits reactions per message, member pair and day; toggling never earns again", async () => {
    const s = store();
    expect(await s.service.reaction("guild", "season", reaction("m1", "member"))).toBe(false);
    expect(await s.service.reaction("guild", "season", reaction("m1", "a"))).toBe(true);
    expect(await s.service.reaction("guild", "season", reaction("m1", "a"))).toBe(false);
    expect(await s.service.reaction("guild", "season", reaction("m2", "a"))).toBe(true);
    expect(await s.service.reaction("guild", "season", reaction("m3", "a"))).toBe(false);
    for (const id of ["b", "c", "d"]) await s.service.reaction("guild", "season", reaction("m1", id));
    expect(s.points.filter(row => row.reference.startsWith("participation:reaction:m1:")).length).toBe(3);
    for (const id of ["e", "f", "g", "h", "i"]) await s.service.reaction("guild", "season", reaction(`m${id}`, id));
    expect(s.points).toHaveLength(6);
  });
  it("accumulates partial voice blocks, ignores overlap and caps at exactly 240 minutes / 32 points", async () => {
    const s = store();
    for (let i = 0; i < 241; i++) await s.service.voice("guild", "season", "member", later(i), later(i + 1), 1);
    expect(s.days[0]!.voiceMs).toBe(240 * 60_000);
    expect(s.days[0]!.voicePoints).toBe(32);
    expect(s.points.reduce((sum, row) => sum + row.amount, 0)).toBe(32);
    expect(await s.service.voice("guild", "season", "member", later(14), later(15), 1)).toBe(0);
    expect(await s.service.voice("guild", "season", "member", later(242), later(244), 1)).toBe(0);
  });
  it("awards 32 points over two hours at four points per block, including retries and restarts", async () => {
    const s = store();
    s.cfg.rules = participationRules.parse({ ...rules, voiceDailyMinutes: 120, voiceBlockPoints: 4 });
    for (let i = 0; i < 121; i++) {
      const service = createParticipationService(s.database as never);
      await Promise.all([1, 2].map(() => service.voice("guild", "season", "member", later(i), later(i + 1), 1)));
    }
    expect(s.days[0]!.voiceMs).toBe(120 * 60_000);
    expect(s.days[0]!.voicePoints).toBe(32);
    expect(s.points.map(row => row.amount)).toEqual(Array(8).fill(4));
  });
  it("changes the voice rate without repricing completed blocks or resetting consumed time", async () => {
    const s = store();
    for (let i = 0; i < 60; i++) await s.service.voice("guild", "season", "member", later(i), later(i + 1), 1);
    expect(s.days[0]!.voicePoints).toBe(8);
    s.cfg.rules = participationRules.parse({ ...rules, voiceDailyMinutes: 120, voiceBlockPoints: 4 });
    for (let i = 60; i < 121; i++) await s.service.voice("guild", "season", "member", later(i), later(i + 1), 1);
    expect(s.days[0]!.voiceMs).toBe(120 * 60_000);
    expect(s.days[0]!.voicePoints).toBe(24);
    expect(s.points.map(row => row.amount)).toEqual([2, 2, 2, 2, 4, 4, 4, 4]);
  });
  it("preserves points and stops earning when the new voice cap is already consumed", async () => {
    const s = store();
    for (let i = 0; i < 180; i++) await s.service.voice("guild", "season", "member", later(i), later(i + 1), 1);
    s.cfg.rules = participationRules.parse({ ...rules, voiceDailyMinutes: 120, voiceBlockPoints: 4 });
    expect(await s.service.voice("guild", "season", "member", later(180), later(181), 1)).toBe(0);
    expect(s.days[0]!.voiceMs).toBe(180 * 60_000);
    expect(s.days[0]!.voicePoints).toBe(24);
  });
  it("counts reactions in the full local day when handlers complete out of timestamp order", async () => {
    const s = store();
    expect(await s.service.reaction("guild", "season", { ...reaction("late", "a"), at: later(3) })).toBe(true);
    expect(await s.service.reaction("guild", "season", { ...reaction("middle", "a"), at: later(2) })).toBe(true);
    expect(await s.service.reaction("guild", "season", { ...reaction("early", "a"), at: later(1) })).toBe(false);
    expect(s.points).toHaveLength(2);
  });
  it("preserves fractional voice progress across restarts and resets on the local day", async () => {
    const s = store();
    for (let i = 0; i < 15; i++) await createParticipationService(s.database as never).voice("guild", "season", "member", later(i), later(i + 1), 1);
    expect(s.points.reduce((sum, row) => sum + row.amount, 0)).toBe(2);
    await s.service.voice("guild", "season", "member", new Date("2026-10-02T03:59:30Z"), new Date("2026-10-02T04:00:30Z"), 1);
    expect(s.days.map(row => [row.day, row.voiceMs])).toEqual([["2026-10-01", 930_000], ["2026-10-02", 30_000]]);
  });
  it("appends one correction, leaves consumed limits intact and blocks frozen-season changes", async () => {
    const s = store();
    await s.service.message("guild", "season", input("one"));
    const point = s.points[0]!;
    await s.service.reverse("guild", "season", point.id, "officer", "Spam", at);
    await s.service.reverse("guild", "season", point.id, "officer", "Spam", at);
    expect(s.points.map(row => row.amount)).toEqual([1, -1]);
    expect(s.days[0]!.messages).toBe(1);
    expect(await s.service.message("guild", "season", input("one", later(10), "other"))).toBe(false);
    s.season.status = "ENDED";
    await expect(s.service.reverse("guild", "season", point.id, "officer", "Spam")).rejects.toThrow(/introuvable/);
  });
  it("requires independent helper approval and enforces weekly nominations and awards", async () => {
    const s = store();
    await expect(s.service.nominate("guild", "season", "self", "self", "Helped", at)).rejects.toThrow();
    const claim = await s.service.nominate("guild", "season", "helper", "nominator", "Taught a dungeon", at);
    expect(await s.service.nominate("guild", "season", "helper", "nominator", "Again", at)).toBe(claim);
    for (const actor of ["helper", "nominator"]) await expect(s.service.review("guild", "season", claim.id, actor, true, "Verified", at)).rejects.toThrow(/officier/);
    await s.service.review("guild", "season", claim.id, "officer", true, "Verified", at);
    await s.service.review("guild", "season", claim.id, "officer", true, "Verified", at);
    for (const nominator of ["b", "c", "d"]) {
      const next = await s.service.nominate("guild", "season", "helper", nominator, "Helped", at);
      if (nominator === "d") await expect(s.service.review("guild", "season", next.id, "officer", true, "Verified", at)).rejects.toThrow(/45 points/);
      else await s.service.review("guild", "season", next.id, "officer", true, "Verified", at);
    }
    expect(s.points.reduce((sum, row) => sum + row.amount, 0)).toBe(45);
    await s.service.nominate("guild", "season", "other-1", "nominator", "Helped", at);
    await s.service.nominate("guild", "season", "other-2", "nominator", "Helped", at);
    await expect(s.service.nominate("guild", "season", "other-3", "nominator", "Helped", at)).rejects.toThrow(/trois/);
  });
  it("reverses deleted-message rewards once and prevents delayed rewards after deletion", async () => {
    const s = store();
    await s.service.message("guild", "season", input("one"));
    await s.service.reaction("guild", "season", reaction("one", "reactor"));
    await s.service.deleteMessage("guild", "season", "one", at);
    await s.service.deleteMessage("guild", "season", "one", at);
    expect(s.points.map(row => row.amount)).toEqual([1, 1, -1, -1]);
    expect(await s.service.reaction("guild", "season", reaction("one", "other"))).toBe(false);
    await s.service.deleteMessage("guild", "season", "late", at);
    expect(await s.service.message("guild", "season", input("late", later(10), "late"))).toBe(false);
    expect(s.days[0]!.messages).toBe(1);
  });
  it("reverses the new helper amount once without reopening the weekly allowance", async () => {
    const s = store();
    for (let i = 0; i < 3; i++) {
      const claim = await s.service.nominate("guild", "season", "helper", `nominator-${i}`, "Helped", at);
      await s.service.review("guild", "season", claim.id, "officer", true, "Verified", at);
    }
    const original = s.points[0]!;
    await s.service.reverse("guild", "season", original.id, "officer", "Correction", at);
    await s.service.reverse("guild", "season", original.id, "officer", "Correction", at);
    expect(s.points.map(row => row.amount)).toEqual([15, 15, 15, -15]);
    const extra = await s.service.nominate("guild", "season", "helper", "another", "Helped", at);
    await expect(s.service.review("guild", "season", extra.id, "officer", true, "Verified", at)).rejects.toThrow(/45 points/);
  });
  it("preserves the weekly helper cap when approvals complete out of timestamp order", async () => {
    const s = store();
    for (let i = 0; i < 4; i++) {
      const claim = await s.service.nominate("guild", "season", "helper", `nominator-${i}`, "Helped", at);
      const review = s.service.review("guild", "season", claim.id, "officer", true, "Verified", later(4 - i));
      if (i === 3) await expect(review).rejects.toThrow(/45 points/); else await review;
    }
    expect(s.points.reduce((sum, row) => sum + row.amount, 0)).toBe(45);
  });
  it("allows officers to reject pending nominations while earning is paused", async () => {
    const s = store();
    const claim = await s.service.nominate("guild", "season", "helper", "nominator", "Helped", at);
    s.cfg.enabled = false;
    await expect(s.service.review("guild", "season", claim.id, "officer", true, "Verified", at)).rejects.toThrow(/pause/);
    expect((await s.service.review("guild", "season", claim.id, "officer", false, "Not verified", at)).status).toBe("REJECTED");
    expect(s.points).toHaveLength(0);
  });
  it("registers a bounded French/English command without mandatory content access", () => {
    const command = commands.find(row => row.name === "participation")!;
    const data = command.toJSON() as { options: { name: string }[] };
    expect(data.options.map(option => option.name)).toEqual(["settings", "status", "nominate", "claims", "review", "history", "reverse"]);
    type Node = { name?: string; description?: string; description_localizations?: { fr?: string }; value?: string; options?: Node[]; choices?: Node[] };
    const size = (node: Node, french: boolean): number => (node.name?.length ?? 0) + (french ? node.description_localizations?.fr ?? node.description ?? "" : node.description ?? "").length + (typeof node.value === "string" ? node.value.length : 0) + [...(node.options ?? []), ...(node.choices ?? [])].reduce((sum, child) => sum + size(child, french), 0);
    expect(size(command.toJSON() as Node, false)).toBeLessThanOrEqual(4000);
    expect(size(command.toJSON() as Node, true)).toBeLessThanOrEqual(4000);
  });
});

describe("Discord voice checkpoints", () => {
  function guildFixture() {
    const channel = { id: "voice", type: ChannelType.GuildVoice, permissionsFor: () => ({ has: () => true }) };
    const member = (id: string, bot = false) => ({ id, user: { bot, createdTimestamp: at.getTime() - 100 * 86400000 }, joinedTimestamp: at.getTime() - 50 * 86400000, roles: { cache: new Collection() }, permissions: { has: () => false } });
    const guild = { id: "discord", available: true, afkChannelId: null, channels: { cache: new Collection([["voice", channel], ["text", { ...channel, id: "text" }]]) }, voiceStates: { cache: new Collection(["a", "b"].map(id => [id, { id, channelId: "voice", channel, deaf: false, member: member(id) }])) } };
    return guild;
  }
  it("does not read the database for empty or solo voice channels", async () => {
    const s = store(), guild = guildFixture(), tracker = createParticipationTracker(s.database as never, false);
    guild.voiceStates.cache.delete("b");
    await tracker.sampleVoice(guild as unknown as Guild, at);
    guild.voiceStates.cache.clear();
    await tracker.sampleVoice(guild as unknown as Guild, later(1));
    expect(s.tx.communityParticipationConfig.findFirst).not.toHaveBeenCalled();
  });
  it("credits the shared interval on departure and starts a fresh baseline on reconnect or a long pause", async () => {
    const s = store(), guild = guildFixture();
    const tracker = createParticipationTracker(s.database as never, false);
    await tracker.sampleVoice(guild as unknown as Guild, at);
    await tracker.sampleVoice(guild as unknown as Guild, later(1));
    guild.voiceStates.cache.delete("b");
    await tracker.sampleVoice(guild as unknown as Guild, later(1.5));
    await tracker.sampleVoice(guild as unknown as Guild, later(2));
    expect(s.days.map(row => row.voiceMs)).toEqual([90_000, 90_000]);
    tracker.reset();
    await tracker.sampleVoice(guild as unknown as Guild, later(60));
    expect(s.days.map(row => row.voiceMs)).toEqual([90_000, 90_000]);
  });
  it("ignores bot, webhook and system messages before database access", async () => {
    const s = store(), tracker = createParticipationTracker(s.database as never, false);
    for (const changes of [{ author: { bot: true } }, { webhookId: "hook" }, { type: MessageType.UserJoin }]) await tracker.message({ guild: {}, author: { bot: false }, webhookId: null, type: MessageType.Default, inGuild: () => true, createdTimestamp: Date.now(), ...changes } as unknown as Message);
    expect(s.tx.communityParticipationConfig.findFirst).not.toHaveBeenCalled();
  });
  it("drops intervals across a long pause or a settings revision", async () => {
    const s = store(), guild = guildFixture(), tracker = createParticipationTracker(s.database as never, false);
    await tracker.sampleVoice(guild as unknown as Guild, at);
    await tracker.sampleVoice(guild as unknown as Guild, later(10));
    expect(s.days).toHaveLength(0);
    s.cfg.revision++;
    await tracker.sampleVoice(guild as unknown as Guild, later(11));
    expect(s.days).toHaveLength(0);
    await tracker.sampleVoice(guild as unknown as Guild, later(12));
    expect(s.days.map(row => row.voiceMs)).toEqual([60_000, 60_000]);
  });
});
