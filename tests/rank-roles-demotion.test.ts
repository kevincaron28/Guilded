import { describe, expect, it, vi } from "vitest";
import { allCharactersLeft, bestRank, formatRankRolePreview, limitRemovals, MAX_REMOVALS_PER_RUN, PARTIAL_ROSTER_REASON, planRankRoles, previewRankRoles,
  rankRoleRemovalLine, syncRankRoles } from "../src/services/rank-roles.js";

// 21 Nov 2026 (owner): a demoted or departed officer loses only the officer role; two officer characters, or an officer alt
// with a member main, still count as officer; GM and co-GM above the mapped rank are never stripped. Shaped like Québec Gold:
// one mapping, rank 2 "Officer" → @Officier; ranks 0 Guild Master, 1 Co-GM, 3 Veteran, 4 Member.
const now = new Date("2026-11-21T12:00:00Z");
const today = new Date("2026-11-21T08:00:00Z");
const lastWeek = new Date("2026-11-15T12:00:00Z");
const stale = new Date("2026-10-20T12:00:00Z");
const QG = [{ rankIndex: 2, discordRoleId: "officier" }];
const RANKS = ["Guild Master", "Co-GM", "Officer", "Veteran", "Member"];

interface Char { name: string; rank: number | null; at?: Date | null; isMain?: boolean; wowId?: bigint | null }
interface Person { id: string; name?: string; roles?: string[]; chars: Char[] }

function world(people: Person[], opts: { links?: typeof QG; departures?: { nameKey: string; wowId?: bigint | null; observedAt: Date }[]; ranked?: Date[]; lang?: "en" | "fr"; logChannelId?: string | null } = {}) {
  const send = vi.fn(async () => undefined);
  const discord = new Map(people.map((p) => [p.id, {
    displayName: p.name ?? p.id,
    roles: { cache: new Map((p.roles ?? []).map((id) => [id, {}])), add: vi.fn(async () => undefined), remove: vi.fn(async () => undefined) }
  }]));
  const rows = people.map((p) => ({ discordUserId: p.id, characters: p.chars.map((c) => ({
    isMain: c.isMain ?? false, name: c.name, wowId: c.wowId ?? null, gameEdition: "forever",
    guildRankIndex: c.rank, guildRankName: c.rank === null ? null : RANKS[c.rank] ?? `Rank ${c.rank}`, guildRankAt: c.at === undefined ? today : c.at })) }));
  const prisma = {
    guild: { findUnique: vi.fn(async () => ({ id: "g1", settings: { rankRolesEnabled: true, language: opts.lang ?? "en", logChannelId: opts.logChannelId === undefined ? "log1" : opts.logChannelId } })) },
    guildRankRole: { findMany: vi.fn(async () => opts.links ?? QG) },
    member: { findMany: vi.fn(async () => rows) },
    // Default: a full officer roster today (every one of 20 ranked characters confirmed), so removals are allowed.
    character: { findMany: vi.fn(async () => (opts.ranked ?? Array.from({ length: 20 }, () => today)).map((guildRankAt) => ({ guildRankAt }))) },
    // inGuild:false = the departures; otherwise the rank names on the roster table.
    guildRosterEntry: { findMany: vi.fn(async (args: { where: { inGuild: boolean; rankIndex?: { in: number[] } } }) => args.where.inGuild === false
      ? (opts.departures ?? []).map((d) => ({ gameEdition: "forever", wowId: null, ...d }))
      : (args.where.rankIndex?.in ?? []).map((rankIndex) => ({ rankIndex, rankName: RANKS[rankIndex] ?? null }))) }
  };
  const guild = {
    id: "d1",
    roles: { cache: { get: (id: string) => ({ id, name: id, editable: true }) } },
    members: { cache: discord, fetch: vi.fn(async () => null) },
    channels: { fetch: vi.fn(async () => ({ isTextBased: () => true, send })) }
  };
  return { prisma, guild, discord, send };
}
const run = (w: ReturnType<typeof world>, dryRun = false) => syncRankRoles(w.prisma as never, w.guild as never, { now, dryRun });

describe("a member's rank for rank roles", () => {
  it("is the best fresh rank among all characters, with its name", () => {
    expect(bestRank([{ isMain: true, guildRankIndex: 4, guildRankAt: today, guildRankName: "Member" }, { guildRankIndex: 2, guildRankAt: today, guildRankName: "Officer" }], now))
      .toEqual({ index: 2, name: "Officer" });
    // A stale officer alt does not count; a departed character does not count.
    expect(bestRank([{ isMain: true, guildRankIndex: 4, guildRankAt: today }, { guildRankIndex: 2, guildRankAt: stale }], now)?.index).toBe(4);
    expect(bestRank([{ isMain: true, guildRankIndex: 4, guildRankAt: today }, { guildRankIndex: 2, guildRankAt: today, left: true }], now)?.index).toBe(4);
    expect(bestRank([{ guildRankIndex: 2, guildRankAt: stale }], now)).toBeNull();
  });
  it("says 'left' only when every character left", () => {
    expect(allCharactersLeft([{ guildRankIndex: 2, guildRankAt: today, left: true }, { guildRankIndex: 4, guildRankAt: today, left: true }])).toBe(true);
    expect(allCharactersLeft([{ guildRankIndex: 2, guildRankAt: today, left: true }, { guildRankIndex: 4, guildRankAt: today }])).toBe(false);
    expect(allCharactersLeft([])).toBe(false);
  });
});

describe("planning removals", () => {
  const plan = (rank: number | null, roles: string[], left = false) => planRankRoles(QG, [{ discordUserId: "u", rank, roleIds: new Set(roles), left }]);
  it("removes the role from a member ranked below it, and adds nothing else", () => {
    expect(plan(4, ["officier", "other"])).toEqual([{ discordUserId: "u", add: [], remove: ["officier"], best: { index: 4, name: null } }]);
    expect(plan(3, ["officier"])[0]?.remove).toEqual(["officier"]);
  });
  it("never strips or gives the role to ranks above the mapped one (GM, co-GM)", () => {
    expect(plan(0, ["officier"])).toEqual([]);
    expect(plan(1, ["officier"])).toEqual([]);
    expect(plan(0, [])).toEqual([]);
  });
  it("uses the lowest rank mapped to a role as its floor", () => {
    const links = [{ rankIndex: 1, discordRoleId: "officier" }, { rankIndex: 2, discordRoleId: "officier" }];
    expect(planRankRoles(links, [{ discordUserId: "u", rank: 2, roleIds: new Set(["officier"]) }])).toEqual([]);
    expect(planRankRoles(links, [{ discordUserId: "u", rank: 3, roleIds: new Set(["officier"]) }])[0]?.remove).toEqual(["officier"]);
  });
  it("removes every mapped role a departed member holds, and only those", () => {
    expect(plan(null, ["officier", "other"], true)).toEqual([{ discordUserId: "u", add: [], remove: ["officier"], left: true, best: null }]);
    expect(plan(null, ["other"], true)).toEqual([]);
  });
  it("holds every removal while blocked, caps them otherwise, and never holds an addition", () => {
    const changes = Array.from({ length: 8 }, (_, i) => ({ discordUserId: `u${i}`, add: i === 7 ? ["member"] : [], remove: ["officier"] }));
    expect(limitRemovals(changes, "partial")).toEqual({ changes: [{ discordUserId: "u7", add: ["member"], remove: [] }], held: 8 });
    const capped = limitRemovals(changes, null);
    expect(capped.held).toBe(8 - MAX_REMOVALS_PER_RUN);
    expect(capped.changes.filter((c) => c.remove.length)).toHaveLength(MAX_REMOVALS_PER_RUN);
    expect(capped.changes.at(-1)).toEqual({ discordUserId: "u7", add: ["member"], remove: [] });
  });
});

describe("rank roles sync on a QG-shaped server", () => {
  it("two officer characters, or an officer alt with a member main, keep (or get) the role", async () => {
    const w = world([
      { id: "two", roles: ["officier"], chars: [{ name: "Ana Belle", rank: 2, isMain: true }, { name: "Ana Bis", rank: 2 }] },
      { id: "alt", roles: [], chars: [{ name: "Bo Main", rank: 4, isMain: true }, { name: "Bo Alt", rank: 2 }] },
      { id: "alt2", roles: ["officier"], chars: [{ name: "Cy Main", rank: 4, isMain: true }, { name: "Cy Alt", rank: 2 }] }
    ]);
    const result = await run(w);
    expect(result.changes).toEqual([{ discordUserId: "alt", add: ["officier"], remove: [], best: { index: 2, name: "Officer" } }]);
    expect(w.discord.get("two")!.roles.remove).not.toHaveBeenCalled();
    expect(w.discord.get("alt2")!.roles.remove).not.toHaveBeenCalled();
    expect(w.send).not.toHaveBeenCalled();
  });

  it("a demoted officer loses only @Officier, nothing is added, and the officer log says why", async () => {
    const w = world([
      { id: "demoted", roles: ["officier", "raider"], chars: [{ name: "Dee Demoted", rank: 4, isMain: true }] },
      { id: "gm", roles: ["officier"], chars: [{ name: "Gil Master", rank: 0, isMain: true }] },
      { id: "cogm", roles: [], chars: [{ name: "Co Gm", rank: 1, isMain: true }] }
    ]);
    const result = await run(w);
    expect(result).toMatchObject({ applied: 1, failed: 0, held: 0 });
    expect(w.discord.get("demoted")!.roles.remove).toHaveBeenCalledWith(["officier"], expect.any(String));
    expect(w.discord.get("demoted")!.roles.add).not.toHaveBeenCalled();
    expect(w.discord.get("gm")!.roles.remove).not.toHaveBeenCalled();
    expect(w.discord.get("cogm")!.roles.add).not.toHaveBeenCalled();
    expect(w.send).toHaveBeenCalledWith({ content: "<@demoted> lost <@&officier>: no character at rank Officer anymore (best: Member).", allowedMentions: { parse: [] } });
  });

  it("writes the log line in French for a French server", async () => {
    const w = world([{ id: "demoted", roles: ["officier"], chars: [{ name: "Dee Demoted", rank: 4, isMain: true }] }], { lang: "fr" });
    await run(w);
    expect(w.send.mock.calls[0]).toEqual([{ content: "<@demoted> a perdu <@&officier> : plus aucun personnage au rang Officer (meilleur : Member).", allowedMentions: { parse: [] } }]);
    expect(rankRoleRemovalLine("fr", "u", "r", { left: true })).toBe("<@u> a perdu <@&r> : tous ses personnages ont quitté la guilde.");
  });

  it("never acts on stale ranks and never reads detached characters", async () => {
    const w = world([{ id: "old", roles: ["officier"], chars: [{ name: "Old Timer", rank: 4, isMain: true, at: stale }] }]);
    expect((await run(w)).changes).toEqual([]);
    expect(w.discord.get("old")!.roles.remove).not.toHaveBeenCalled();
    const query = w.prisma.member.findMany.mock.calls[0] as unknown as [{ where: { characters: { some: object } }; select: { characters: { where: object } } }];
    expect(query[0].where.characters.some).toMatchObject({ detachedAt: null });
    expect(query[0].select.characters.where).toEqual({ detachedAt: null });
  });

  it("holds every removal when the latest roster looks partial, and still adds", async () => {
    // 20 fresh ranks, only 6 confirmed in the last 48 h: someone's partial view, not a full officer roster.
    const ranked = [...Array.from({ length: 6 }, () => today), ...Array.from({ length: 14 }, () => lastWeek)];
    const w = world([
      { id: "demoted", roles: ["officier"], chars: [{ name: "Dee Demoted", rank: 4, isMain: true }] },
      { id: "new", roles: [], chars: [{ name: "Neo Officer", rank: 2, isMain: true }] }
    ], { ranked });
    const result = await run(w);
    expect(result.held).toBe(1);
    expect(result.heldReason).toBe(PARTIAL_ROSTER_REASON);
    expect(w.discord.get("demoted")!.roles.remove).not.toHaveBeenCalled();
    expect(w.discord.get("new")!.roles.add).toHaveBeenCalledWith(["officier"], expect.any(String));
    expect(w.send).not.toHaveBeenCalled();
  });

  it("removes at most five members per run", async () => {
    const people = Array.from({ length: 7 }, (_, i) => ({ id: `d${i}`, roles: ["officier"], chars: [{ name: `Dee ${i}`, rank: 4, isMain: true }] }));
    const w = world(people);
    const result = await run(w);
    expect(result.held).toBe(2);
    expect(result.heldReason).toMatch(/at most 5/);
    expect([...w.discord.values()].filter((m) => m.roles.remove.mock.calls.length)).toHaveLength(5);
    expect((w.send.mock.calls[0] as unknown as [{ content: string }])[0].content.split("\n")).toHaveLength(5);
  });

  it("a member whose every character left the guild loses @Officier; one with a character still in the guild is ranked by it", async () => {
    const departures = [{ nameKey: "kay kicked", observedAt: today }, { nameKey: "kay alt", observedAt: today }, { nameKey: "lee gone", observedAt: today }];
    const w = world([
      { id: "kicked", roles: ["officier"], chars: [{ name: "Kay Kicked", rank: 2, isMain: true, at: lastWeek }, { name: "Kay Alt", rank: 4, at: lastWeek }] },
      { id: "half", roles: ["officier"], chars: [{ name: "Lee Gone", rank: 2, isMain: true, at: lastWeek }, { name: "Lee Stays", rank: 4 }] }
    ], { departures });
    const result = await run(w);
    expect(result.changes).toEqual([
      { discordUserId: "kicked", add: [], remove: ["officier"], left: true, best: null },
      { discordUserId: "half", add: [], remove: ["officier"], best: { index: 4, name: "Member" } }
    ]);
    expect(w.send.mock.calls[0]).toEqual([{ content: "<@kicked> lost <@&officier>: all their characters left the guild.\n<@half> lost <@&officier>: no character at rank Officer anymore (best: Member).", allowedMentions: { parse: [] } }]);
  });

  it("ignores a departure older than the character's last rank reading (they came back)", async () => {
    const w = world([{ id: "back", roles: ["officier"], chars: [{ name: "Ray Back", rank: 2, isMain: true, at: today }] }],
      { departures: [{ nameKey: "ray back", observedAt: lastWeek }] });
    expect((await run(w)).changes).toEqual([]);
  });

  it("matches a departure by character id before name", async () => {
    const w = world([{ id: "renamed", roles: ["officier"], chars: [{ name: "New Name", rank: 2, isMain: true, at: lastWeek, wowId: 42n }] }],
      { departures: [{ nameKey: "old name", wowId: 42n, observedAt: today }, { nameKey: "new name", wowId: 7n, observedAt: today }] });
    expect((await run(w)).changes[0]).toMatchObject({ discordUserId: "renamed", left: true });
    const other = world([{ id: "same", roles: ["officier"], chars: [{ name: "New Name", rank: 2, isMain: true, at: lastWeek, wowId: 9n }] }],
      { departures: [{ nameKey: "new name", wowId: 7n, observedAt: today }] });
    expect((await run(other)).changes).toEqual([]);
  });

  it("a dry run lists the removal without changing or logging anything", async () => {
    const w = world([{ id: "demoted", roles: ["officier"], chars: [{ name: "Dee Demoted", rank: 4, isMain: true }] }]);
    const result = await run(w, true);
    expect(result.changes[0]?.remove).toEqual(["officier"]);
    expect(w.discord.get("demoted")!.roles.remove).not.toHaveBeenCalled();
    expect(w.send).not.toHaveBeenCalled();
  });
});

describe("the preview lists removals", () => {
  it("shows who would lose the role, for every mapped role, and the held ones", async () => {
    const people = Array.from({ length: 6 }, (_, i) => ({ id: `d${i}`, name: `Dee ${i}`, roles: ["officier"], chars: [{ name: `Dee ${i}`, rank: 4, isMain: true }] }));
    const w = world([...people, { id: "neo", name: "Neo", roles: [], chars: [{ name: "Neo Officer", rank: 2, isMain: true }] }]);
    const preview = await previewRankRoles(w.prisma as never, w.guild as never, QG, now);
    expect(preview.losses).toEqual([{ discordRoleId: "officier", names: ["Dee 0", "Dee 1", "Dee 2", "Dee 3", "Dee 4"] }]);
    const text = formatRankRolePreview(preview, 2);
    expect(text).toContain("Rank 2 → <@&officier>: **1** member(s) would get it (Neo)");
    expect(text).toContain("<@&officier>: **5** member(s) would lose it");
    expect(text).toContain("1 member(s) keep a rank role for now: at most 5");
    expect(w.discord.get("d0")!.roles.remove).not.toHaveBeenCalled();
  });
});
