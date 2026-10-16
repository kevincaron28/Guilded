import { describe, expect, it, vi } from "vitest";
import { importDungeonRuns } from "../src/services/dungeon-import.js";
import * as ratingService from "../src/services/dungeon-rating.js";
import { bestEightBetaRules } from "../src/services/dungeon-beta-preset.js";
import { novemberRulesFixture, novemberFixtures } from "./fixtures/november-routes.js";

// In-memory stand-in for the few Prisma queries importDungeonRuns makes.
interface StoredPlayer { character: string; memberId: string | null; deaths: number | null }
interface StoredRun {
  id: string; runRef: string; instanceId: number; difficultyId: number; state: string; valid: boolean;
  invalidReason: string | null; startedAt: Date | null; endedAt: Date | null; durationSec: number | null; players: StoredPlayer[];
}

function fakeTx(season: { id: string; startsAt?: Date; endsAt?: Date; status?: string; ratingRules?: unknown } = { id: "season-1", startsAt: new Date(0) }) {
  const runs: StoredRun[] = [];
  const points: { memberId: string; amount: number; source: string; runId: string }[] = [];
  const achievements: { memberId: string; key: string; runId: string }[] = [];
  const completedWith = (where: { instanceId?: number; valid?: boolean; state?: string }) => (run: StoredRun) =>
    (where.instanceId === undefined || run.instanceId === where.instanceId) && (where.valid === undefined || run.valid === where.valid)
    && (where.state === undefined || run.state === where.state);
  const tx = {
    guildSettings: { findUnique: async () => ({ dungeonConfig: { levelBands: { "36": { min: 15, max: 25, difficultyId: 1 } } } }) },
    dungeonSeason: {
      findFirst: async () => null,
      create: async () => season
    },
    dungeonRun: {
      findUnique: async ({ where }: { where: { guildId_runRef: { runRef: string } } }) =>
        runs.find((run) => run.runRef === where.guildId_runRef.runRef) ?? null,
      findMany: async ({ where }: { where: { instanceId?: number; valid?: boolean; state?: string; startedAt?: { gte: Date; lte: Date }; players?: { some: { memberId: string } } } }) =>
        runs.filter(completedWith(where)).filter((run) => {
          if (where.startedAt && !(run.startedAt && run.startedAt >= where.startedAt.gte && run.startedAt <= where.startedAt.lte)) return false;
          if (where.players && !run.players.some((player) => player.memberId === where.players?.some.memberId)) return false;
          return true;
        }),
      findFirst: async ({ where }: { where: { instanceId: number; difficultyId: number; valid: boolean; state: string } }) =>
        runs.filter(completedWith(where)).filter((run) => run.difficultyId === where.difficultyId && run.durationSec !== null)
          .sort((a, b) => (a.durationSec ?? 0) - (b.durationSec ?? 0))[0] ?? null,
      create: async ({ data }: { data: Omit<StoredRun, "id" | "players"> & { players: { create: StoredPlayer[] } } }) => {
        const run = { ...data, id: `run-${runs.length + 1}`, players: data.players.create };
        runs.push(run);
        return run;
      }
    },
    dungeonAchievement: {
      findMany: async ({ where }: { where: { memberId: { in: string[] } } }) => achievements.filter((row) => where.memberId.in.includes(row.memberId)),
      create: async ({ data }: { data: { memberId: string; key: string; runId: string } }) => { achievements.push(data); return data; }
    },
    dungeonPointTransaction: {
      create: async ({ data }: { data: { memberId: string; amount: number; source: string; runId: string } }) => {
        points.push(data);
        return data;
      }
    }
  };
  return { tx: tx as unknown as Parameters<typeof importDungeonRuns>[0], runs, points, achievements };
}

const characters = ["Kev", "Bob", "Amy", "Zed", "Liz"].map((name) => ({ name, realm: "Forever", memberId: `m-${name.toLowerCase()}` }));
const now = new Date("2026-09-25T23:00:00Z");
const start = Math.floor(new Date("2026-09-25T18:00:00Z").getTime() / 1000);

function run(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id, protocolVersion: 1, state: "COMPLETED", instanceId: 36, name: "Deadmines", difficultyId: 1,
    startedAt: start, endedAt: start + 1500, reporters: 1, completedBy: "final boss",
    players: characters.map((character) => ({ character: character.name, realm: "Forever", deaths: 0, presentSec: 1500, inGuild: true, level: 20, minLevel: 20 })),
    ...overrides
  };
}

const total = (points: { memberId: string; amount: number }[], memberId: string) =>
  points.filter((row) => row.memberId === memberId).reduce((sum, row) => sum + row.amount, 0);

describe("importDungeonRuns", () => {
  it("refuses malformed v5 rules instead of falling back to legacy participation awards", async () => {
    const { tx, points, runs } = fakeTx({ id: "invalid-november", ratingRules: { ...novemberRulesFixture(), competitionLevel: 30 } });
    await expect(importDungeonRuns(tx, "g1", [run("malformed-rules")], characters, "officer", null, now)).rejects.toThrow(/Invalid November rules/);
    expect(points).toEqual([]);
    expect(runs).toEqual([]);
  });
  it("uses v5 route evidence and account weekly awards without changing beta history", async () => {
    const spy = vi.spyOn(ratingService, "dungeonRating").mockResolvedValue([]);
    try {
      const rules = novemberRulesFixture();
      const before = JSON.stringify(rules);
      const { tx, points, runs } = fakeTx({ id: "november", startsAt: new Date(0), ratingRules: rules });
      const routeRun = (id: string, routeIndex: number, offset: number) => {
        const route = novemberFixtures()[routeIndex]!;
        return run(id, { instanceId: route.instanceId, difficultyId: 7,
          startedAt: start + offset, endedAt: start + offset + 1500,
          players: characters.map(c => ({ character: c.name, realm: "Forever", deaths: 0, presentSec: 1500, inGuild: true, level: 60, minLevel: 60 })),
          encounters: [route.requiredEncounters[0]!, route.completion].map(b => ({ id: b.ids[0], name: b.names[0], at: start + offset + 1400, success: true })) });
      };
      const first = await importDungeonRuns(tx, "g1", [routeRun("nov-first", 0, 0)], characters, "officer", null, now);
      expect(first.results[0]?.playerDetails?.[0]).toMatchObject({ points: 75, participationMode: "full" });
      expect(first.results[0]?.playerDetails?.[0]?.unrankedReason).toBeUndefined();
      Object.assign(runs[0]!, { seasonId: "previous-phase" });
      await importDungeonRuns(tx, "g1", [routeRun("nov-second", 0, 3600)], characters, "officer", null, now);
      await importDungeonRuns(tx, "g1", [routeRun("nov-third", 0, 7200)], characters, "officer", null, now);
      expect(total(points, "m-kev")).toBe(100);
      await importDungeonRuns(tx, "g1", [routeRun("nov-north", 1, 10800)], characters, "officer", null, now);
      expect(total(points, "m-kev")).toBe(175);
      const missing = { ...routeRun("nov-missing", 2, 14400), encounters: [{ id: 9004, name: "Fixture final 2", at: start + 14400 + 1400, success: true }] };
      const result = await importDungeonRuns(tx, "g1", [missing], characters, "officer", null, now);
      expect(result.results[0]?.points).toBe(0);
      expect(result.results[0]?.playerDetails?.[0]?.unrankedReason).toBe("Required encounter evidence missing");
      expect(JSON.stringify(rules)).toBe(before);
    } finally { spy.mockRestore(); }
  });
  it("uses v4 frozen leveling participation, keeps weekly repeats across beta phases, and excludes manual runs", async () => {
    const spy = vi.spyOn(ratingService, "dungeonRating").mockResolvedValue([]);
    try {
      const { tx, points, runs } = fakeTx({ id: "best8", startsAt: new Date(0), ratingRules: bestEightBetaRules() });
      const first = await importDungeonRuns(tx, "g1", [run("v4-first", { difficultyId: 0 })], characters, "officer", null, now);
      expect(first.results[0]?.playerDetails?.[0]).toMatchObject({ points: 75, participationMode: "full", unrankedReason: "Level range not configured" });
      Object.assign(runs[0]!, { seasonId: "archived-beta" });
      const again = start + 3600;
      await importDungeonRuns(tx, "g1", [run("v4-second", { difficultyId: 0, startedAt: again, endedAt: again + 1500 })], characters, "officer", null, now);
      expect(total(points, "m-kev")).toBe(100);
      const third = again + 3600;
      const manual = await importDungeonRuns(tx, "g1", [run("v4-manual", { completedBy: "manual", startedAt: third, endedAt: third + 1500 })], characters, "officer", null, now);
      expect(manual.results[0]?.points).toBe(0);
      await importDungeonRuns(tx, "g1", [run("v4-third", { difficultyId: 0, startedAt: third + 3600, endedAt: third + 5100 })], characters, "officer", null, now);
      expect(total(points, "m-kev")).toBe(100);
      expect(points.every(p => ["rule:completion", "rule:weeklyVariety"].includes(p.source))).toBe(true);
    } finally { spy.mockRestore(); }
  });
  it("counts later uploads in the weekly v4 budget without rewriting already earned points", async () => {
    const spy = vi.spyOn(ratingService, "dungeonRating").mockResolvedValue([]);
    try {
      const { tx, points } = fakeTx({ id: "best8", startsAt: new Date(0), ratingRules: bestEightBetaRules() });
      for (const offset of [7200, 3600, 0]) await importDungeonRuns(tx, "g1", [run(`delayed-${offset}`, {
        difficultyId: 0, startedAt: start + offset, endedAt: start + offset + 1500
      })], characters, "officer", null, now);
      expect(total(points, "m-kev")).toBe(100);
    } finally { spy.mockRestore(); }
  });
  it("awards an account once when two of its alts participate, independent of roster order", async () => {
    const alts = [{ name: "Kev", realm: "Forever", memberId: "m-kev" }, { name: "Alt", realm: "Forever", memberId: "m-kev" }];
    const players = [run("alts").players[0]!, { ...run("alts").players[0]!, character: "Alt", presentSec: 1000 }];
    for (const roster of [players, [...players].reverse()]) {
      const { tx, points } = fakeTx();
      const summary = await importDungeonRuns(tx, "g1", [run("alts", { players: roster })], alts, "officer", null, now);
      expect(total(points, "m-kev")).toBe(100);
      expect(summary.results[0]?.playerDetails?.find(p => p.character === "Alt")).toMatchObject({ points: 0, participationRecipient: "Kev" });
      expect(summary.results[0]?.achievements.filter(a => a.key === "firstBlood")).toHaveLength(1);
    }
  });
  it("requires half-run presence and gives manual completions no bonuses", async () => {
    const { tx, points } = fakeTx();
    const players = run("presence").players.map((p, i) => ({ ...p, presentSec: i === 0 ? 749 : i === 1 ? 750 : 1500 }));
    const result = await importDungeonRuns(tx, "g1", [run("presence", { players, completedBy: "manual" })], characters, "officer", null, now);
    expect(total(points, "m-kev")).toBe(0);
    expect(total(points, "m-bob")).toBe(50);
    expect(points.every(p => p.source === "rule:completion")).toBe(true);
    expect(result.results[0]?.achievements).toEqual([]);
  });

  it("rewards helpers only alongside an eligible member and ignores old carry records", async () => {
    const { tx, points } = fakeTx();
    const carryPlayers = run("carry").players.map((p, i) => ({ ...p, level: i === 0 ? 30 : 20, minLevel: i === 0 ? 30 : 20 }));
    const carry = await importDungeonRuns(tx, "g1", [run("carry", { players: carryPlayers, endedAt: start + 600 })], characters, "officer", null, now);
    expect(carry.results[0]?.playerDetails?.[0]).toMatchObject({ participationMode: "helper", points: 50 });
    expect(carry.results[0]?.guildRecord).toBe(false);
    expect(points.every(p => p.source === "rule:completion")).toBe(true);
    expect(points.find(p => p.memberId === "m-kev")).toMatchObject({ amount: 50 });
    const later = start + 3600;
    const fair = await importDungeonRuns(tx, "g1", [run("fair", { startedAt: later, endedAt: later + 1500 })], characters, "officer", null, now);
    expect(fair.results[0]).toMatchObject({ previousGuildBest: null, guildRecord: false, personalRecords: [] });
    const next = later + 3600;
    const record = await importDungeonRuns(tx, "g1", [run("fair-record", { startedAt: next, endedAt: next + 1200 })], characters, "officer", null, now);
    expect(record.results[0]).toMatchObject({ previousGuildBest: 1500, guildRecord: true });

    const alone = fakeTx();
    const overlevel = run("overlevel").players.map(p => ({ ...p, level: 30, minLevel: 30 }));
    const result = await importDungeonRuns(alone.tx, "g1", [run("overlevel", { players: overlevel })], characters, "officer", null, now);
    expect(result.results[0]?.points).toBe(0);
    expect(alone.points).toHaveLength(0);
  });

  it("separates wing history, records and targets and uses frozen season settings", async () => {
    const band = { min: 15, max: 25, difficultyId: 1 };
    const ratingRules = ratingService.createDungeonRatingRules({ "189:graveyard": 1800, "189:library": 1800 }, 3,
      { "189:graveyard": band, "189:library": band });
    const rating = vi.spyOn(ratingService, "dungeonRating").mockResolvedValue([]);
    try {
      const { tx, points } = fakeTx({ id: "s", startsAt: new Date(0), status: "ACTIVE", ratingRules });
      const wing = (id: string, boss: string, offset: number) => run(id, { instanceId: 189, startedAt: start + offset, endedAt: start + offset + 1500,
        encounters: [{ id: 1, name: boss, success: true, startedAt: start + offset + 1400, at: start + offset + 1500 }] });
      await importDungeonRuns(tx, "g1", [wing("graveyard", "Bloodmage Thalnos", 0)], characters, "officer", null, now);
      const library = await importDungeonRuns(tx, "g1", [wing("library", "Arcanist Doan", 3600)], characters, "officer", null, now);
      expect(library.results[0]).toMatchObject({ previousGuildBest: null, guildRecord: false, personalRecords: [] });
      const secondWing = points.filter(p => p.runId === "run-2" && p.memberId === "m-kev");
      expect(secondWing.find(p => p.source === "rule:firstCompletion")?.amount).toBe(25);
      expect(secondWing.find(p => p.source === "rule:completion")?.amount).toBe(50);
      expect(secondWing.find(p => p.source === "rule:underTarget")?.amount).toBe(20);
      const repeat = await importDungeonRuns(tx, "g1", [wing("graveyard-repeat", "Bloodmage Thalnos", 7200)], characters, "officer", null, now);
      expect(repeat.results[0]?.playerDetails?.[0]?.points).toBeLessThan(140);
      expect(points.find(p => p.runId === "run-3" && p.memberId === "m-kev" && p.source === "rule:completion")?.amount).toBe(25);
    } finally { rating.mockRestore(); }
  });

  it("explains the current run's unranked status even when the character already has a score", async () => {
    const ratingRules = ratingService.createDungeonRatingRules({ "36": 1800 }, 3, { "36": { min: 15, max: 25, difficultyId: 1 } });
    const rating = vi.spyOn(ratingService, "dungeonRating").mockResolvedValue([{ memberId: "m-kev", character: "Kev", name: "Kev", points: 240, dungeons: 1 }]);
    try {
      const { tx } = fakeTx({ id: "s", startsAt: new Date(0), status: "ACTIVE", ratingRules });
      const players = run("short-presence").players.map((p, i) => ({ ...p, presentSec: i === 0 ? 1199 : 1500 }));
      const result = await importDungeonRuns(tx, "g1", [run("short-presence", { players })], characters, "officer", null, now);
      expect(result.results[0]?.playerDetails?.[0]).toMatchObject({ ratingTotal: 240, ratingGain: 0, unrankedReason: "Presence 79% / 80% required" });
      expect(result.results[0]?.playerDetails?.[1]?.unrankedReason).toBeUndefined();
    } finally { rating.mockRestore(); }
  });

  it("reports an alt's own rating gain instead of the first score on their account", async () => {
    const main = { memberId: "m-kev", character: "Main", name: "Main", points: 200, dungeons: 2 };
    const alt = { memberId: "m-kev", character: "Kev", name: "Kev", points: 100, dungeons: 1 };
    const rating = vi.spyOn(ratingService, "dungeonRating")
      .mockResolvedValueOnce([main, alt]).mockResolvedValueOnce([main, { ...alt, points: 200, dungeons: 2 }]);
    try {
      const { tx } = fakeTx({ id: "s", status: "ACTIVE", startsAt: new Date(0), ratingRules: ratingService.DUNGEON_RATING_RULES });
      const result = await importDungeonRuns(tx, "g1", [run("alt-score")], characters, "officer", "imp", now);
      expect(result.results[0]?.playerDetails?.find(p => p.character === "Kev")).toMatchObject({ ratingTotal: 200, ratingGain: 100 });
    } finally { rating.mockRestore(); }
  });
  it("imports replacement players and includes per-player details without inventing deaths", async () => {
    const { tx, points } = fakeTx();
    const players = Array.from({ length: 6 }, (_, i) => ({
      character: i === 0 ? "Kev" : `Guest${i}`, realm: "Forever", class: "PRIEST", role: "HEALER",
      deaths: i === 0 ? 0 : null, presentSec: 1200, inGuild: false, level: 20, minLevel: 20
    }));
    const summary = await importDungeonRuns(tx, "g1", [run("replacement", { players, completedBy: "final boss" })], characters, "officer", "imp1", now);
    expect(summary.results[0]).toMatchObject({ valid: true, endedAt: start + 1500, completedBy: "final boss", points: 100 });
    expect(summary.results[0]?.playerDetails?.[0]).toMatchObject({ character: "Kev", role: "HEALER", deaths: 0, points: 100 });
    expect(summary.results[0]?.playerDetails?.[1]).toMatchObject({ deaths: null, points: 0 });
    expect(points.every((point) => point.memberId === "m-kev")).toBe(true);
    expect(summary.results[0]?.achievements.some((a) => a.key === "noOneDies")).toBe(false);
  });
  it("stores a completed run and awards points to every linked player", async () => {
    const { tx, runs, points } = fakeTx();
    const summary = await importDungeonRuns(tx, "g1", [run("run-a")], characters, "officer", "imp1", now);
    expect(runs).toHaveLength(1);
    expect(summary.results[0]).toMatchObject({ valid: true, durationSec: 1500, guildRecord: false });
    // completion 50 + no deaths 25 + first completion 25 + full guild group 20
    expect(total(points, "m-kev")).toBe(120);
    expect(new Set(points.map((row) => row.memberId)).size).toBe(5);
  });

  it("skips a run it already has, and the same run reported by a second member", async () => {
    const { tx, runs, points } = fakeTx();
    await importDungeonRuns(tx, "g1", [run("run-a")], characters, "officer", "imp1", now);
    const before = points.length;
    const again = await importDungeonRuns(tx, "g1", [run("run-a"), run("r1-other-reporter", { startedAt: start + 40, endedAt: start + 1530 })],
      characters, "officer", "imp2", now);
    expect(again.duplicates).toBe(2);
    expect(runs).toHaveLength(1);
    expect(points.length).toBe(before);
  });

  it("keeps invalid and malformed runs out of the points", async () => {
    const { tx, runs, points } = fakeTx();
    const summary = await importDungeonRuns(tx, "g1", [run("fast", { endedAt: start + 60 }), { id: "broken" }], characters, "officer", "imp1", now);
    expect(summary.malformed).toBe(1);
    expect(summary.results[0]).toMatchObject({ valid: false });
    expect(runs[0]?.valid).toBe(false);
    expect(points).toHaveLength(0);
  });

  it("gives no points for abandoned runs", async () => {
    const { tx, points } = fakeTx();
    const summary = await importDungeonRuns(tx, "g1", [run("left", { state: "ABANDONED" })], characters, "officer", "imp1", now);
    expect(summary.results[0]).toMatchObject({ state: "ABANDONED", points: 0 });
    expect(points).toHaveLength(0);
  });

  it("detects guild and personal records and reduces repeat points in the same week", async () => {
    const { tx, points } = fakeTx();
    await importDungeonRuns(tx, "g1", [run("run-a")], characters, "officer", "imp1", now);
    const later = start + 3600;
    const faster = await importDungeonRuns(tx, "g1", [run("run-b", { startedAt: later, endedAt: later + 1200 })], characters, "officer", "imp2", now);
    const result = faster.results[0];
    expect(result).toMatchObject({ guildRecord: true, previousGuildBest: 1500 });
    expect(result?.personalRecords).toHaveLength(5);
    const second = points.filter((row) => row.runId === "run-2" && row.memberId === "m-kev");
    expect(second.some((row) => row.source === "rule:firstCompletion")).toBe(false);
    // Second clear this week is worth half: (50 + 25 + 15 + 25 + 20) / 2, rounded per rule.
    expect(second.reduce((sum, row) => sum + row.amount, 0)).toBeLessThan(120);
  });

  it("records unlinked players without giving them points", async () => {
    const { tx, points } = fakeTx();
    const players = [...run("run-a").players.slice(0, 4), { character: "Pugsy", realm: "Forever", deaths: 0, presentSec: 1500, inGuild: false, level: 20, minLevel: 20 }];
    const summary = await importDungeonRuns(tx, "g1", [run("run-a", { players })], characters, "officer", "imp1", now);
    expect(summary.results[0]?.unlinked).toEqual(["Pugsy"]);
    expect(points.some((row) => row.source === "rule:fullGuildGroup")).toBe(false);
  });
});

describe("dungeon achievements", () => {
  it("are earned once each, from the run that qualified", async () => {
    const { tx, achievements } = fakeTx();
    const first = await importDungeonRuns(tx, "g1", [run("run-a")], characters, "officer", "imp1", now);
    const kev = (key: string) => achievements.filter((row) => row.memberId === "m-kev" && row.key === key);
    // Everyone tracked with 0 deaths and a full guild group: three at once.
    expect(first.results[0]?.achievements.filter((a) => a.character === "Kev").map((a) => a.key).sort()).toEqual(["firstBlood", "guildSquad", "noOneDies"]);
    const later = start + 3600;
    const second = await importDungeonRuns(tx, "g1", [run("run-b", { startedAt: later, endedAt: later + 1200 })], characters, "officer", "imp2", now);
    expect(second.results[0]?.achievements.map((a) => a.key)).toEqual(["recordBreaker", "recordBreaker", "recordBreaker", "recordBreaker", "recordBreaker"]);
    expect(kev("firstBlood")).toHaveLength(1);
    expect(kev("recordBreaker")[0]?.runId).toBe("run-2");
  });

  it("No One Dies needs every player tracked", async () => {
    const { tx } = fakeTx();
    const players = run("run-a").players.map((player, i) => (i === 4 ? { ...player, deaths: null } : player));
    const summary = await importDungeonRuns(tx, "g1", [run("run-a", { players })], characters, "officer", "imp1", now);
    expect(summary.results[0]?.achievements.some((a) => a.key === "noOneDies")).toBe(false);
  });
});

 it("retains a late finish without giving post-cutoff participation points", async () => {
  const cutoff = new Date((start + 1000) * 1000);
  const { tx, runs, points } = fakeTx({ id: "ended-window", startsAt: new Date((start - 1) * 1000), endsAt: cutoff });
  const result = await importDungeonRuns(tx, "g", [{ id: "cutoff-run", protocolVersion: 1, instanceId: 36, name: "Test", state: "COMPLETED",
    startedAt: start, endedAt: start + 1000, completedBy: "final boss", players: [{ character: "Kev", realm: "Forever", presentSec: 1000, inGuild: true }] }], characters, "test", null, now);
  expect(runs).toHaveLength(1);
  expect(result.results[0]?.points).toBe(0);
  expect(points).toHaveLength(0);
 });
