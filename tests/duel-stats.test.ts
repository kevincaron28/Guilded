import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { duelResultSchema, importDuelResults, mergeStats } from "../src/services/duels.js";
import { clockText, compactNumber, duelResultCard, isUpset, withExtras, withStandings, type DuelCardInput } from "../src/services/duel-card.js";
import { emptyNameBook } from "../src/services/character-display.js";
import { exportDuelResults } from "../companion/lua-export-content.mjs";

const base = { winner: "Kev", loser: "Bob", at: 1_795_000_000, reason: "knockout" as const };

describe("duel statistics (9.5): schema", () => {
  it("accepts the measured numbers", () => {
    const p = duelResultSchema.parse({ ...base, durationSec: 47, winnerHealthLeft: 38, loserHealthLeft: 0, winnerDamageTaken: 3120, loserDamageTaken: 4890, winnerHealing: 760, loserHealing: 0, winnerLowestHealth: 21, loserLowestHealth: 0 });
    expect(p).toMatchObject({ durationSec: 47, winnerDamageTaken: 3120, loserDamageTaken: 4890, winnerLowestHealth: 21 });
  });
  it("drops unreadable or out-of-range numbers instead of rejecting the duel", () => {
    const p = duelResultSchema.parse({ ...base, durationSec: 5000, winnerHealthLeft: 140, loserHealthLeft: "x", winnerDamageTaken: -4, loserDamageTaken: 1.5, winnerHealing: 20_000_000, loserHealing: 12 });
    expect(p.durationSec).toBeUndefined(); expect(p.winnerHealthLeft).toBeUndefined(); expect(p.loserHealthLeft).toBeUndefined();
    expect(p.winnerDamageTaken).toBeUndefined(); expect(p.loserDamageTaken).toBeUndefined(); expect(p.winnerHealing).toBeUndefined();
    expect(p.loserHealing).toBe(12);
  });
  it("an older upload without them still parses", () => {
    expect(duelResultSchema.safeParse(base).success).toBe(true);
  });
});

describe("duel statistics: merging the two sides' reports", () => {
  it("the reporter's own side replaces, the other side and the duration only fill unknowns", () => {
    const stored = { durationSec: null, winnerDamageTaken: 100, loserDamageTaken: 200, winnerHealing: null };
    expect(mergeStats(stored, { durationSec: 40, winnerDamageTaken: 150, loserDamageTaken: 999, winnerHealing: 5 }, "winner"))
      .toEqual({ durationSec: 40, winnerDamageTaken: 150, winnerHealing: 5 });
    expect(mergeStats(stored, { loserDamageTaken: 250, winnerDamageTaken: 999 }, "loser")).toEqual({ loserDamageTaken: 250 });
  });

  it("stores each side's numbers from that side's own addon across two reports", async () => {
    const rows: Record<string, unknown>[] = [];
    const tx = { duelResult: {
      findFirst: async () => rows[0] ?? null, count: async () => 0,
      createMany: async ({ data }: { data: Record<string, unknown>[] }) => { rows.push({ id: "r1", ...data[0] }); return { count: 1 }; },
      update: async ({ data }: { data: Record<string, unknown> }) => { Object.assign(rows[0]!, data); return rows[0]; } } } as never;
    const characters = [{ id: "c1", name: "Kev", realm: "R", memberId: "m1" }, { id: "c2", name: "Bob", realm: "R", memberId: "m2" }];
    const now = new Date(1_795_000_300 * 1000);
    const first = await importDuelResults(tx, "g", "forever", "m1", characters, [{ ...base, durationSec: 47, winnerDamageTaken: 3000, winnerHealing: 700, winnerHealthLeft: 38 }], new Date(1_795_000_300_000));
    expect(first).toMatchObject({ recorded: 1 });
    expect(first.fresh[0]!.stats).toMatchObject({ winnerDamageTaken: 3000, durationSec: 47 });
    // Bob's companion reports the same duel with his own side (and a wrong figure for Kev's side, which must not replace Kev's).
    const second = await importDuelResults(tx, "g", "forever", "m2", characters, [{ ...base, at: base.at + 2, loserDamageTaken: 4800, loserHealthLeft: 0, winnerDamageTaken: 1 }], now);
    expect(second).toMatchObject({ duplicates: 1, recorded: 0 });
    expect(rows[0]).toMatchObject({ winnerDamageTaken: 3000, winnerHealing: 700, loserDamageTaken: 4800, loserHealthLeft: 0, durationSec: 47 });
  });
});

describe("duel statistics: what the bot adds", () => {
  const row = (n: number, w: string, l: string, minute = n) => ({ reportKey: `k${n}`, winnerId: w, loserId: l, winnerCharacter: w, loserCharacter: l, winnerLevel: 40, loserLevel: 40, endedAt: new Date(Date.UTC(2026, 10, 20, 12, minute)) });
  const fresh = (extra: Partial<DuelCardInput> = {}): DuelCardInput => ({ reportKey: "k4", winnerId: "A", loserId: "B", winnerCharacter: "A", loserCharacter: "B", winnerLevel: 40, loserLevel: 40, reason: "knockout", endedAt: new Date(Date.UTC(2026, 10, 20, 12, 4)), points: 10, winnerScore: 30, winnerStreak: 1, winnerBest: 1, ...extra });

  it("computes the head-to-head up to and including the duel, and the rank", () => {
    const history = [row(1, "A", "B"), row(2, "B", "A"), row(3, "A", "B"), row(4, "A", "B"), row(5, "B", "A")];
    const [d] = withExtras([fresh()], history, new Date("2100-01-01"));
    expect(d!.headToHead).toEqual({ wins: 3, losses: 1 });
    expect(d!.rank).toBe(1);
  });

  it("upset: lower level by 3 or more, or lower rated by 50 or more", () => {
    expect(isUpset({ winnerLevel: 37, loserLevel: 40, rating: undefined as never })).toBe(true);
    expect(isUpset({ winnerLevel: 38, loserLevel: 40, rating: undefined as never })).toBe(false);
    expect(isUpset({ winnerLevel: 40, loserLevel: 40, rating: undefined as never })).toBe(false);
    const rating = (winnerScore: number, loserScore: number, rated = true) => ({ winnerDelta: 10, loserDelta: -10, winnerScore, loserScore, winnerPlacement: null, loserPlacement: null, rated, seasonId: "S1", startsAt: "2026-11-04T23:00:00Z" });
    expect(isUpset({ winnerLevel: 40, loserLevel: 40, rating: rating(1010, 1090) })).toBe(true);   // before: 1000 vs 1100
    expect(isUpset({ winnerLevel: 40, loserLevel: 40, rating: rating(1010, 1030) })).toBe(false);  // before: 1000 vs 1040
    expect(isUpset({ winnerLevel: 40, loserLevel: 40, rating: rating(1010, 1090, false) })).toBe(false);
  });

  it("formats time and numbers", () => {
    expect(clockText(47)).toBe("0:47"); expect(clockText(83)).toBe("1:23");
    expect(compactNumber(842)).toBe("842"); expect(compactNumber(1840)).toBe("1.8k"); expect(compactNumber(12400)).toBe("12k");
  });
});

describe("duel statistics: the card", () => {
  const classes = new Map<string, string>();
  const d = (extra: Partial<DuelCardInput> = {}) => withStandings([{ reportKey: "k", winnerId: "w", loserId: "l", winnerCharacter: "Aldric", loserCharacter: "Brenna", winnerLevel: 40, loserLevel: 40, reason: "knockout", endedAt: new Date(Date.UTC(2026, 10, 20, 12)) }], new Map()).map(x => ({ ...x, ...extra }))[0]!;
  const all = { durationSec: 47, winnerHealthLeft: 38, loserHealthLeft: 0, winnerDamageTaken: 3120, loserDamageTaken: 4890, winnerHealing: 760, loserHealing: 0 };

  it("shows the figures per side (dealt is the opponent's taken), in both languages, without any estimate mark", () => {
    const en = duelResultCard(d({ stats: all, headToHead: { wins: 3, losses: 1 }, rank: 4 }), "en", classes, emptyNameBook).duel!;
    expect(en.time).toBe("0:47");
    expect(en.winner.stats).toEqual([{ label: "Dealt", value: "4.9k" }, { label: "Taken", value: "3.1k" }, { label: "Healing", value: "760" }, { label: "Health", value: "38%" }]);
    expect(en.pills!.map(p => p.text)).toEqual(["Head to head 3-1", "Rank #4"]);
    const fr = duelResultCard(d({ stats: all, winnerLevel: 31, loserLevel: 40 }), "fr", classes, emptyNameBook).duel!;
    expect(fr.pills![0]).toMatchObject({ kind: "upset" });
    expect(fr.pills![0]!.text).toMatch(/surprise|Pas vu venir|théâtre/);
    expect(fr.winner.stats![0]).toMatchObject({ label: "Infligés" });
    expect(JSON.stringify(fr) + JSON.stringify(en)).not.toMatch(/≈|estim/i);
  });

  it("shows only known stats; with none the card is as before", () => {
    const some = duelResultCard(d({ stats: { durationSec: 83, winnerHealthLeft: 12 } }), "en", classes, emptyNameBook).duel!;
    expect(some.time).toBe("1:23"); expect(some.winner.stats).toEqual([{ label: "Health", value: "12%" }]); expect(some.loser.stats).toBeUndefined();
    const none = duelResultCard(d(), "en", classes, emptyNameBook).duel!;
    expect(none.time).toBeUndefined(); expect(none.pills).toBeUndefined(); expect(none.winner.stats).toBeUndefined();
  });

  it("draws with and without stats at the card size, keeping text at 24 px or more", async () => {
    const { renderDuelFaceOff } = await import("../src/services/card-duel.js");
    const { assertCardRules } = await import("../src/services/card-kit.js");
    const art = await sharp({ create: { width: 1200, height: 630, channels: 3, background: "#d98a3a" } }).jpeg().toBuffer();
    for (const input of [d(), d({ stats: all, headToHead: { wins: 3, losses: 1 }, rank: 4, winnerLevel: 31, loserLevel: 40 }), d({ stats: { winnerDamageTaken: 1_240_000, loserDamageTaken: 18_400 } })]) {
      const { png, report } = await renderDuelFaceOff(duelResultCard(input, "fr", classes, emptyNameBook).duel!, art);
      expect(await sharp(png).metadata()).toMatchObject({ width: 1200, height: 630 });
      expect(() => assertCardRules(report)).not.toThrow();
    }
  }, 60_000);
});

describe("duel statistics: companion export", () => {
  it("passes the measured numbers through, whitelisted and range-checked", () => {
    const db = { duels: { results: { a: { winner: "Kev Caron", loser: "Bob Smith", at: 1_795_000_000, reason: "knockout", dur: 47,
      stats: { w: { taken: 3120, heal: 760, low: 21, left: 38, max: 5000 }, l: { taken: 4890, heal: 0, low: 0, left: 150, extra: 9 } } } } } };
    const [row] = exportDuelResults(db);
    expect(row).toMatchObject({ durationSec: 47, winnerDamageTaken: 3120, winnerHealing: 760, winnerLowestHealth: 21, winnerHealthLeft: 38, loserDamageTaken: 4890, loserHealing: 0, loserLowestHealth: 0 });
    expect(row).not.toHaveProperty("loserHealthLeft");
    expect(row).not.toHaveProperty("winnerMax");
  });
  it("a row without measurements exports as before", () => {
    const [row] = exportDuelResults({ duels: { results: { a: { winner: "Kev", loser: "Bob", at: 1_790_000_000, reason: "retreat" } } } });
    expect(Object.keys(row!).sort()).toEqual(["at", "loser", "reason", "winner"]);
  });
});
