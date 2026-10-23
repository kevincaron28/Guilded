import { describe, expect, it } from "vitest";
import { calculateDungeonRating, frozenRating, ratingWithRoles, type RatingRun } from "../src/services/dungeon-rating.js";
import { provisionalSeasonRules } from "../src/services/dungeon-bracket-season.js";
import { snapshotGuidance } from "../src/services/dungeon-snapshot-guidance.js";
import { standingsToLua } from "../companion/standings-format.mjs";
import { newLuaSession } from "./lua/harness.js";
const rules = provisionalSeasonRules().rules;
const now = new Date("2026-10-23T12:00:00Z");
function run(key: string, seconds: number, level = 20, role: string | null = "TANK"): RatingRun {
  return { instanceId: Number(key), difficultyId: 0, durationSec: seconds, runRef: `${key}-${seconds}-${role}`, completedBy: "final boss",
    endedAt: now, startedAt: new Date(now.getTime() - seconds * 1000),
    competitionData: { players: [{ name: "Tester", level, minLevel: level }], encounters: [] },
    players: [{ character: "Tester", memberId: "m", role, presentSec: seconds, member: { displayName: "Tester" } }] };
}
const history = () => [run("3065", 1500), run("2999", 2100), run("43", 2400), run("389", 1263, 18), run("33", 2000), run("36", 3000)];

describe("addon snapshot guidance", () => {
  it("matches the guild evaluator's entire best-N selection at exact thresholds, including penalties", () => {
    const runs = history();
    const row = ratingWithRoles(runs, rules)[0]!;
    const plan = snapshotGuidance(row, rules, now)!;
    expect(row.points).toBe(970);
    expect(plan.routes.find(r => r.key === "36")?.next).toMatchObject({ durationSec: 2601, gain: 5, total: 975, pushedOut: ["Shadowfang Keep"] });
    for (const route of plan.routes.filter(r => r.fit === "ok" && r.next?.durationSec)) {
      const seconds = route.next!.durationSec!;
      const after = calculateDungeonRating([...runs, run(route.key, seconds)], rules)[0]!;
      expect(after.points).toBe(route.next!.total);
      const slower = calculateDungeonRating([...runs, run(route.key, seconds + 1)], rules)[0]!;
      expect(slower.points - row.points).toBeLessThan(5);
    }
    const unknownLevel = { ...row }; delete unknownLevel.level;
    expect(snapshotGuidance(unknownLevel, rules, now)).toBeNull();
  });

  it("keeps role switching separate and freezes role details without assigning unknown roles", () => {
    const rows = ratingWithRoles([run("36", 2400), run("36", 2000, 20, "HEALER"), run("36", 1800, 20, null)], rules);
    expect(rows[0]).toMatchObject({ points: 267, roles: [{ role: "TANK", points: 200 }, { role: "HEALER", points: 240 }, { role: "DAMAGER", points: 0 }] });
    expect(frozenRating(JSON.parse(JSON.stringify(rows)))).toEqual(rows);
    const bad = structuredClone(rows); bad[0]!.roles![0]!.points = 999;
    expect(frozenRating(bad)).toBeNull();
    // A non-tank party member outside the band still makes the tank's run ineligible.
    const carry = run("36", 1800);
    (carry.competitionData as { players: unknown[] }).players.push({ name: "Helper", level: 60, minLevel: 60 });
    carry.players.push({ character: "Helper", memberId: "h", role: "DAMAGER", presentSec: 1800, member: { displayName: "Helper" } });
    expect(ratingWithRoles([carry], rules).find(r => r.name === "Tester")?.roles?.[0]?.points).toBe(0);
  });

  it("delivers roles and scenarios through the real companion serializer into the Lua panel and tooltip", () => {
    const row = ratingWithRoles(history(), rules)[0]!;
    const guidance = snapshotGuidance(row, rules, now);
    const board = { id: "s", season: "Test", status: "ACTIVE", ratingVersion: 6, detailsAvailable: true, brackets: rules.brackets,
      catalog: rules.catalog, rows: [{ name: "Tester", points: row.points, bracket: row.bracket }],
      profiles: [{ ...row, guidance, roles: row.roles!.map(role => ({ ...role, guidance: snapshotGuidance({ ...row, ...role }, rules, now) })) }] };
    const lua = newLuaSession();
    try {
      lua.run('NS={}; GuildedDB=nil; function UnitLevel() return 20 end');
      for (const file of ["Core.lua", "Modules/Scores.lua", "Modules/SeasonDetails.lua", "Modules/DungeonScorePanel.lua"]) lua.load(file);
      lua.run(standingsToLua({ updatedAt: now.toISOString(), standings: [], dungeonBoard: board }));
      lua.run('fire_event("PLAYER_LOGIN"); NS.getDb().dungeonBoard=GuildedDungeonBoard; M=NS.dungeonScorePanel.model("Tester",1,"15-29","month","HEALER")');
      expect(lua.run('return M.total')).toBe("0");
      lua.run('M=NS.dungeonScorePanel.model("Tester",1,"15-29"); for _,c in ipairs(M.cards) do if c.name=="The Deadmines" then CARD=c end end');
      expect(lua.run('return CARD.guidance.next.gain')).toBe("5");
      expect(lua.run('return NS.dungeonScorePanel.guidanceText(CARD)')).toContain("43:21: +5 points (season 975)");
      expect(lua.run('return NS.dungeonScorePanel.guidanceText(CARD)')).toContain("No confirmation yet");
      lua.run('function GetLocale() return "frFR" end'); lua.load("Locale.lua");
      expect(lua.run('return NS.dungeonScorePanel.guidanceText(CARD)')).toContain("Scénario au niveau 20");
    } finally { lua.close(); }
  });
});
