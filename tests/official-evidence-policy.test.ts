import { describe, expect, it } from "vitest";
import { publicRules, snapshotRules, readRuleSnapshot, rateRun, characterScores, addedRules, publicSeasons, periodRules, rulesAt } from "../src/services/public-score.js";
import { planBase, scenarioAt } from "../src/services/public-guidance.js";
import { leaderRun, unrankedText } from "../src/services/public-leaderboard.js";
import { summarize } from "../src/services/public-runs.js";
import { dungeonRoleFixture } from "./fixtures/dungeon-role-contract.js";
import { validBracketedRules } from "../src/services/dungeon-november-rules.js";

describe("versioned official current-evidence policy",()=>{
  it("rejects legacy official credit, preserves legacy history and old snapshots, and never upgrades evidence",()=>{
    const current=leaderRun({...summarize(dungeonRoleFixture().run),id:"current",confirmations:1} as never);
    const legacy={...current,runId:"legacy",evidence:null};
    const beta=publicRules(), official=snapshotRules(beta,new Date()).rules;
    expect(validBracketedRules(official)).toBe(true);
    expect(official.evidencePolicy).toBe("current-v1");
    expect(rateRun(legacy,beta).score?.points).toBe(200);
    expect(rateRun(legacy,official)).toEqual({score:null,reason:"Current evidence required by this season"});
    expect(characterScores([legacy],official)).toEqual([]);
    expect(rateRun(current,official).score?.points).toBe(200);
    const before=JSON.stringify(current);
    const scenario=scenarioAt(planBase({runs:[current],rules:official,me:current.players[0]!,level:16,now:current.endedAt},"15-29"),"389",1000,16);
    expect(scenario).toMatchObject({routePoints:240,gain:40,total:240});
    expect(JSON.stringify(current)).toBe(before);
    const periods=publicSeasons(current.endedAt);
    expect(rateRun(legacy,periodRules(periods[0]!)).score).toBeNull();
    expect(rateRun(legacy,rulesAt(periods,current.endedAt)).score).toBeNull();
    expect(rateRun({...current,evidence:{...current.evidence!,completedBy:"manual"}},official).score).toBeNull();
    const absentLevels={...current,players:current.players.map(p=>({...p,minLevel:null}))};
    expect(rateRun(absentLevels,official).reason).toBe("Party levels unknown");
    for(const fraction of [.79,.8,.81]) {
      const run={...current,players:current.players.map(p=>({...p,presentSec:1200*fraction}))};
      expect(characterScores([run],official).length).toBe(fraction<.8?0:1);
    }
    const old={format:1 as const,frozenAt:new Date().toISOString(),rules:beta,additions:[]};
    expect(readRuleSnapshot(old)).toBe(old);expect(readRuleSnapshot(old)?.rules.evidencePolicy).toBeUndefined();
    expect(beta.evidencePolicy).toBeUndefined();expect(legacy.evidence).toBeNull();
    const smaller={...official,routes:official.routes.slice(1)};
    // The additive helper must preserve a previously frozen policy.
    const addition=addedRules(smaller,beta);expect(addition?.rules.evidencePolicy).toBe("current-v1");
    expect(unrankedText({t:(_en:string,fr:string)=>fr} as never,rateRun(legacy,official).reason)).toContain("Preuves actuelles");
  });
});
