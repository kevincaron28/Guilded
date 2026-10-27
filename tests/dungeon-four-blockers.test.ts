import { describe, expect, it } from "vitest";
import { dungeonRoleFixture } from "./fixtures/dungeon-role-contract.js";
import { agrees, reconcileSummaries, summarize } from "../src/services/public-runs.js";
import { createLeaderboardPages, leaderRun } from "../src/services/public-leaderboard.js";
import { characterScores, publicRules, rateRun, snapshotRules } from "../src/services/public-score.js";
import { integrityPresence } from "../src/services/dungeon-integrity.js";
import { createWebApp } from "../src/services/web-app.js";
import { memoryWebStore } from "./helpers/memory-web-store.js";

function setup(standalone=false, options:Parameters<typeof dungeonRoleFixture>[2]={}) {
  const run=dungeonRoleFixture(standalone,"DAMAGER",{nativeApi:true,...options}).run;
  const now=new Date(run.endedAt!*1000), from=new Date((run.startedAt!-60)*1000), to=new Date(now.getTime()+86400000);
  const rules={...publicRules(),evidencePolicy:"current-v2" as const,seasonWindow:{from:from.toISOString(),to:to.toISOString()}};
  const summary=summarize(run,now), row=leaderRun({...summary,id:"observed",confirmations:1} as never);
  return {run,now,from,to,rules,summary,row};
}

describe("Claude blocker 1: independent observations",()=>{
  it("reconciles self intervals without upload-order or relay inflation",()=>{
    const {run,now,rules}=setup(false,{peerEarlier:0});
    const other=structuredClone(run); other.integrity!.observer="Peer";
    for(const p of other.players) p.integrity={knownSec:p.character==="Peer"?1200:0,unknownSec:p.character==="Peer"?0:1200,
      knownIntervals:p.character==="Peer"?[[run.startedAt!,run.endedAt!]]:[],lockedRole:"DPS",mixedRole:false};
    other.players[0]!.presentSec=0;
    const a=summarize(run,now),b=summarize(other,now);
    expect(agrees(a,b)).toBe(true); expect(agrees(b,a)).toBe(true);
    const ab=reconcileSummaries([a,b])!,ba=reconcileSummaries([b,a])!;
    expect(ab).toEqual(ba);
    const view=leaderRun({...ab,id:"merged",confirmations:2} as never);
    expect(characterScores([view],rules).map(r=>r.points)).toEqual([400,400]);
    expect(view.players.every(p=>integrityPresence(p.integrity,1200,run.startedAt))).toBe(true);
    expect(reconcileSummaries([a,b,b,a])).toEqual(ab);
    expect(reconcileSummaries([a,b,...Array.from({length:50},(_,i)=>({...a,evidenceReceivedAt:new Date(now.getTime()+i*1000)}))])).toEqual(ab);
    expect((ab.integrity as {observers:unknown[]}).observers).toHaveLength(2);
    // Incomparable clocks cannot be repaired by adding or maximizing seconds.
    expect(reconcileSummaries([a,{...b,startedAt:new Date(b.startedAt.getTime()-60000)}])).toBeNull();
    expect(reconcileSummaries([a,{...b,gameEdition:"retail"}])).toBeNull();
  });
  it("rejects out-of-window intervals instead of crediting aggregate seconds",()=>{
    const {run}=setup();
    expect(integrityPresence({knownSec:1200,unknownSec:0,knownIntervals:[[1,1201]],mixedRole:false},1200,run.startedAt)).toBe(false);
    expect(integrityPresence({knownSec:1200,unknownSec:0,knownIntervals:[[1,1001],[501,701]],mixedRole:false},1200)).toBe(false);
  });
});

describe("Claude blockers 2 and 3: native positive capture and normal play",()=>{
  it.each([false,true])("scores native capture with unknown freshness, standalone=%s",standalone=>{
    const {run,row,rules}=setup(standalone);
    expect(run.integrity).toMatchObject({observer:"Tester",startWitness:"unknown",startTrigger:"first combat"});
    expect(run.encounters?.some(e=>e.id===2747 && e.source==="native" && e.success)).toBe(true);
    expect(rules.routes.find(r=>r.instanceId===36)!.verification.fullRoute).toBeUndefined();
    expect(rateRun(row,rules,row.players[0]).score?.points).toBe(400);
    expect(snapshotRules(rules,row.endedAt).rules.evidencePolicy).toBe("current-v1"); // no activation
    const noNative={...row,evidence:{...row.evidence!,encounters:[]}};
    expect(rateRun(noNative,rules).reason).toBe("Native completion checkpoints required");
  });
  it.each([false,true])("keeps peer start, wipe, reload gaps and relay provenance, standalone=%s",standalone=>{
    const {run,row,rules}=setup(standalone,{peerEarlier:2,wipe:true,reloadGap:120,peerRoundTrip:true,peerEndFirst:true});
    expect(run.endedAt!-run.startedAt!).toBe(1322);
    expect(run.integrity).toMatchObject({observer:"Tester",startTrigger:"peer",continuous:true,startWitness:"unknown"});
    expect(run.encounters?.filter(e=>e.success)).toHaveLength(1);
    const tester=row.players.find(p=>p.character==="Tester")!;
    expect(tester.integrity).toMatchObject({knownSec:1170,unknownSec:152});
    expect(rateRun(row,rules,tester).score).not.toBeNull();
    expect(rateRun({...row,evidence:{...row.evidence!,integrity:{...run.integrity!,detectedAt:run.startedAt!+60}}},rules).score).toBeNull();
  });
});

describe("Claude blocker 4: complete public pages",()=>{
  it.each(["en","fr"])("keeps rejected runs out of ranked sets and shows observed policy notice (%s)",async lang=>{
    const {row,now,from,to,rules}=setup();
    const rejected={...row,runId:"rejected",instanceId:389,routeKey:"389",dungeonName:"RejectedCheckpoint",evidence:{...row.evidence!,encounters:[]}};
    const pages=createLeaderboardPages({personal:null,now:()=>now,calendar:async()=>[{number:1,name:"Season 1",start:from,end:to,rules:{...snapshotRules(publicRules(),from),rules}}],
      store:{runs:async()=>[row,rejected],characterRuns:async()=>[row,rejected],guilds:async()=>[],guildRuns:async()=>[],guildRoster:async()=>[]}});
    const app=createWebApp({store:memoryWebStore().store,auth:{clientId:"1",clientSecret:"x",siteUrl:"https://guilded.kcaron.top",sessionSecret:"s".repeat(40)},
      allows:()=>true,postApplication:async()=>null,routes:[pages.route],now:()=>now});
    const page=await app.respond({method:"GET",path:"/leaderboards/",query:new URLSearchParams({lang}),headers:{}});
    expect(page!.status).toBe(200);
    expect(page!.body).toContain(lang==="en"?"Freshness remains unknown":"L'état initial reste inconnu");
    expect(page!.body).toContain(lang==="en"?"This season requires current stored evidence":"Cette saison exige les preuves actuelles enregistrées");
    const records=page!.body.split(lang==="en"?"<h2>Dungeon records</h2>":"<h2>Records des donjons</h2>")[1]!.split("</table>")[0]!;
    expect(records).toContain("Deadmines"); expect(records).not.toContain("RejectedCheckpoint");
    const filtered=await app.respond({method:"GET",path:"/leaderboards/",query:new URLSearchParams({lang,dungeon:"389"}),headers:{}});
    expect(filtered!.body).toContain(lang==="en"?"No run matches these filters yet":"Aucun essai ne correspond encore");
    expect(characterScores([row,rejected],rules)).toHaveLength(1);
  });
});
