import { describe, expect, it } from "vitest";
import { importDuelResults, importMilestones, standingsFromDuels, duelLeaderboard, PAIR_DAILY_CAP, REPORTER_DAILY_CAP } from "../src/services/duels.js";
import { exportDuelResults, exportMilestones } from "../companion/lua-export-content.mjs";
import { parseAddonSnapshot } from "../src/integrations/addon.js";
import { personalSnapshot } from "../src/services/companion-access.js";

interface Row { guildId: string; gameEdition: string; winnerId: string; loserId: string; winnerCharacter: string; loserCharacter: string; reason: string; endedAt: Date; dayKey: string; pairKey: string; counted: boolean; reportKey: string; reporterId: string | null }

// An in-memory stand-in for the two Prisma calls the importer uses.
function fakeTx() {
  const rows: Row[] = [];
  const milestones: Record<string, unknown>[] = [];
  const match = (row: Row, where: Record<string, unknown>) => Object.entries(where).every(([key, want]) => {
    const value = (row as unknown as Record<string, unknown>)[key] as Date;
    if (want && typeof want === "object" && !(want instanceof Date)) {
      const range = want as { gte?: Date; lte?: Date };
      if (range.gte && value < range.gte) return false;
      if (range.lte && value > range.lte) return false;
      return true;
    }
    return value === want;
  });
  const tx = {
    duelResult: {
      findFirst: async ({ where }: { where: Record<string, unknown> }) => rows.find(row => match(row, where)) ?? null,
      count: async ({ where }: { where: Record<string, unknown> }) => rows.filter(row => match(row, where)).length,
      createMany: async ({ data }: { data: Row[] }) => {
        let count = 0;
        for (const row of data) if (!rows.some(r => r.guildId === row.guildId && r.reportKey === row.reportKey)) { rows.push(row); count++; }
        return { count };
      }
    },
    memberMilestone: {
      createMany: async ({ data }: { data: Record<string, unknown>[] }) => {
        let count = 0;
        for (const row of data) if (!milestones.some(r => r["memberId"] === row["memberId"] && r["ref"] === row["ref"])) { milestones.push(row); count++; }
        return { count };
      }
    }
  };
  return { tx: tx as never, rows, milestones };
}

const characters = [
  { id: "c1", name: "Kev", realm: "R", memberId: "m1" }, { id: "c2", name: "Bob", realm: "R", memberId: "m2" },
  { id: "c3", name: "Cy", realm: "R", memberId: "m3" }, { id: "c4", name: "Twin", realm: "R", memberId: "m1" }
];
const now = new Date("2026-11-10T12:00:00Z");
const at = (offsetSeconds: number) => Math.floor(now.getTime() / 1000) - 600 + offsetSeconds;
const duel = (winner: string, loser: string, when: number, reason = "knockout") => ({ winner, loser, at: when, reason });

describe("duel ingest", () => {
  it("stores a duel between two guild members reported by one of them", async () => {
    const { tx, rows } = fakeTx();
    const result = await importDuelResults(tx, "g", "forever", "m1", characters, [duel("Kev", "Bob", at(0))], now);
    expect(result).toMatchObject({ recorded: 1, counted: 1, rejected: 0 });
    expect(rows[0]).toMatchObject({ winnerId: "m1", loserId: "m2", counted: true, gameEdition: "forever", reporterId: "m1", dayKey: "2026-11-10" });
  });

  it("matches the other player's report of the same duel instead of counting twice", async () => {
    const { tx, rows } = fakeTx();
    await importDuelResults(tx, "g", "forever", "m1", characters, [duel("Kev", "Bob", at(0))], now);
    const again = await importDuelResults(tx, "g", "forever", "m2", characters, [duel("Kev", "Bob", at(4))], now);
    expect(again).toMatchObject({ recorded: 0, duplicates: 1 });
    // An exact replay of the same upload is also a duplicate.
    expect((await importDuelResults(tx, "g", "forever", "m1", characters, [duel("Kev", "Bob", at(0))], now)).duplicates).toBe(1);
    expect(rows).toHaveLength(1);
    // The same pair three minutes later is a new duel.
    expect((await importDuelResults(tx, "g", "forever", "m1", characters, [duel("Kev", "Bob", at(200))], now)).recorded).toBe(1);
  });

  it("rejects strangers, a bystander's upload, self duels, old and future results", async () => {
    const { tx, rows } = fakeTx();
    const result = await importDuelResults(tx, "g", "forever", "m3", characters, [
      duel("Kev", "Bob", at(0)), // m3 (Cy) is not a participant
      duel("Cy", "Nobody", at(1)), // unknown loser
      duel("Kev", "Twin", at(2)), // the same member twice
      { winner: "Cy", loser: "Bob", at: at(-40 * 86400), reason: "knockout" },
      { winner: "Cy", loser: "Bob", at: at(3600), reason: "knockout" },
      { winner: "Cy", loser: "Bob", at: at(3), reason: "cheat" }
    ], now);
    expect(result.recorded).toBe(0);
    expect(result.rejected).toBe(6);
    expect(rows).toHaveLength(0);
    expect((await importDuelResults(tx, "g", "forever", null, characters, [duel("Kev", "Bob", at(0))], now)).rejected).toBe(1);
  });

  it("keeps duels over the daily allowance per pair but does not count them", async () => {
    const { tx, rows } = fakeTx();
    // Earlier times inside the same UTC day, three minutes apart.
    const spread = Array.from({ length: PAIR_DAILY_CAP + 3 }, (_, i) => duel("Kev", "Bob", Math.floor(now.getTime() / 1000) - 3600 * 5 + i * 200));
    const result = await importDuelResults(tx, "g", "forever", "m1", characters, spread, now);
    expect(result).toMatchObject({ recorded: PAIR_DAILY_CAP + 3, counted: PAIR_DAILY_CAP, capped: 3 });
    expect(rows.filter(row => row.counted)).toHaveLength(PAIR_DAILY_CAP);
    // The earliest duels are the ones that count.
    expect(rows.filter(row => row.counted).every(row => row.endedAt.getTime() <= spread[PAIR_DAILY_CAP - 1]!.at * 1000)).toBe(true);
  });

  it("caps one reporter's counted duels per day across opponents", () => {
    expect(REPORTER_DAILY_CAP).toBeGreaterThan(PAIR_DAILY_CAP);
  });

  it("stores milestones for the member's own characters only, idempotently", async () => {
    const { tx, milestones } = fakeTx();
    const own = characters.filter(c => c.memberId === "m1");
    const rows = [
      { character: "Kev", realm: "R", kind: "hk", ref: "hk:100", value: 100, at: at(0) },
      { character: "Bob", realm: "R", kind: "hk", ref: "hk:100", value: 100, at: at(0) }, // someone else's character
      { character: "Kev", realm: "R", kind: "bogus", ref: "x:1", value: 1, at: at(0) }
    ];
    const first = await importMilestones(tx, "g", "forever", "m1", own, rows, now);
    expect(first).toEqual({ recorded: 1, rejected: 2 });
    expect((await importMilestones(tx, "g", "forever", "m1", own, rows, now)).recorded).toBe(0);
    expect(milestones).toHaveLength(1);
    expect((await importMilestones(tx, "g", "forever", null, own, rows, now)).rejected).toBe(3);
  });
});

describe("duel standings", () => {
  const d = (w: string, l: string) => ({ winnerId: w, loserId: l, winnerCharacter: w.toUpperCase(), loserCharacter: l.toUpperCase() });
  it("ranks by wins, then win rate, with the current and best streak", () => {
    const rows = standingsFromDuels([d("a", "b"), d("a", "b"), d("b", "a"), d("a", "b"), d("c", "a"), d("c", "b")]);
    expect(rows.map(row => [row.name, row.wins, row.losses])).toEqual([["A", 3, 2], ["C", 2, 0], ["B", 1, 4]]);
    const a = rows.find(row => row.memberId === "a")!;
    expect(a).toMatchObject({ bestStreak: 2, streak: -1, games: 5 });
    expect(a.winRate).toBeCloseTo(0.6);
    expect(rows.find(row => row.memberId === "c")).toMatchObject({ winRate: 1, streak: 2 });
  });

  it("reads counted duels of one edition and one guild only", async () => {
    const calls: unknown[] = [];
    const db = { duelResult: { findMany: async (args: unknown) => { calls.push(args); return [d("a", "b")]; } } };
    const board = await duelLeaderboard(db as never, "g", "forever");
    expect(board.duels).toBe(1);
    expect(calls[0]).toMatchObject({ where: { guildId: "g", gameEdition: "forever", counted: true } });
  });
});

describe("snapshot plumbing", () => {
  it("exports whitelisted duels and milestones from the saved variables", () => {
    const database = {
      duels: { results: { a: { winner: "Kev", loser: "Bob", at: 1800000000, reason: "knockout", secret: "x" }, b: { winner: "Kev", loser: "Kev", at: 1800000001, reason: "knockout" }, c: { winner: "Kev", loser: "Bob", at: 1800000002, reason: "weird" } } },
      milestones: { chars: { "Kev-R": { name: "Kev", realm: "R", log: [{ kind: "hk", ref: "hk:100", value: 100, at: 1800000000 }, { kind: "hk", ref: "bad ref", value: 1, at: 1800000000 }] } } }
    };
    expect(exportDuelResults(database)).toEqual([{ winner: "Kev", loser: "Bob", at: 1800000000, reason: "knockout" }]);
    expect(exportMilestones(database)).toEqual([{ character: "Kev", realm: "R", kind: "hk", ref: "hk:100", value: 100, at: 1800000000 }]);
    expect(exportDuelResults({})).toEqual([]);
  });

  it("a personal companion keeps only its own duels and milestones", () => {
    const snapshot = parseAddonSnapshot({
      source: "Guilded", exportedAt: "2026-11-10T00:00:00Z", gameEdition: "forever",
      duelResults: [duel("Kev", "Bob", 1800000000), duel("Cy", "Bob", 1800000000)],
      milestones: [{ character: "Kev", realm: "R", kind: "level", ref: "level:10", value: 10, at: 1800000000 }, { character: "Cy", realm: "R", kind: "level", ref: "level:10", value: 10, at: 1800000000 }]
    });
    const own = personalSnapshot(snapshot, [{ name: "Kev", realm: "R" }]);
    expect(own.duelResults).toHaveLength(1);
    expect(own.milestones).toHaveLength(1);
  });
});

describe("duel and milestone achievements", () => {
  it("earns the new rows from facts, in both languages", async () => {
    const { evaluateAchievements, emptyFacts } = await import("../src/services/achievements.js");
    const { achievementById } = await import("../src/services/achievements-catalogue.js");
    const day = (n: number) => new Date(Date.UTC(2026, 10, n));
    const facts = { ...emptyFacts(), honorableKills: 150, duelWins: 12, duelStreak: 5, beatTopDuelist: 1, dungeonVariety: Array.from({ length: 10 }, (_, i) => day(i + 1)) };
    const earned = new Set(evaluateAchievements(facts, new Date("2026-11-20")).filter(row => row.earned).map(row => row.def.id));
    for (const id of ["honorable-kills-1", "honorable-kills-100", "duel-wins-1", "duel-wins-10", "duel-streak-5", "duel-beat-top", "dungeon-variety-1", "dungeon-variety-5", "dungeon-variety-10"]) expect(earned.has(id), id).toBe(true);
    for (const id of ["honorable-kills-500", "duel-wins-50"]) expect(earned.has(id), id).toBe(false);
    for (const id of ["duel-streak-5", "duel-beat-top", "dungeon-variety-1"]) { const def = achievementById(id)!; expect(def.fr.name.length).toBeGreaterThan(2); expect(def.en.description.length).toBeGreaterThan(10); }
  });

  it("derives streak and top-duelist wins from the member's own duels", async () => {
    const { gatherAchievementFacts } = await import("../src/services/achievements.js");
    const rows = [{ winnerId: "m", loserId: "a" }, { winnerId: "m", loserId: "b" }, { winnerId: "z", loserId: "m" }, { winnerId: "m", loserId: "top" }];
    const db = {
      member: { findFirst: async () => ({ discordUserId: "u", createdAt: new Date(), guild: null }) },
      character: { findMany: async () => [] }, professionSkill: { findMany: async () => [] }, dungeonRunPlayer: { findMany: async () => [] }, raidAttendance: { findMany: async () => [] },
      communityParticipationDay: { findMany: async () => [] }, poeLevelReached: { findMany: async () => [] }, poeMapVisit: { findMany: async () => [] },
      memberActivityTotal: { findUnique: async () => null }, communityPoint: { aggregate: async () => ({ _sum: { amount: 0 } }), count: async () => 0 },
      epgpTransaction: { aggregate: async () => ({ _sum: { epAmount: 0 } }) }, communityHonorAward: { findMany: async () => [] },
      memberMilestone: { aggregate: async () => ({ _max: { value: 100 } }), findMany: async () => [] }, craftRequest: { findMany: async () => [] }, recipeKnown: { findMany: async () => [] },
      duelResult: { findMany: async () => rows, groupBy: async () => [{ winnerId: "top", _count: { _all: 5 } }] }
    };
    const facts = await gatherAchievementFacts(db as never, "g", "m");
    expect(facts).toMatchObject({ duelWins: 3, duelStreak: 2, beatTopDuelist: 1, honorableKills: 100 });
    db.duelResult.groupBy = async () => [{ winnerId: "m", _count: { _all: 9 } }];
    expect((await gatherAchievementFacts(db as never, "g", "m")).beatTopDuelist).toBe(0);
  });
});
