import { describe, expect, it } from "vitest";
import { climbers, dungeonMilestones, newcomers, rankMovement, recordsBroken } from "../src/services/leaderboard-highlights.js";
import { emptyBox, hubTabs, movement, podium, trendBars } from "../src/services/leaderboard-hub.js";
import { publicRules, type ScoreRun } from "../src/services/public-score.js";

const t = (en: string, fr: string) => en + "|" + fr;
const tEn = (en: string) => en;
const rules = publicRules();
const bracket = rules.brackets[0]!.key as string;
const run = (id: string, name: string, sec: number, endedAt: string): ScoreRun => ({
  runId: id, instanceId: 389, routeKey: null, difficultyId: 0, dungeonName: "Ragefire Chasm", durationSec: sec, endedAt: new Date(endedAt), confirmations: 1,
  players: [{ character: name, realm: "Doomhowl", className: "Warrior", role: "TANK", level: 16, minLevel: 16, presentSec: sec }],
  evidence: { startedAt: new Date(new Date(endedAt).getTime() - sec * 1000), completedBy: "final boss", encounters: [] }
});

describe("leaderboard hub pieces", () => {
  it("lays the podium out 2-1-3 and escapes names", () => {
    const html = podium([{ name: "A<b>", href: "/a", value: "300" }, { name: "B", href: "/b", value: "200" }, { name: "C", href: "/c", value: "100" }]);
    expect(html.indexOf("#2")).toBeLessThan(html.indexOf("#1"));
    expect(html.indexOf("#1")).toBeLessThan(html.indexOf("#3"));
    expect(html).toContain("A&lt;b&gt;");
    expect(podium([])).toBe("");
    expect(podium([{ name: "Solo", href: "/s", value: "5" }])).toContain("#1");
  });
  it("marks the current tab and keeps the language in the links", () => {
    const html = hubTabs(tEn, "fr", "duels");
    expect(html).toContain('/leaderboards/duels/?lang=fr" class="on" aria-current="page"');
    expect(html).toContain("/leaderboards/dungeons/");
  });
  it("shows movement arrows, a trend and an empty box", () => {
    expect(movement(tEn, 3)).toContain("▲ 3");
    expect(movement(tEn, -2)).toContain("▼ 2");
    expect(movement(tEn, 0)).toContain("–");
    expect(movement(t, null)).toContain("new|nouv.");
    expect(trendBars([1, 2], "x")).toContain("<svg");
    expect(trendBars([1], "x")).toBe("");
    expect(emptyBox("Nothing", ["a <b>"])).toContain("Nothing");
  });
});

describe("what changed this week", () => {
  const since = new Date("2026-11-10T15:00:00Z");
  const runs = [run("o1", "Amy", 1500, "2026-11-06T10:00:00Z"), run("o2", "Bob", 1400, "2026-11-07T10:00:00Z"), run("n1", "Amy", 1200, "2026-11-10T16:00:00Z"), run("n2", "Cleo", 1300, "2026-11-11T16:00:00Z")];
  it("lists only characters that already had a score, with their real gain; a first score is a newcomer, not a climb", () => {
    const list = climbers(runs, since, rules, bracket);
    expect(list.map((entry) => entry.row.player.character)).toEqual(["Amy"]);
    expect(list[0]!.before).not.toBeNull();
    expect(list.every((entry) => entry.gain > 0 && entry.gain < entry.row.points)).toBe(true);
    expect(newcomers(runs, since, rules, bracket).map((row) => row.player.character)).toEqual(["Cleo"]);
  });
  it("does not show a whole party as climbers with one identical gain in a season's first week", () => {
    // Regression: five members of one run all had gain = their full score (identical for a shared run), e.g. five rows of the same arrow.
    const party = ["A", "B", "C", "D", "E"].map((name) => ({ ...run("p-" + name, name, 1300, "2026-11-11T16:00:00Z") }));
    const shared: ScoreRun = { ...party[0]!, runId: "party", players: party.flatMap((r) => r.players) };
    expect(climbers([shared], since, rules, bracket)).toEqual([]);
    expect(newcomers([shared], since, rules, bracket)).toHaveLength(5);
  });
  it("reports a record set this week with the time it beat", () => {
    const [record] = recordsBroken(runs, since, rules);
    expect(record?.run.runId).toBe("n1");
    expect(record?.previousSec).toBe(1400);
    expect(recordsBroken(runs.slice(0, 2), since, rules)).toEqual([]);
  });
  it("compares rank on the filtered list, so a class filter moves the arrows with the row numbers", () => {
    const onlyAmy = (player: { character: string }) => player.character === "Amy";
    const moves = rankMovement(runs, since, rules, bracket, onlyAmy);
    expect([...moves.keys()]).toEqual(["amy\0doomhowl"]);
    expect(moves.get("amy\0doomhowl")).toBe(0);
  });
  it("keeps a record per route: another route of the same dungeon is its own record", () => {
    const routed = [run("r1", "Amy", 1500, "2026-11-11T10:00:00Z"), { ...run("r2", "Bob", 1700, "2026-11-11T11:00:00Z"), routeKey: "other" }];
    expect(recordsBroken(routed, since, rules).map((record) => record.run.runId).sort()).toEqual(["r1", "r2"]);
  });
  it("gives new characters no movement and the others a number", () => {
    const moves = rankMovement(runs, since, rules, bracket);
    expect(moves.size).toBeGreaterThan(0);
    expect(moves.get("cleo\0doomhowl")).toBeNull();
  });
});

describe("dungeon milestones", () => {
  it("finds the fastest and the first clear, a time tie going to the earlier finish", () => {
    const list = [run("m1", "Amy", 1500, "2026-11-06T10:00:00Z"), run("m2", "Bob", 1300, "2026-11-08T10:00:00Z"), run("m3", "Cleo", 1300, "2026-11-07T10:00:00Z")];
    const { fastest, first } = dungeonMilestones(list, rules);
    expect(fastest?.runId).toBe("m3");
    expect(first?.runId).toBe("m1");
    expect(dungeonMilestones([], rules)).toEqual({ fastest: null, first: null });
  });
});
