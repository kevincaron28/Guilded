import { describe, expect, it, vi } from "vitest";
import { ALT_RANK_NAMES, DEFAULT_PROMOTION_RULE, isAltRank, planPromotions, promotionLogLine, type PromotionCharacter, type PromotionPerson } from "../src/services/promotion.js";
import { applyGuildData } from "../src/services/guild-data.js";
import { parseAddonSnapshot } from "../src/integrations/addon.js";

// These tests are about days and ranks; the voice condition has its own tests.
const NO_VOICE = { ...DEFAULT_PROMOTION_RULE, minVoiceMinutes: 0 };
const NOW = new Date("2026-11-20T12:00:00Z");
const days = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const char = (over: Partial<PromotionCharacter> = {}): PromotionCharacter => ({ name: "Halidor Galemorne", level: 20, rankName: "Initiate", rankAt: days(1), since: days(9), isMain: true, ...over });
const person = (id: string, characters: PromotionCharacter[]): PromotionPerson => ({ discordUserId: id, displayName: id.toUpperCase(), inDiscord: true, characters });
const plan = (people: PromotionPerson[], rule = NO_VOICE) => planPromotions({ now: NOW, rule, unclaimed: [], people });

describe("alt ranks are never promoted (16 Nov 2026)", () => {
  it("recognises alt rank names in English and French, without case or accents", () => {
    for (const name of ["Alt", "alts", "ALTS", "Alt (bank)", "Alt-Bank", "Reroll", "Rerolls", "Re-roll", "Réroll", "RÉROLLS", "Twink"]) expect(isAltRank(name), name).toBe(true);
    for (const name of ["Member", "Initiate", "Altar", "Alternate", "Veteran", "Salt", "", null, undefined]) expect(isAltRank(name), String(name)).toBe(false);
    for (const name of ALT_RANK_NAMES) expect(isAltRank(name)).toBe(true);
  });
  it("never lists a member whose rank is an alt rank, even when it is the configured starting rank", () => {
    expect(plan([person("a", [char({ rankName: "Alt" })])], { ...DEFAULT_PROMOTION_RULE, fromRank: "Alt" })).toEqual({ ready: [], left: [], unclaimed: [], waiting: [] });
    expect(plan([person("a", [char({ rankName: "Alts" })])]).ready).toEqual([]);
  });
  it("ignores a character that is an alt (not the main) even at the starting rank, but still promotes a main", () => {
    const result = plan([
      person("a", [char({ name: "Main One", rankName: "Member", isMain: true }), char({ name: "Alt Two", isMain: false })]),
      person("b", [char({ name: "Main Three", isMain: true }), char({ name: "Alt Four", isMain: false, since: days(40) })]),
      person("c", [char({ name: "No Main Five", isMain: false })])
    ]);
    expect(result.ready.map((r) => r.displayName)).toEqual(["B", "C"]);
    expect(result.ready.find((r) => r.displayName === "B")?.character).toBe("Main Three");
    expect(result.waiting).toEqual([]);
  });
});

describe("the ready list follows the roster", () => {
  it("drops a member as soon as the bot has seen their new rank", () => {
    const before = plan([person("a", [char()])]);
    expect(before.ready.map((r) => r.displayName)).toEqual(["A"]);
    const after = plan([person("a", [char({ rankName: "Member", rankAt: days(0), since: days(0) })])]);
    expect(after.ready).toEqual([]);
    expect(after.waiting).toEqual([]);
  });
});

describe("officer-log promotion line", () => {
  it("is plain text in the server language", () => {
    expect(promotionLogLine("Amy Smith", "Member", "en")).toBe("⬆️ Amy Smith was promoted to Member.");
    expect(promotionLogLine("Amy Smith", "Member", "fr")).toBe("⬆️ Amy Smith a été promu(e) au rang Member.");
  });
});

// A loose in-memory stand-in for the tables applyGuildData touches (one linked character).
type Row = Record<string, unknown>;
function fakeTx(character: Row) {
  const noop = async () => ({ count: 0 });
  return {
    guildRosterEntry: { findMany: async () => [], upsert: noop, updateMany: noop },
    guildEventEntry: { findMany: async () => [], create: noop },
    guildText: { findUnique: async () => null, upsert: noop },
    character: { findMany: async () => [character], update: async ({ data }: { data: Row }) => Object.assign(character, data), updateMany: noop },
    unclaimedCharacter: { findMany: async () => [], update: noop, updateMany: noop, createMany: noop },
    characterRankSeen: { upsert: noop }
  } as never;
}
const T = Math.floor(NOW.getTime() / 1000) - 3600;
const upload = (rankName: string, rankIndex: number) => parseAddonSnapshot({ source: "Guilded", exportedAt: NOW, gameEdition: "forever",
  guildRoster: { at: T, complete: true, members: [{ name: "Amy Smith", level: 30, class: "MAGE", rankName, rankIndex, online: true }] } });
const stored = (rankName: string | null, rankIndex: number | null) => ({ id: "c1", name: "Amy Smith", realm: "Forever", gameEdition: "forever", displayName: null, level: 30, className: "Mage", lastSeenAt: null,
  guildRankName: rankName, guildRankIndex: rankIndex, guildRankAt: new Date((T - 86400) * 1000) });

describe("a roster upload that shows a rank moving up", () => {
  it("reports the promotion once (officer uploads only), not a first sighting, a demotion or a member's upload", async () => {
    const up = await applyGuildData(fakeTx(stored("Initiate", 4)), "g", { memberId: "m", officer: true }, upload("Member", 3), NOW);
    expect(up.promotions).toEqual([{ name: "Amy Smith", rankName: "Member" }]);
    expect((await applyGuildData(fakeTx(stored(null, null)), "g", { memberId: "m", officer: true }, upload("Member", 3), NOW)).promotions).toEqual([]);
    expect((await applyGuildData(fakeTx(stored("Member", 3)), "g", { memberId: "m", officer: true }, upload("Initiate", 4), NOW)).promotions).toEqual([]);
    expect((await applyGuildData(fakeTx(stored("Initiate", 4)), "g", { memberId: "m", officer: false }, upload("Member", 3), NOW)).promotions).toEqual([]);
    // The same rank seen again is not a second announcement.
    const row = stored("Initiate", 4);
    const tx = fakeTx(row);
    await applyGuildData(tx, "g", { memberId: "m", officer: true }, upload("Member", 3), NOW);
    expect((await applyGuildData(tx, "g", { memberId: "m", officer: true }, upload("Member", 3), NOW)).promotions).toEqual([]);
  });
});

describe("rank reorders are not announced as promotions", () => {
  it("announces nothing when an index now carries another name, or when more than 5 members move up at once", async () => {
    // Rank 3 was renamed from "Initiate" to "Recruit" and Amy "moved up" from index 4: a layout change, not a promotion.
    const row = stored("Initiate", 4);
    const other = { ...stored("Initiate", 3), id: "c2", name: "Bea Jones" };
    const tx = {
      ...(fakeTx(row) as object),
      character: { findMany: async () => [row, other], update: async ({ where, data }: { where: { id: string }; data: Row }) => Object.assign(where.id === "c1" ? row : other, data), updateMany: async () => ({ count: 0 }) }
    } as never;
    const snapshot = parseAddonSnapshot({ source: "Guilded", exportedAt: NOW, gameEdition: "forever", guildRoster: { at: T, complete: true, members: [
      { name: "Amy Smith", level: 30, class: "MAGE", rankName: "Member", rankIndex: 3, online: true }, { name: "Bea Jones", level: 30, class: "MAGE", rankName: "Recruit", rankIndex: 3, online: true }] } });
    expect((await applyGuildData(tx, "g", { memberId: "m", officer: true }, snapshot, NOW)).promotions).toEqual([]);
    // Seven members up one rank in one upload.
    const many = Array.from({ length: 7 }, (_, i) => ({ ...stored("Initiate", 4), id: `m${i}`, name: `Person Number${i}` }));
    const tx2 = { ...(fakeTx(row) as object), character: { findMany: async () => many, update: async ({ where, data }: { where: { id: string }; data: Row }) => Object.assign(many.find((c) => c.id === where.id)!, data), updateMany: async () => ({ count: 0 }) } } as never;
    const snap2 = parseAddonSnapshot({ source: "Guilded", exportedAt: NOW, gameEdition: "forever", guildRoster: { at: T, complete: true,
      members: many.map((c) => ({ name: c.name, level: 30, class: "MAGE", rankName: "Member", rankIndex: 3, online: true })) } });
    expect((await applyGuildData(tx2, "g", { memberId: "m", officer: true }, snap2, NOW)).promotions).toEqual([]);
  });
});

describe("/officer promotion rule refuses an alt starting rank", () => {
  it("answers in the server language and changes nothing", async () => {
    vi.resetModules();
    const upsert = vi.fn();
    vi.doMock("../src/database.js", () => ({ prisma: { guildSettings: { upsert } } }));
    vi.doMock("../src/permissions.js", () => ({ hasPermission: () => true }));
    vi.doMock("../src/commands/context.js", () => ({ requireGuildContext: async () => ({ guildId: "g" }),
      guildService: { getSettings: async () => ({ language: "fr" }), ensureGuild: async () => ({ gameEdition: "forever" }) } }));
    const { executePromotion } = await import("../src/commands/promotion.js");
    const reply = vi.fn();
    await executePromotion({ member: {}, guild: { id: "d", name: "x" }, reply,
      options: { getSubcommand: () => "rule", getString: (name: string) => name === "rank" ? "Alts" : null, getBoolean: () => null, getInteger: () => null, getChannel: () => null } } as never);
    expect(upsert).not.toHaveBeenCalled();
    expect(reply.mock.calls[0]![0].content).toContain("alts ne sont jamais promus");
    vi.doUnmock("../src/database.js"); vi.doUnmock("../src/permissions.js"); vi.doUnmock("../src/commands/context.js");
  });
});
