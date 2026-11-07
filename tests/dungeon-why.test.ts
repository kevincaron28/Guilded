import { describe, expect, it } from "vitest";
import { provisionalSeasonRules } from "../src/services/dungeon-bracket-season.js";
import { explainDungeonRuns } from "../src/services/dungeon-explain.js";
import { participationMode, unmappedMap, type ParticipationRun } from "../src/services/dungeon-participation.js";

// Season 1 guild boards: a clear of a map the season has no route for still earns completion points;
// estimated targets never hide a run; the officer view says why.
const rules = provisionalSeasonRules().rules;
const start = new Date("2026-11-10T20:00:00Z");
function run(instanceId: number, over: Partial<ParticipationRun> = {}): ParticipationRun {
  return { instanceId, difficultyId: 0, durationSec: 1500, completedBy: "final boss", startedAt: start, endedAt: new Date(start.getTime() + 1500_000), createdAt: start,
    competitionData: { players: [{ name: "Kev", level: 16, minLevel: 16 }], encounters: []},
    players: [{ character: "Kev", memberId: "m1", presentSec: 1500 }], ...over };
}

describe("participation for maps the season has no route for", () => {
  it("gives completion points for a detected final boss on an unrouted map (Drowned City, level 60 maps...)", () => {
    expect(unmappedMap(run(99999), rules)).toBe(true);
    expect(participationMode(run(99999), "Kev", undefined, rules)).toBe("completion");
  });
  it("keeps refusing manual completions, low presence and ambiguous or mismatched routed maps", () => {
    expect(participationMode(run(99999, { completedBy: "manual" }), "Kev", undefined, rules)).toBe("none");
    expect(participationMode(run(99999, { players: [{ character: "Kev", memberId: "m1", presentSec: 100 }] }), "Kev", undefined, rules)).toBe("none");
    // Ragefire is routed, but only at difficulty 0: another difficulty is not guessed into it.
    expect(unmappedMap(run(389, { difficultyId: 5 }), rules)).toBe(false);
    expect(participationMode(run(389, { difficultyId: 5 }), "Kev", undefined, rules)).toBe("none");
  });
  it("still gives a routed map its full mode", () => {
    expect(participationMode(run(389), "Kev", rules.participationLevelBands["389"], rules)).toBe("full");
  });
});

describe("/dungeon-admin audit why:true", () => {
  const row = (over: Record<string, unknown> = {}) => ({ id: "r1", runRef: "QG-1", dungeonName: "Ragefire Chasm", instanceId: 389, difficultyId: 0, state: "COMPLETED", valid: true, invalidReason: null,
    startedAt: start, endedAt: new Date(start.getTime() + 1500_000), createdAt: start, durationSec: 1500, completedBy: "final boss", seasonId: "s1",
    competitionData: { players: [{ name: "Kev", level: 16, minLevel: 16 }, { name: "Pug", level: 16, minLevel: 16 }], encounters: [] },
    players: [{ character: "Kev", memberId: "m1", presentSec: 1500, inGuild: true }, { character: "Pug", memberId: null, presentSec: 500, inGuild: false }], ...over });
  const db = (rows: unknown[]) => ({ dungeonRun: { findMany: async () => rows }, dungeonSeason: { findUnique: async () => ({ id: "s1", name: "Season 1", startsAt: new Date("2026-11-04T23:00:00Z"), endsAt: null, ratingRules: rules }) }, character: {} }) as never;

  it("says a run counts, that its estimate scales points, and why a player is not on the board", async () => {
    const text = (await explainDungeonRuns(db([row()]), "g1", {})).join("\n");
    expect(text).toContain("Run: rated on route 389");
    expect(text).toContain("an estimate: it scales points, it never hides a run");
    expect(text).toContain("**Kev** — in guild · linked · present 100%");
    expect(text).toContain("**Pug** — outside the guild · NOT linked to a member");
    expect(text).toContain("time board needs 50%");
  });
  it("names the blocking reason for an unrouted map, a manual finish and an early start", async () => {
    const text = (await explainDungeonRuns(db([row({ instanceId: 99999, completedBy: "manual", startedAt: new Date("2026-11-01T00:00:00Z") })]), "g1", {})).join("\n");
    expect(text).toContain('ended by "manual"');
    expect(text).toContain("started before Season 1 began");
    expect(text).toContain("has no route in Season 1");
  });
  it("answers plainly when nothing matches", async () => {
    expect((await explainDungeonRuns(db([]), "g1", {}))[0]).toContain("No stored run matches");
  });
});
