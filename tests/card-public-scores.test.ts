import { describe, expect, it } from "vitest";
import type { DungeonImportResult } from "../src/services/dungeon-import.js";
import { applyPublicScores, publicCardScore } from "../src/services/card-public-scores.js";
import { publicSeasons, type ScoreRun } from "../src/services/public-score.js";

// A season run carries current evidence (completion, start, presence).
const run = (id: string, durationSec: number, role: string, over: Partial<ScoreRun> = {}): ScoreRun => {
  const endedAt = over.endedAt ?? new Date("2026-11-10T20:00:00Z");
  return { runId: id, instanceId: 389, routeKey: null, difficultyId: 0, dungeonName: "Ragefire Chasm", durationSec, endedAt, confirmations: 1,
    evidence: { startedAt: new Date(endedAt.getTime() - durationSec * 1000), completedBy: "final boss", encounters: [] },
    players: [{ character: "Muffcakes", realm: "Doomhowl", className: "Warrior", role, level: 16, minLevel: 16, presentSec: durationSec }], ...over };
};
const periods = publicSeasons(new Date("2026-11-15T12:00:00Z"));
const me = { character: "Muffcakes", realm: "Doomhowl" };

describe("public score on a run card (players outside the guild)", () => {
  it("returns the public season total and what this run added", () => {
    const runs = [run("old", 1500, "TANK"), run("this", 1200, "TANK")];
    expect(publicCardScore(runs, "this", me, "TANK", periods)).toEqual({ total: 200, gain: 40 });
  });

  it("adds nothing when an earlier run already scored as high", () => {
    const runs = [run("old", 1200, "TANK", { endedAt: new Date("2026-11-09T20:00:00Z") }), run("this", 1500, "TANK")];
    expect(publicCardScore(runs, "this", me, "TANK", periods)).toEqual({ total: 200, gain: 0 });
  });

  it("uses the role's score when the character has one, else the overall score", () => {
    const runs = [run("a", 1200, "HEALER", { endedAt: new Date("2026-11-09T20:00:00Z") }), run("this", 1500, "TANK")];
    expect(publicCardScore(runs, "this", me, "TANK", periods)).toEqual({ total: 160, gain: 160 });
    expect(publicCardScore(runs, "this", me, null, periods)).toEqual({ total: 200, gain: 0 });
  });

  it("is null when the run is not in the character's public history or is not rated", () => {
    expect(publicCardScore([run("other", 1200, "TANK")], "this", me, "TANK", periods)).toBeNull();
    expect(publicCardScore([run("this", 1200, "TANK", { difficultyId: 1 })], "this", me, "TANK", periods)).toBeNull();
  });
});

describe("applyPublicScores", () => {
  const fake = (published: boolean) => ({
    officialSeason: { findMany: async () => [] },
    publicRun: { findUnique: async () => (published ? { id: "this" } : null) },
    publicRunPlayer: { findMany: async () => [{ character: "Muffcakes", displayName: "Abominable Muffcakes", realm: "Doomhowl" }, { character: "Other", displayName: null, realm: "" }] }
  });
  const result = () => ({ runRef: "R1", instanceId: 389, players: ["El Pirata", "Muffcakes"], unlinked: ["Muffcakes"], inGuildPlayers: [] as string[], fullNames: { Muffcakes: "Abominable Muffcakes" },
    playerDetails: [{ character: "El Pirata", role: "DPS" }, { character: "Muffcakes", role: "TANK", ratingTotal: 5, ratingGain: 5 }] }) as unknown as DungeonImportResult;
  const store = { characterRuns: async () => [run("old", 1500, "TANK"), run("this", 1200, "TANK")] } as never;

  it("replaces the guild-run numbers of a player with a public match, by full name and realm", async () => {
    const r = result();
    expect(await applyPublicScores(fake(true) as never, [r], new Date("2026-11-15T12:00:00Z"), store)).toBe(1);
    expect(r.playerDetails![1]).toMatchObject({ ratingTotal: 200, ratingGain: 40 });
  });

  it("keeps the guild-run numbers when the run is not public", async () => {
    const r = result();
    expect(await applyPublicScores(fake(false) as never, [r], new Date("2026-11-15T12:00:00Z"), store)).toBe(0);
    expect(r.playerDetails![1]).toMatchObject({ ratingTotal: 5, ratingGain: 5 });
  });
});
