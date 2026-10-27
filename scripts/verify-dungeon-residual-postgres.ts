import assert from "node:assert/strict";
import type {Prisma,PrismaClient} from "../src/generated/prisma/client.js";
import type {DungeonRunInput} from "../src/services/dungeon-rules.js";
import type {BracketedRules} from "../src/services/dungeon-november-rules.js";
import {importDungeonRuns} from "../src/services/dungeon-import.js";
import {ingestPublicRuns,prismaPublicRunStore} from "../src/services/public-runs.js";
import {leaderRun,PUBLIC_RUN_SELECT} from "../src/services/public-leaderboard.js";
import {rateRun} from "../src/services/public-score.js";
import {UPLOAD_GRACE_MS} from "../src/services/dungeon-integrity.js";

export async function verifyDungeonResidualPostgres(db:PrismaClient,seed:DungeonRunInput,from:Date,to:Date,rules:BracketedRules) {
  for(const lowFirst of [false,true]) for(const laterBefore of [false,true]) {
    const label=`${lowFirst}-${laterBefore}`,a=structuredClone(seed);a.id=`withdraw-${label}`;
    for(const p of a.players) {p.presentSec=1200;p.integrity={knownSec:1200,unknownSec:0,knownIntervals:[[a.startedAt!,a.endedAt!]],lockedRole:"DPS",mixedRole:false};}
    const low=structuredClone(a);low.integrity!.observer="Peer";
    for(const p of low.players) {const seconds=p.character==="Peer"?600:0;p.presentSec=seconds;p.integrity={knownSec:seconds,unknownSec:1200-seconds,knownIntervals:seconds?[[a.startedAt!,a.startedAt!+seconds]]:[],lockedRole:"DPS",mixedRole:false};}
    function later(offset:number) {
      const r=structuredClone(a);r.id=`${a.id}-${offset}`;r.startedAt!+=offset;r.endedAt!+=offset;
      r.integrity!.observer="Peer";r.integrity!.detectedAt!+=offset;r.integrity!.combatAt!+=offset;
      for(const e of r.encounters??[]) {if(e.at)e.at+=offset;if(e.startedAt)e.startedAt+=offset;}
      for(const p of r.players) p.integrity!.knownIntervals=[[r.startedAt!,r.endedAt!]];
      return r;
    }
    const second=later(3600),third=later(7200),now=new Date(third.endedAt!*1000+1);
    const guild=await db.guild.create({data:{discordId:`release-test-withdraw-${label}`,name:"Withdrawal fixture"}});
    const members=await Promise.all(["Tester","Peer"].map(name=>db.member.create({data:{guildId:guild.id,discordUserId:name,displayName:name}})));
    const peer=members.find(m=>m.displayName==="Peer")!;
    const chars=members.map(m=>({name:m.displayName,realm:"TestRealm",memberId:m.id}));
    await db.dungeonSeason.create({data:{guildId:guild.id,name:"Withdrawal",startsAt:from,endsAt:new Date(to.getTime()+86400000),ratingRules:rules as unknown as Prisma.InputJsonValue}});
    const send=(r:DungeonRunInput)=>db.$transaction(tx=>importDungeonRuns(tx,guild.id,[r],chars,"release-test",null,now),{timeout:15000});
    await send(lowFirst?low:a);
    const first=await db.dungeonRun.findUniqueOrThrow({where:{guildId_runRef:{guildId:guild.id,runRef:a.id}}});
    const originalAchievement=await db.dungeonAchievement.findUnique({where:{guildId_memberId_key:{guildId:guild.id,memberId:peer.id,key:"firstBlood"}}});
    await db.dungeonPointTransaction.create({data:{guildId:guild.id,memberId:peer.id,runId:first.id,seasonId:first.seasonId,amount:7,reason:"Unrelated manual award",source:"admin:award",createdBy:"release-test"}});
    if(!lowFirst && laterBefore) await send(second);
    await send(lowFirst?a:low);
    const firstNet=await db.dungeonPointTransaction.aggregate({where:{runId:first.id,memberId:peer.id,NOT:{source:"admin:award"}},_sum:{amount:true}});
    assert.equal(firstNet._sum.amount??0,0,"a low self report removes inferred participation regardless of order");
    if(!laterBefore || lowFirst) {
      assert.equal(await db.dungeonAchievement.count({where:{guildId:guild.id,memberId:peer.id,key:"firstBlood",revokedAt:null}}),0);
      await send(second);
    }
    const secondRow=await db.dungeonRun.findUniqueOrThrow({where:{guildId_runRef:{guildId:guild.id,runRef:second.id}}});
    const active=await db.dungeonAchievement.findUniqueOrThrow({where:{guildId_memberId_key:{guildId:guild.id,memberId:peer.id,key:"firstBlood"}}});
    assert.equal(active.revokedAt,null);assert.equal(active.runId,secondRow.id,"firstBlood moves to a genuinely eligible run");
    if(originalAchievement) assert.equal(active.id,originalAchievement.id,"revocation preserves the award row");
    assert.equal((await db.dungeonPointTransaction.aggregate({where:{guildId:guild.id,memberId:peer.id},_sum:{amount:true}}))._sum.amount,82,"second run receives freed budget; manual seven points remain");
    if(!lowFirst) {
      assert.ok(await db.dungeonPointTransaction.count({where:{runId:first.id,memberId:peer.id,amount:{lt:0},source:{startsWith:"evidence:"}}}));
      assert.ok(await db.auditLog.count({where:{guildId:guild.id,entityId:active.id}}));
    }
    await send(third);
    assert.equal((await db.dungeonPointTransaction.aggregate({where:{guildId:guild.id,memberId:peer.id},_sum:{amount:true}}))._sum.amount,107,"unchanged weekly budget is 75 plus 25, plus unrelated manual award");
    const count=await db.dungeonPointTransaction.count({where:{guildId:guild.id}}),audits=await db.auditLog.count({where:{guildId:guild.id}});
    await send(a);await send(low);await send(second);await send(third);
    const richer=structuredClone(a);richer.encounters!.push({id:2000,success:true,at:a.startedAt!+300,source:"native"});await send(richer);
    assert.equal(await db.dungeonPointTransaction.count({where:{guildId:guild.id}}),count,"retries append no compensations");
    assert.equal(await db.auditLog.count({where:{guildId:guild.id}}),audits,"unchanged fallback does not create audit churn");
  }

  let clock=new Date(seed.endedAt!*1000);
  const store=prismaPublicRunStore(db,()=>clock),a={...structuredClone(seed),id:"public-late-revision-retention"};
  await ingestPublicRuns(store,{uploaderKey:"retention-A",character:"Tester",source:"personal",runs:[a]},clock);
  const before=await db.publicRun.findFirstOrThrow({where:{runRef:a.id},select:PUBLIC_RUN_SELECT});
  const deadline=new Date(to.getTime()+UPLOAD_GRACE_MS);
  clock=new Date(deadline.getTime()+1);
  const late=structuredClone(a);late.players[0]!.integrity!.mixedRole=true;
  const lateResult=await ingestPublicRuns(store,{uploaderKey:"retention-A",character:"Tester",source:"personal",runs:[late]},clock);
  assert.equal(lateResult.historyOnly.length,1);
  const upload=await db.publicRunUpload.findUniqueOrThrow({where:{runId_uploaderKey:{runId:before.id,uploaderKey:"retention-A"}}});
  assert.equal(upload.historyOnly,false,"a late revision cannot poison its timely predecessor's row");
  const saved=upload.evidence as {canonicalEligible:boolean;previousRevisions:{canonicalEligible:boolean}[]};
  assert.equal(saved.canonicalEligible,false);assert.equal(saved.previousRevisions[0]!.canonicalEligible,true);
  const b=structuredClone(a);b.integrity!.observer="Peer";b.integrity!.startTrigger="peer";delete b.integrity!.combatAt;
  b.startedAt!--;
  const queued=await ingestPublicRuns(store,{uploaderKey:"retention-B",character:"Peer",source:"personal",runs:[b]},new Date(deadline.getTime()-1));
  assert.equal(queued.historyOnly.length,1,"pre-cutoff request queued after deadline is history-only");
  const after=await db.publicRun.findUniqueOrThrow({where:{id:before.id},select:PUBLIC_RUN_SELECT});
  assert.deepEqual(after,before,"late history never changes any canonical field");
  assert.ok(rateRun(leaderRun(after),rules).score);
  const firstLate=await ingestPublicRuns(store,{uploaderKey:"retention-new",character:"Tester",source:"personal",runs:[{...a,id:"first-upload-admitted-late"}]},new Date(deadline.getTime()-1));
  assert.equal(firstLate.historyOnly.length,1);
  const firstLateRow=await db.publicRun.findFirstOrThrow({where:{runRef:"first-upload-admitted-late"},select:PUBLIC_RUN_SELECT});
  assert.equal(rateRun(leaderRun(firstLateRow),rules).score,null);
  console.log("Residual P1 regressions: withdrawal/reallocation/audited achievement fallback in both orders; per-revision public eligibility and locked cutoff passed.");
}
