import { describe, expect, it } from "vitest";
import type { PrismaClient } from "../src/generated/prisma/client.js";
import { BOSS_SCORING_V1, bossRuleText } from "../src/services/dungeon-boss-scoring.js";
import { createBracketedDungeonRules, reviseRules, validBracketedRules, type BracketedRules } from "../src/services/dungeon-november-rules.js";
import { publicRules, snapshotRules, type ScoreRun } from "../src/services/public-score.js";
import { applyRulesChange, planRulesChange, restoreLastChange, revisionsOf, RulesChangeError } from "../src/services/season-rules-change.js";
import { impactLines, rulesImpact } from "../src/services/season-rules-impact.js";

// Owner decision, 14 November 2026: the running season's rules can change (reversibly, on the record); stored runs never do.

const DC = 2970;
const ALL = [3474, 3475, 3476, 3478, 3479, 3511];
function rulesWithCity(): BracketedRules {
  const base = publicRules();
  const model = base.routes.find((route) => route.targetSec !== null && route.completionModel === "addon-final-boss")!;
  const route = { ...model, dungeonKey: String(DC), instanceId: DC, name: "The Drowned City", targetSec: 2400 };
  return createBracketedDungeonRules({ routes: [...base.routes.filter((r) => r.instanceId !== DC), route], brackets: base.brackets, overlevelPenalty: base.overlevelPenalty, provisional: base.provisional, leniency: 1 });
}

// A small in-memory stand-in for the three tables the change touches.
function fakeDatabase(now: Date) {
  const rules = rulesWithCity();
  const state = {
    official: [
      { id: "o1", number: 1, name: "Season 1", startsAt: new Date("2026-11-04T23:00:00Z"), rules: snapshotRules(rules, new Date("2026-11-04T23:00:00Z")) as unknown },
      { id: "o0", number: 0, name: "Old season", startsAt: new Date("2026-09-01T00:00:00Z"), rules: snapshotRules(rules, new Date("2026-09-01T00:00:00Z")) as unknown }
    ],
    guild: [
      { id: "g1", guildId: "A", name: "Season 1", status: "ACTIVE", startsAt: new Date("2026-11-04T23:00:00Z"), ratingRules: rules as unknown },
      { id: "g2", guildId: "B", name: "Season 1", status: "ACTIVE", startsAt: new Date("2026-11-04T23:00:00Z"), ratingRules: rules as unknown },
      { id: "gOld", guildId: "A", name: "Old season", status: "ENDED", startsAt: new Date("2026-09-01T00:00:00Z"), ratingRules: rules as unknown }
    ]
  };
  const db = {
    officialSeason: {
      findMany: async () => state.official.map((r) => ({ ...r })),
      findUnique: async ({ where }: { where: { id: string } }) => state.official.find((r) => r.id === where.id) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: { rules: unknown } }) => { state.official.find((r) => r.id === where.id)!.rules = JSON.parse(JSON.stringify(data.rules)); }
    },
    dungeonSeason: {
      findMany: async ({ where }: { where: { status: string; startsAt: { gte: Date } } }) => state.guild.filter((s) => s.status === where.status && s.startsAt >= where.startsAt.gte),
      findUnique: async ({ where }: { where: { id: string } }) => state.guild.find((s) => s.id === where.id) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: { ratingRules: unknown } }) => { state.guild.find((s) => s.id === where.id)!.ratingRules = JSON.parse(JSON.stringify(data.ratingRules)); }
    },
    $transaction: async <T>(fn: (tx: unknown) => Promise<T>) => fn(db)
  };
  return { db: db as unknown as PrismaClient, state, now };
}
const NOW = new Date("2026-11-15T12:00:00Z");
const ON = { bossScoring: { ...BOSS_SCORING_V1, since: NOW.toISOString() } };

describe("changing the running season's rules", () => {
  it("replaces the running season's rules and every guild's copy, and records who, when and from what", async () => {
    const { db, state } = fakeDatabase(NOW);
    const done = await applyRulesChange(db, ON, { by: "owner", note: "boss skips", now: NOW });
    expect(done?.revision).toMatchObject({ action: "change", by: "owner", from: "version 6", to: "version 6 + boss-skip v1", guilds: 2 });
    const official = state.official.find((r) => r.id === "o1")!.rules as { rules: BracketedRules };
    expect(official.rules.bossScoring).toEqual({ version: 1, since: NOW.toISOString() });
    expect(validBracketedRules(official.rules)).toBe(true);
    expect((state.guild[0]!.ratingRules as BracketedRules).bossScoring?.version).toBe(1);
    expect((state.guild[1]!.ratingRules as BracketedRules).bossScoring?.version).toBe(1);
    expect(revisionsOf(state.official[0]!.rules)).toHaveLength(1);
  });

  it("leaves past seasons, targets, routes and brackets exactly as they were", async () => {
    const { db, state } = fakeDatabase(NOW);
    const before = structuredClone(state);
    await applyRulesChange(db, ON, { by: "owner", note: "", now: NOW });
    expect(state.official.find((r) => r.id === "o0")).toEqual(before.official.find((r) => r.id === "o0"));
    expect(state.guild.find((s) => s.id === "gOld")!.ratingRules).toEqual(before.guild.find((s) => s.id === "gOld")!.ratingRules);
    const changed = (state.official.find((r) => r.id === "o1")!.rules as { rules: BracketedRules }).rules;
    const rest: Partial<BracketedRules> = { ...changed };
    delete rest.bossScoring;
    expect(rest).toEqual((before.official.find((r) => r.id === "o1")!.rules as { rules: BracketedRules }).rules);
  });

  it("refuses when the season has ended, and does nothing when the rule is already on", async () => {
    const { db } = fakeDatabase(NOW);
    await expect(planRulesChange(db, ON, new Date("2026-08-01T00:00:00Z"))).rejects.toThrow(RulesChangeError);
    await applyRulesChange(db, ON, { by: "owner", note: "", now: NOW });
    expect(await applyRulesChange(db, { bossScoring: { ...BOSS_SCORING_V1, since: "2026-12-01T00:00:00.000Z" } }, { by: "owner", note: "", now: NOW })).toBeNull();
  });

  it("restores the exact previous rules, records the restore, and cannot be undone twice", async () => {
    const { db, state } = fakeDatabase(NOW);
    const original = JSON.parse(JSON.stringify((state.official[0]!.rules as { rules: BracketedRules }).rules));
    await applyRulesChange(db, ON, { by: "owner", note: "", now: NOW });
    const undone = await restoreLastChange(db, { by: "owner", now: new Date("2026-11-16T00:00:00Z") });
    expect(undone?.revision).toMatchObject({ action: "restore", from: "version 6 + boss-skip v1", to: "version 6" });
    expect((state.official[0]!.rules as { rules: BracketedRules }).rules).toEqual(original);
    expect((state.guild[0]!.ratingRules as BracketedRules).bossScoring).toBeUndefined();
    expect(revisionsOf(state.official[0]!.rules).map((r) => r.action)).toEqual(["change", "restore"]);
    await expect(restoreLastChange(db, { by: "owner", now: NOW })).rejects.toThrow("no change to undo");
  });
});

describe("the dry run", () => {
  const off = rulesWithCity();
  const on = reviseRules(off, { bossScoring: BOSS_SCORING_V1 });
  const START = new Date("2026-11-14T02:00:00Z");
  function run(id: string, character: string, durationSec: number, ids: number[]): ScoreRun {
    const band = off.levelBands[String(DC)]!;
    const base = Math.floor(START.getTime() / 1000);
    const encounters = ids.map((boss, i) => ({ id: boss, name: `Boss ${boss}`, success: true, at: base + 100 + i * 60, startedAt: base + 50 + i * 60 }));
    return { runId: id, instanceId: DC, routeKey: null, difficultyId: band.difficultyId, dungeonName: "The Drowned City", durationSec, endedAt: new Date(START.getTime() + durationSec * 1000), confirmations: 1,
      evidence: { startedAt: START, completedBy: "final boss", encounters },
      players: [{ character, realm: "Doomhowl", className: null, role: null, level: band.min, minLevel: band.min, presentSec: durationSec }] };
  }
  it("shows old and new score and the rank moves, per dungeon and per bracket, without touching the runs", () => {
    const runs = [run("1", "Skipper", 1200, [3474, 3479]), run("2", "Clearer", 2400, ALL)];
    const frozen = structuredClone(runs);
    const impact = rulesImpact(runs, off, on, 20);
    expect(impact.dungeons[0]).toMatchObject({ key: DC, runs: 2, changed: 1, skipped: 1, pointsLost: 333 });
    const rows = [...impact.top.values()][0]!;
    expect(rows.find((r) => r.character === "Skipper")).toMatchObject({ before: 400, after: 67, rankBefore: 1, rankAfter: 2 });
    expect(rows.find((r) => r.character === "Clearer")).toMatchObject({ before: 200, after: 200, rankBefore: 2, rankAfter: 1 });
    expect(impactLines(impact, 20).join("\n")).toContain("400 -> 67");
    expect(runs).toEqual(frozen);
  });
});

describe("the public wording", () => {
  it("states the rule in plain words and the date it started", () => {
    expect(bossRuleText("en", { since: "2026-11-15T12:00:00.000Z" })).toMatch(/skipping never beats a full clear.*In force since 2026-11-15/);
    expect(bossRuleText("fr", { since: "2026-11-15T12:00:00.000Z" })).toContain("En vigueur depuis le 2026-11-15");
    expect(bossRuleText("en", BOSS_SCORING_V1)).not.toContain("In force since");
  });
});
