import { describe, expect, it } from "vitest";
import { dungeonRoleFixture } from "./fixtures/dungeon-role-contract.js";
import { dungeonRole } from "../companion/dungeon-role.mjs";
import { personalPayloadFrom, personalResponseToLua } from "../companion/personal-runs-content.mjs";
import { agrees, summarize } from "../src/services/public-runs.js";
import { leaderRun, readLeaderFilters } from "../src/services/public-leaderboard.js";
import { publicRules, snapshotRules } from "../src/services/public-score.js";
import { roleScores } from "../src/services/public-guidance.js";
import { frozenRating, ratingWithRoles } from "../src/services/dungeon-rating.js";
import { publicAddonBoard } from "../src/services/public-addon-board.js";

describe("actual addon to companion role contract", () => {
  it.each([false, true])("normalizes native damage roles through %s standalone capture and every score view", standalone => {
    const {run} = dungeonRoleFixture(standalone);
    expect(run.players[0]).toMatchObject({character:"Tester",role:"DPS",presentSec:1200,level:16,minLevel:16});
    const summary = summarize(run);
    const publicRun = leaderRun({...summary,id:"contract",confirmations:1} as never);
    const rules = snapshotRules(publicRules(), new Date(1800000000000)).rules;
    const guildRun = {...summary,competitionData:{players:run.players.map(p=>({name:p.character,level:p.level,minLevel:p.minLevel})),encounters:run.encounters},
      players:run.players.map(p=>({character:p.character,role:p.role??null,presentSec:p.presentSec,memberId:"member",member:{displayName:"Tester"}}))};
    for(const role of ["DPS","DAMAGER","dps"]) {
      publicRun.players[0]!.role=role;guildRun.players[0]!.role=role;
      const guild=ratingWithRoles([guildRun],rules);
      expect(guild[0]?.points).toBe(200);
      expect(guild[0]?.roles?.find(r=>dungeonRole(r.role)==="DPS")?.points).toBe(200);
      expect(frozenRating(guild)).toEqual(guild);
      expect(roleScores([publicRun],rules,publicRun.players[0]!).roles.find(r=>r.role==="DPS")?.rows[0]?.points).toBe(200);
      const board=publicAddonBoard([publicRun],publicRun.players[0]!,[{id:"s1",label:"Official",labelFr:"Officielle",from:null,to:null,rules}],publicRun.endedAt)!;
      expect(board.profiles[0]?.roles.find(r=>dungeonRole(r.role)==="DPS")?.points).toBe(200);
      // Older protocol-2 panels still receive their DAMAGER selector.
      expect(personalResponseToLua({publicScore:board})).toContain('role = "DAMAGER", points = 200');
    }
    expect(readLeaderFilters(new URLSearchParams("role=DAMAGER")).role).toBe("DPS");
  });
  it("deduplicates the same actual capture from both saved files without changing raw history",()=>{
    const full=dungeonRoleFixture(), standalone=dungeonRoleFixture(true);
    expect(personalPayloadFrom([full.saved,standalone.saved]).runs).toHaveLength(1);
    const legacy=full.saved.replaceAll('"DPS"','"DAMAGER"');
    expect(personalPayloadFrom([legacy]).runs[0].players[0].role).toBe("DPS");
    expect(legacy).toContain('"DAMAGER"');
    const a=summarize(full.run), b=structuredClone(a);b.players[0]!.role="DAMAGER";
    expect(agrees(b,a)).toBe(true);
    b.players[0]!.role="HEALER";expect(agrees(b,a)).toBe(false);
  });
  it.each(["TANK","HEALER","NONE"])("preserves known roles and keeps %s unknown unassigned",role=>{
    const {run}=dungeonRoleFixture(false,role);
    expect(run.players[0]?.role??null).toBe(dungeonRole(role));
  });
});
