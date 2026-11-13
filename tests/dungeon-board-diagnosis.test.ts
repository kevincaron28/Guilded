import { describe, expect, it } from "vitest";
import { boardDiagnosisReport, diagnoseRuns, emptyBoardNote, whyNotOnBoard, type DiagnosedRun } from "../src/services/dungeon-board-diagnosis.js";
import { provisionalSeasonRules } from "../src/services/dungeon-bracket-season.js";

const season = { id: "s1", name: "Season 1", startsAt: new Date("2026-11-04T23:00:00Z"), endsAt: null, status: "ACTIVE", ratingRules: provisionalSeasonRules().rules };
const start = new Date("2026-11-08T20:00:00Z");
const run = (over: Partial<DiagnosedRun> = {}): DiagnosedRun => ({
  id: "r1", runRef: "QG-1", dungeonName: "Gnomeregan", seasonId: "s1", valid: true, invalidReason: null, state: "COMPLETED", completedBy: "final boss",
  durationSec: 2700, startedAt: start, endedAt: new Date(start.getTime() + 2700_000), createdAt: new Date(start.getTime() + 2800_000), instanceId: 90, difficultyId: 0,
  competitionData: { players: [{ name: "Kev", level: 30, minLevel: 30 }], encounters: [] },
  players: [{ character: "Kev", memberId: "m1", presentSec: 2700, inGuild: true, member: { guildId: "g1" } }], ...over
});

describe("why a stored dungeon run is not on the board", () => {
  it("counts a normal linked, in-season, final-boss run", () => expect(whyNotOnBoard(run(), season, "g1")).toBeNull());
  it("names each first blocker", () => {
    expect(whyNotOnBoard(run({ valid: false, invalidReason: "too short (10s)" }), season, "g1")).toMatch(/rejected by the bot \(too short/);
    expect(whyNotOnBoard(run({ completedBy: "manual" }), season, "g1")).toMatch(/final boss kill was not detected/);
    expect(whyNotOnBoard(run({ seasonId: "old" }), season, "g1", new Map([["old", "Beta"]]))).toBe("stored under Beta");
    expect(whyNotOnBoard(run({ startedAt: new Date("2026-11-04T10:00:00Z") }), season, "g1")).toMatch(/started before Season 1/);
    expect(whyNotOnBoard(run({ difficultyId: 1 }), season, "g1")).toMatch(/route could not be identified/);
    expect(whyNotOnBoard(run({ players: [{ character: "Kev", memberId: "m1", presentSec: 300, inGuild: true, member: { guildId: "g1" } }] }), season, "g1")).toMatch(/nobody was in the run/);
    expect(whyNotOnBoard(run({ players: [{ character: "Kev", memberId: null, presentSec: 2700, inGuild: false, member: null }] }), season, "g1")).toMatch(/no player is linked/);
  });
  it("still lists an unlinked guildmate the addon flagged", () => {
    expect(whyNotOnBoard(run({ players: [{ character: "Kev", memberId: null, presentSec: 2700, inGuild: true, member: null }] }), season, "g1")).toBeNull();
  });
  it("summarises, orders reasons and writes the empty-board line", () => {
    const d = diagnoseRuns([run({ completedBy: "manual" }), run({ completedBy: "manual" }), run({ difficultyId: 1 })], season, "g1");
    expect(d).toMatchObject({ received: 3, counted: 0, reasons: [{ runs: 2 }, { runs: 1 }] });
    expect(emptyBoardNote(d, "en")).toMatch(/3 received, none counted \(2 × the final boss kill was not detected/);
    expect(emptyBoardNote(d, "fr")).toMatch(/3 reçu\(s\)/);
    expect(boardDiagnosisReport("QG", d)).toMatch(/3 run\(s\) received, 0 on the board/);
  });
  it("says nothing was received, and nothing when a run counts", () => {
    expect(emptyBoardNote(diagnoseRuns([], season, "g1"), "en")).toMatch(/No dungeon run has reached the bot/);
    // (9.3) Signing in with Discord has been optional since the zero-setup companion (9.1.0): the text must not ask for it.
    const empty = { en: emptyBoardNote(diagnoseRuns([], season, "g1"), "en") ?? "", fr: emptyBoardNote(diagnoseRuns([], season, "g1"), "fr") ?? "" };
    expect(empty.en).toContain("optional");
    expect(empty.en).not.toMatch(/must be signed in/);
    expect(empty.fr).toContain("facultative");
    expect(empty.fr).not.toMatch(/doit être connecté/);
    expect(emptyBoardNote(diagnoseRuns([run()], season, "g1"), "en")).toBeNull();
    expect(diagnoseRuns([run()], null, "g1").reasons[0]!.reason).toBe("no season is running");
  });
});
