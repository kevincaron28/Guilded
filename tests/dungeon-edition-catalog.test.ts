import { describe, expect, it } from "vitest";
import { dungeonCatalog } from "../companion/dungeon-catalog.mjs";
import { editionDungeonRules } from "../src/services/dungeon-edition-catalog.js";
import { createBracketedDungeonRules, resolveNovemberRoute, validBracketedRules } from "../src/services/dungeon-november-rules.js";
import { rateRun, addedRules } from "../src/services/public-score.js";
import { MIDNIGHT_S2_RATING } from "../src/services/challenge-rating-rules.js";
import { challengeScores, keystonePoints } from "../src/services/challenge-rating.js";
import type { ChallengeRun } from "../src/services/challenge-leaderboard.js";
import { exportDungeonRuns } from "../companion/lua-export-content.mjs";
import { dungeonRunSchema } from "../src/services/dungeon-rules.js";
import { summarize, agrees } from "../src/services/public-runs.js";
import { validateCombatLog } from "../scripts/validate-combat-log.mjs";
import { readFileSync } from "node:fs";

describe("reviewed provisional edition catalogs", () => {
  it("retains NPC evidence through companion/schema/public storage and reconciles the corresponding encounter", () => {
    const [wire]=exportDungeonRuns({dungeon:{runs:{fixture:{id:"QG-fixture",gameEdition:"classic-era",protocolVersion:1,state:"COMPLETED",
      instanceId:43,difficultyId:1,name:"Wailing Caverns",startedAt:1800000000,endedAt:1800002400,completedBy:"final boss",
      encounters:{1:{id:3654,kind:"npc",success:true,at:1800002400}},players:{"Tester-Realm":{level:25,minLevel:25,presentSec:2400}}}}}},"Realm");
    const summary=summarize(dungeonRunSchema.parse(wire));
    expect(summary.encounters[0]).toMatchObject({id:3654,kind:"npc"});
    expect(agrees(summary,{...summary,encounters:[{id:592,success:true,at:1800002400}]})).toBe(true);
    expect(agrees(summary,{...summary,encounters:[{id:3654,success:true,at:1800002400}]})).toBe(false);
  });
  it("keeps static validation strict when a client guard is removed", () => {
    const source=readFileSync("addon/Guilded/Modules/Dungeon.lua","utf8").replaceAll("\r\n","\n");
    expect(()=>validateCombatLog(source,true)).not.toThrow();
    expect(()=>validateCombatLog(source.replace('clientEdition == "classic-era"','clientEdition == "retail"'),true)).toThrow();
    expect(()=>validateCombatLog(source,false)).toThrow();
  });
  it.each(["classic-era", "classic-tbc", "classic-mists", "retail"] as const)("resolves and rates every %s route with its own evidence", edition => {
    const rules = editionDungeonRules(edition);
    expect(validBracketedRules(rules)).toBe(true);
    expect(rules.routes.length).toBe(dungeonCatalog.routes.filter(r => r.edition === edition).length);
    for (const route of rules.routes) {
      const startedAt = new Date("2026-10-25T12:00:00Z");
      const endedAt = new Date(+startedAt + route.targetSec! * 1000);
      const encounters = [...route.requiredEncounters, route.completion].map((boss,i) => ({
        ...(boss.ids.length ? {id:boss.ids[0]!} : {id:boss.npcIds![0]!,kind:"npc" as const}),
        at: +startedAt/1000 + (i+1)*60, success:true
      }));
      const run = {instanceId:route.instanceId,difficultyId:route.participationBand.difficultyId,startedAt,endedAt,competitionData:{encounters}};
      expect(resolveNovemberRoute(run,rules).key,route.dungeonKey).toBe(route.dungeonKey);
      const level = route.competitionBand!.max;
      const players = [{character:"Tester",realm:"Realm",className:"MAGE",role:"DAMAGER",level,minLevel:level,presentSec:route.targetSec!}];
      expect(rateRun({gameEdition:edition,runId:"fixture",instanceId:route.instanceId,routeKey:null,difficultyId:run.difficultyId,
        dungeonName:route.name,durationSec:route.targetSec!,endedAt,confirmations:2,players,evidence:{startedAt,completedBy:"final boss",encounters}},rules).score?.points,route.dungeonKey).toBe(200);
      expect(resolveNovemberRoute({...run,difficultyId:99},rules).reason).toBe("Dungeon route unknown");
      if (route.requiredEncounters.length) expect(resolveNovemberRoute({...run,competitionData:{encounters:encounters.slice(1)}},rules).reason).toBe("Required encounter evidence missing");
    }
  });
  it("keeps benchmark provenance and frozen seasons; does not enable retrospective keystone scores", () => {
    const current = editionDungeonRules("retail");
    expect(current.routes.every(r => r.verification.method === "source-reviewed" && r.verification.sources!.length)).toBe(true);
    expect(() => createBracketedDungeonRules({...current,provisional:undefined})).toThrow("provisional");
    const old = createBracketedDungeonRules({gameEdition:"retail",routes:[],brackets:[]});
    const added = addedRules(old,current)!;
    expect(added.rules.provisionalTargets).toBe(true);
    expect(added.rules.keystoneRating).toBeUndefined();
    expect(validBracketedRules(added.rules)).toBe(true);
  });
});

const challenge = {mapId:249,level:10,affixIds:[3,9],durationMs:1980000,timeLimitSec:1980,onTime:true,practiceRun:false,eligibleForScore:true};
const keyRun = (over:Partial<ChallengeRun> = {}): ChallengeRun => ({gameEdition:"retail",runId:"fixture",instanceId:1762,difficultyId:8,
  dungeonName:"Kings' Rest",durationSec:1980,endedAt:new Date("2026-10-25T12:00Z"),challenge,evidence:{completedBy:"challenge objectives"},
  players:[{character:"Tester",realm:"Realm",presentSec:1980}],...over});
describe("Raider.IO inspired Guilded keystone rating", () => {
  it("uses published key bases with Guilded's bounded provisional speed bonus", () => {
    expect(keystonePoints(challenge)).toBe(320);
    expect(keystonePoints({...challenge,durationMs:1188000})).toBe(345);
    expect(keystonePoints({...challenge,durationMs:180000})).toBe(345);
    expect(keystonePoints({...challenge,level:30})).toBe(635);
    expect(keystonePoints({...challenge,level:31})).toBeNull();
    expect(keystonePoints({...challenge,durationMs:1980001})).toBeNull();
  });
  it("sums each dungeon once across affixes; repeats never lower a score and realm/privacy filters remain scoped", () => {
    const runs=[keyRun(),keyRun({runId:"fast",challenge:{...challenge,durationMs:1188000}}),
      keyRun({runId:"other-affix",challenge:{...challenge,affixIds:[10]}}),
      keyRun({runId:"second",instanceId:1877,challenge:{...challenge,mapId:250,timeLimitSec:1920,durationMs:1920000}}),
      keyRun({runId:"other-realm",players:[{character:"Tester",realm:"Other",presentSec:1980}]})];
    const scores=challengeScores(runs,MIDNIGHT_S2_RATING);
    expect(scores.map(r => [r.realm,r.points,r.completed])).toEqual([["Realm",665,2],["Other",320,1]]);
    expect(scores[0]!.best.map(b => b.run.runId)).toEqual(["fast","second"]);
    expect(challengeScores(runs,MIDNIGHT_S2_RATING,p=>p.realm==="Other")).toHaveLength(1);
    expect(challengeScores(runs,undefined)).toEqual([]);
  });
  it("rejects pool/map/timer mismatches, private filters and ineligible completion", () => {
    for (const run of [keyRun({instanceId:999}),keyRun({challenge:{...challenge,mapId:501}}),keyRun({challenge:{...challenge,timeLimitSec:2000}}),
      keyRun({challenge:{...challenge,practiceRun:true}}),keyRun({gameEdition:"classic-mists"})]) expect(challengeScores([run],MIDNIGHT_S2_RATING)).toEqual([]);
  });
});
