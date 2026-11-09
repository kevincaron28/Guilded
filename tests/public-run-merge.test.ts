import { describe, expect, it } from "vitest";
import { normalizeLeaderRuns, sameRun } from "../src/services/public-run-merge.js";
import { onRoster, rankCharacters, type LeaderPlayer, type LeaderRun } from "../src/services/public-leaderboard.js";

const END = new Date("2026-11-05T02:00:00Z");
const player = (character: string, extra: Partial<LeaderPlayer> = {}): LeaderPlayer =>
  ({ character, realm: "", className: "Warrior", role: "DAMAGER", level: 20, presentSec: 1600, ...extra });
function run(runId: string, players: LeaderPlayer[], extra: Partial<LeaderRun> = {}): LeaderRun {
  return { runId, instanceId: 389, routeKey: "389", difficultyId: 1, dungeonName: "Ragefire Chasm", durationSec: 1636, endedAt: END, confirmations: 1,
    deaths: null, bracket: "15-29", season: "2026-Q4", players, evidence: null, ...extra };
}
const names = (r: LeaderRun) => r.players.map((p) => p.displayName || p.character);

// The two rows the website showed for one Ragefire Chasm clear (27:16 and 27:17).
const first = () => run("run-a", ["Hulke Hogan", "Crashing Pally", "Mister Haragot", "Xaldin", "El Pirata"].map((n) => player(n)));
const second = () => run("run-b", [
  player("El Pirata"), player("Hulke Hogan"), player("Hulke", { displayName: "Hulke Hogan" }), player("Mister Haragot"),
  player("Xaldin"), player("Xaldin Xaldin"), player("El"), player("Crashing Pally")
], { durationSec: 1637, endedAt: new Date(END.getTime() + 1000), confirmations: 1 });

describe("one row per real run", () => {
  it("merges the 27:16 and 27:17 observer copies into one run with a 5-player party", () => {
    const merged = normalizeLeaderRuns([first(), second()]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.mergedIds).toEqual(["run-a", "run-b"]);
    expect(names(merged[0]!).sort()).toEqual(["Crashing Pally", "El Pirata", "Hulke Hogan", "Mister Haragot", "Xaldin"]);
    expect(merged[0]!.confirmations).toBe(2);
  });
  it("lists nobody twice inside a single stored copy of 8 entries", () => {
    const [only] = normalizeLeaderRuns([second()]);
    expect(only!.players).toHaveLength(5);
    expect(names(only!).sort()).toEqual(["Crashing Pally", "El Pirata", "Hulke Hogan", "Mister Haragot", "Xaldin"]);
  });
  it("keeps real back-to-back clears of the same dungeon apart", () => {
    const later = run("run-c", first().players, { endedAt: new Date(END.getTime() + 2000_000) });
    expect(normalizeLeaderRuns([first(), later])).toHaveLength(2);
  });
  it("keeps another party's simultaneous clear of the same dungeon apart", () => {
    const other = run("run-d", ["Aaa Bbb", "Ccc Ddd", "Eee Fff", "Ggg Hhh", "Iii Jjj"].map((n) => player(n)), { endedAt: new Date(END.getTime() + 1000) });
    expect(normalizeLeaderRuns([first(), other])).toHaveLength(2);
    expect(sameRun(first(), other)).toBe(false);
  });
  it("does not merge other dungeons or difficulties", () => {
    expect(normalizeLeaderRuns([first(), run("run-e", first().players, { instanceId: 36, routeKey: "36" })])).toHaveLength(2);
    expect(normalizeLeaderRuns([first(), run("run-f", first().players, { difficultyId: 2 })])).toHaveLength(2);
  });
  it("shows the best report: the one with evidence leads and the merged run keeps its id", () => {
    const evidence = { startedAt: new Date(END.getTime() - 1636_000), completedBy: "final boss", encounters: [] };
    const merged = normalizeLeaderRuns([first(), { ...second(), evidence }]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.runId).toBe("run-b");
    expect(merged[0]!.evidence).toBe(evidence);
  });
});

describe("one row per real player on the character board", () => {
  it("ranks El Pirata, Hulke Hogan and Xaldin once each, however an upload spelled them", () => {
    const bare = run("run-g", [player("El"), player("Hulke"), player("Xaldin Xaldin"), player("Crashing Pally"), player("Mister Haragot")],
      { instanceId: 36, routeKey: "36", dungeonName: "The Deadmines", durationSec: 1500, endedAt: new Date(END.getTime() + 3600_000) });
    const board = rankCharacters(normalizeLeaderRuns([first(), bare]), { className: null, role: null, confirmed: false });
    const shown = board.map((entry) => entry.player.displayName || entry.player.character);
    expect(shown.sort()).toEqual(["Crashing Pally", "El Pirata", "Hulke Hogan", "Mister Haragot", "Xaldin"]);
    expect(new Set(shown).size).toBe(shown.length);
  });
  it("leaves a first name alone when two different full names share it", () => {
    const rows = normalizeLeaderRuns([run("run-h", [player("Hulke Hogan"), player("Hulke Smith"), player("Hulke")])]);
    expect(names(rows[0]!).sort()).toEqual(["Hulke", "Hulke Hogan", "Hulke Smith"]);
  });
  it("resolves a shared first name inside its own party (owner report: El and El Pirata)", () => {
    // "El Veneking" elsewhere makes "El" ambiguous guild-wide, but this party has only one "El ...".
    const other = run("run-i", [player("El Veneking"), player("Aaa Bbb")], { instanceId: 43, routeKey: "43", dungeonName: "Wailing Caverns", endedAt: new Date(END.getTime() + 7200_000) });
    const party = run("run-j", [player("El Pirata"), player("Hulke Hogan"), player("Mister Haragot"), player("Xaldin"), player("El"), player("Crashing Pally")]);
    const rows = normalizeLeaderRuns([other, party]);
    const rfc = rows.find((r) => r.instanceId === 389)!;
    expect(names(rfc).sort()).toEqual(["Crashing Pally", "El Pirata", "Hulke Hogan", "Mister Haragot", "Xaldin"]);
    // A different class is a different character: no merge.
    const mixed = normalizeLeaderRuns([other, run("run-k", [player("El Pirata"), player("El", { className: "Priest" })])]);
    expect(names(mixed.find((r) => r.runId === "run-k")!).sort()).toEqual(["El", "El Pirata"]);
  });
  it("remembers the older name so a guild roster that lists the first name still matches", () => {
    const [merged] = normalizeLeaderRuns([first(), second()]);
    const hulke = merged!.players.find((p) => p.character === "Hulke Hogan")!;
    expect(hulke.aliases).toContain("hulke");
    expect(onRoster(new Set(["hulke"]), hulke, "forever")).toBe(true);
    expect(onRoster(new Set(["hulke hogan"]), hulke, "forever")).toBe(true);
    expect(onRoster(new Set(["someone else"]), hulke, "forever")).toBe(false);
  });
});
