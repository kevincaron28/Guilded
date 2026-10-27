import assert from "node:assert/strict";
import type { Prisma, PrismaClient } from "../src/generated/prisma/client.js";
import { dungeonRoleFixture } from "../tests/fixtures/dungeon-role-contract.js";
import { importDungeonRuns } from "../src/services/dungeon-import.js";
import { dungeonRating } from "../src/services/dungeon-rating.js";
import { finalizeClosingSeasons } from "../src/services/dungeon-admin.js";
import { UPLOAD_GRACE_MS } from "../src/services/dungeon-integrity.js";
import { ingestPublicRuns, prismaPublicRunStore, publishGuildRuns } from "../src/services/public-runs.js";
import { leaderRun, PUBLIC_RUN_SELECT } from "../src/services/public-leaderboard.js";
import { characterScores, publicRules, snapshotRules } from "../src/services/public-score.js";
import { cancelNextSeason, scheduleNextSeason, rotateOfficialSeasons, officialWindows } from "../src/services/official-seasons.js";
import { lockDungeonCalendar } from "../src/services/dungeon-calendar-lock.js";
import { verifyDungeonResidualPostgres } from "./verify-dungeon-residual-postgres.js";

// Invoked only after verify-postgres.ts proves it is a disposable local database.
export async function verifyDungeonObservedPostgres(db: PrismaClient) {
  const a=dungeonRoleFixture(false,"DAMAGER",{nativeApi:true,peerEarlier:0}).run;
  const b=structuredClone(a);b.integrity!.observer="Peer";
  for(const p of b.players) p.integrity={knownSec:p.character==="Peer"?1200:0,unknownSec:p.character==="Peer"?0:1200,
    knownIntervals:p.character==="Peer"?[[a.startedAt!,a.endedAt!]]:[],lockedRole:"DPS",mixedRole:false};
  const now=new Date(a.endedAt!*1000),from=new Date((a.startedAt!-60)*1000),to=new Date(now.getTime()+60000);
  const rules={...publicRules(),evidencePolicy:"current-v2" as const,seasonWindow:{from:from.toISOString(),to:to.toISOString()}};
  const snapshot={...snapshotRules(publicRules(),from),rules};
  const official=await db.officialSeason.create({data:{gameEdition:"forever",number:900,name:"Observed fixture",startsAt:from,createdBy:"release-test",rules:snapshot as unknown as Prisma.InputJsonValue}});
  const next=await db.officialSeason.create({data:{gameEdition:"forever",number:901,name:"Observed next",startsAt:to,createdBy:"release-test"}});
  const store=prismaPublicRunStore(db);
  try {
    await verifyDungeonResidualPostgres(db,a,from,to,rules);
    for (const legacyFirst of [true,false]) for (const legacyVersion of [1,2]) {
      const label=`${legacyFirst}-v${legacyVersion}`;
      const modern={...structuredClone(a),id:`mixed-${label}-${a.id}`},legacy=structuredClone(modern);
      delete legacy.integrity!.observer;delete legacy.integrity!.detectedAt;delete legacy.integrity!.combatAt;
      if (legacyVersion===1) delete legacy.integrity;
      for (const p of legacy.players) {delete p.integrity;p.presentSec=0;}
      for (const e of legacy.encounters??[]) delete e.source;
      for(const run of legacyFirst?[legacy,modern]:[modern,legacy]) await ingestPublicRuns(store,
        {uploaderKey:`direct-${label}`,character:"Tester",source:"personal",runs:[{...run,id:`direct-${modern.id}`}]},now);
      const direct=await db.publicRun.findFirstOrThrow({where:{runRef:`direct-${modern.id}`},select:{...PUBLIC_RUN_SELECT,status:true}});
      assert.equal(direct.status,"ACCEPTED");assert.equal(direct.confirmations,1);
      assert.equal(characterScores([leaderRun(direct)],rules)[0]?.points,400,"same-uploader old/new order must promote native evidence");
      const retry=await ingestPublicRuns(store,{uploaderKey:`direct-${label}`,character:"Tester",source:"personal",runs:[{...modern,id:`direct-${modern.id}`}]},now);
      assert.equal(retry.duplicates.length,1);
      const guild=await db.guild.create({data:{discordId:`release-test-mixed-${label}`,name:"Mixed fixture"}});
      await db.guildSettings.create({data:{guildId:guild.id,publicDungeonRuns:true}});
      const member=await db.member.create({data:{guildId:guild.id,discordUserId:"Tester",displayName:"Tester"}});
      const season=await db.dungeonSeason.create({data:{guildId:guild.id,name:"Observed",startsAt:from,endsAt:to,ratingRules:rules as unknown as Prisma.InputJsonValue}});
      for(const run of legacyFirst?[legacy,modern]:[modern,legacy]) {
        await db.$transaction(tx=>importDungeonRuns(tx,guild.id,[run],[{name:"Tester",realm:"TestRealm",memberId:member.id}],"release-test",null,now));
        await publishGuildRuns(db,store,now);
        await ingestPublicRuns(store,{uploaderKey:`mixed-${label}`,character:"Tester",source:"personal",runs:[run]},now);
      }
      assert.deepEqual((await dungeonRating(db,guild.id,season,null,true)).map(r=>r.points),[400],"legacy arrival order must not veto source evidence");
      const row=await db.publicRun.findFirstOrThrow({where:{runRef:modern.id},select:{...PUBLIC_RUN_SELECT,status:true}});
      assert.equal(row.status,"ACCEPTED");assert.equal(characterScores([leaderRun(row)],rules)[0]?.points,400);
      assert.equal(row.confirmations,1,"same-origin revisions and guild relays do not add confirmations");
      assert.equal(await db.publicRunUpload.count({where:{runId:row.id,uploaderKey:`mixed-${label}`}}),1);
      const guildUpload=await db.publicRunUpload.findUniqueOrThrow({where:{runId_uploaderKey:{runId:row.id,uploaderKey:`guild:${guild.id}`}}});
      assert.equal((guildUpload.evidence as {integrity:{run:{observer:string}}}).integrity.run.observer,"Tester","publisher must revise known run refs");
      if(legacyFirst) assert.equal((guildUpload.evidence as {previousRevisions:unknown[]}).previousRevisions.length,1);
      assert.equal(await publishGuildRuns(db,store,now),0,"identical publisher retry is not a revision");
    }
    for(const reverse of [false,true]) {
      const order=(reverse?[b,a]:[a,b]).map(r=>({...structuredClone(r),id:`observed-${reverse}-${r.id}`}));
      const guild=await db.guild.create({data:{discordId:`release-test-observed-${reverse}`,name:"Observed fixture"}});
      const members=await Promise.all(["Tester","Peer"].map(name=>db.member.create({data:{guildId:guild.id,discordUserId:name,displayName:name}})));
      const characters=members.map(m=>({name:m.displayName,realm:"TestRealm",memberId:m.id}));
      const season=await db.dungeonSeason.create({data:{guildId:guild.id,name:"Observed",startsAt:from,endsAt:to,ratingRules:rules as unknown as Prisma.InputJsonValue}});
      for(const run of order) await db.$transaction(tx=>importDungeonRuns(tx,guild.id,[run],characters,"release-test",null,now));
      const rating=await dungeonRating(db,guild.id,season,null,true);
      assert.deepEqual(rating.map(r=>r.points),[400,400],"guild participation must not depend on first observer");
      const stored=await db.dungeonRun.findUniqueOrThrow({where:{guildId_runRef:{guildId:guild.id,runRef:order[0]!.id}}});
      assert.equal((stored.competitionData as {observerReports:unknown[]}).observerReports.length,2);
      const points=await db.dungeonPointTransaction.count({where:{guildId:guild.id}});
      const awards=await db.dungeonPointTransaction.groupBy({by:["memberId"],where:{guildId:guild.id},_sum:{amount:true}});
      assert.deepEqual(awards.map(r=>r._sum.amount).sort(),[75,75],"both observer orders award each newly eligible account once");
      assert.equal(await db.dungeonAchievement.count({where:{guildId:guild.id,key:"firstBlood"}}),2,"late eligibility earns achievements too");
      await Promise.all(order.map(run=>db.$transaction(tx=>importDungeonRuns(tx,guild.id,[run],characters,"release-test",null,now))));
      assert.equal(await db.dungeonPointTransaction.count({where:{guildId:guild.id}}),points,"retries never award again");
      const richer=structuredClone(order[0]!);richer.encounters!.push({id:2000,success:true,at:a.startedAt!+300,source:"native"});
      await db.$transaction(tx=>importDungeonRuns(tx,guild.id,[richer],characters,"release-test",null,now));
      assert.equal(await db.dungeonPointTransaction.count({where:{guildId:guild.id}}),points,"richer revisions never re-award an account");
      assert.equal(await db.dungeonAchievement.count({where:{guildId:guild.id,key:"firstBlood"}}),2);

      for(const run of order) await ingestPublicRuns(store,{uploaderKey:`observed-${reverse}-${run.integrity!.observer}`,character:run.integrity!.observer!,source:"personal",runs:[run]},now);
      await ingestPublicRuns(store,{uploaderKey:`relay-${reverse}`,character:"Peer",source:"personal",runs:[order.find(r=>r.integrity!.observer==="Tester")!]},now);
      const publicRow=await db.publicRun.findFirstOrThrow({where:{runRef:order[0]!.id},select:{...PUBLIC_RUN_SELECT,status:true}});
      assert.equal(publicRow.status,"ACCEPTED");assert.equal(publicRow.confirmations,2,"relay is not an independent observer");
      assert.deepEqual(characterScores([leaderRun(publicRow)],rules).map(r=>r.points),[400,400]);
      assert.equal(await db.publicRunUpload.count({where:{runId:publicRow.id}}),3,"retain the relay's source report too");

      await db.dungeonSeason.update({where:{id:season.id},data:{status:"CLOSING"}});
      await db.dungeonSeason.create({data:{guildId:guild.id,name:"Next",startsAt:to,ratingRules:publicRules() as unknown as Prisma.InputJsonValue}});
      const deadline=new Date(to.getTime()+UPLOAD_GRACE_MS);
      // The importer holds the shared lock while finalization starts; the final
      // snapshot must wait for that transaction, then remain immutable on retry.
      let entered!:()=>void, release!:()=>void;
      const ready=new Promise<void>(resolve=>{entered=resolve;}), gate=new Promise<void>(resolve=>{release=resolve;});
      if (!reverse) {
        const importing=db.$transaction(async tx=>{
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${guild.id},0))`;
          entered();await gate;
          return importDungeonRuns(tx,guild.id,[order[0]!],characters,"release-test",null,new Date(deadline.getTime()-1));
        });
        await ready;
        const finalizing=Promise.all([1,2,3].map(()=>finalizeClosingSeasons(db,deadline,id=>id===guild.discordId)));
        release();await importing;
        assert.equal((await finalizing).flat().filter(id=>id===guild.id).length,1);
      } else {
        const held=new Proxy(db,{get(target,prop){if(prop!=="$transaction")return Reflect.get(target,prop);
          return (action:(tx:Prisma.TransactionClient)=>Promise<unknown>)=>target.$transaction(tx=>action(new Proxy(tx,{get(t,p){
            if(p!=="$executeRaw")return Reflect.get(t,p);
            return async(...args:Parameters<typeof tx.$executeRaw>)=>{const result=await tx.$executeRaw(...args);entered();await gate;return result;};
          }})));}});
        const finalizing=finalizeClosingSeasons(held,deadline,id=>id===guild.discordId);
        await ready;
        const queued=structuredClone(order[0]!);queued.players[0]!.deaths=(queued.players[0]!.deaths??0)+1;
        const importing=db.$transaction(tx=>importDungeonRuns(tx,guild.id,[queued],characters,"release-test",null,new Date(deadline.getTime()-1)));
        release();assert.deepEqual(await finalizing,[guild.id]);await importing;
        const after=await db.dungeonRun.findUniqueOrThrow({where:{id:stored.id}});
        assert.equal((after.competitionData as {lateObserverReports:unknown[]}).lateObserverReports.length,1,"finalization wins: queued request cannot reopen awards even with earlier receipt time");
        assert.deepEqual(await finalizeClosingSeasons(db,deadline,id=>id===guild.discordId),[]);
      }
      const finalized=await db.dungeonSeason.findUniqueOrThrow({where:{id:season.id}});
      assert.equal(finalized.status,"ENDED");assert.deepEqual((finalized.finalRating as {points:number}[]).map(r=>r.points),[400,400]);
      assert.equal(await db.dungeonAchievement.count({where:{seasonId:season.id,key:`seasonChampion:${season.id}`}}),2);
      const late=structuredClone(order[0]!);late.players[0]!.integrity!.mixedRole=true;
      await db.$transaction(tx=>importDungeonRuns(tx,guild.id,[late],characters,"release-test",null,new Date(deadline.getTime()+1)));
      assert.deepEqual((await db.dungeonSeason.findUniqueOrThrow({where:{id:season.id}})).finalRating,finalized.finalRating);
      assert.equal(await db.dungeonAchievement.count({where:{seasonId:season.id,key:`seasonChampion:${season.id}`}}),2);
      const publicLate=await ingestPublicRuns(store,{uploaderKey:`late-${reverse}`,character:"Tester",source:"personal",runs:[late]},new Date(deadline.getTime()+1));
      assert.equal(publicLate.historyOnly.length,1);
      assert.equal((await db.publicRun.findUniqueOrThrow({where:{id:publicRow.id}})).confirmations,2);
    }
    // Exercise the real calendar writer while a real import holds the shared
    // calendar lock: no half-applied official/guild cutoff can escape the commit.
    const guild=await db.guild.create({data:{discordId:"release-test-calendar",name:"Calendar fixture",settings:{create:{}}}});
    const season=await db.dungeonSeason.create({data:{guildId:guild.id,name:"Observed",startsAt:from,endsAt:to,ratingRules:rules as unknown as Prisma.InputJsonValue}});
    let entered!:()=>void, release!:()=>void, writing!:()=>void;
    const ready=new Promise<void>(resolve=>{entered=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;}),writerReady=new Promise<void>(resolve=>{writing=resolve;});
    const importing=db.$transaction(async tx=>{
      await lockDungeonCalendar(tx);entered();await gate;
      await importDungeonRuns(tx,guild.id,[{...a,id:`calendar-${a.id}`}],[],"release-test",null,now);
      assert.equal((await tx.dungeonSeason.findUniqueOrThrow({where:{id:season.id}})).endsAt?.getTime(),to.getTime());
    });
    await ready;
    const writer=new Proxy(db,{get(target,prop){if(prop!=="$transaction")return Reflect.get(target,prop);
      return (action:(tx:Prisma.TransactionClient)=>Promise<unknown>)=>target.$transaction(tx=>action(new Proxy(tx,{get(t,p){
        if(p!=="$executeRaw")return Reflect.get(t,p);
        return (...args:Parameters<typeof tx.$executeRaw>)=>{writing();return tx.$executeRaw(...args);};
      }})));}});
    const moved=new Date(to.getTime()+60000);
    const changing=scheduleNextSeason(writer,{name:"Moved",startsAt:moved,actorId:"release-test"},now);
    await writerReady;
    assert.equal((await db.dungeonSeason.findUniqueOrThrow({where:{id:season.id}})).endsAt?.getTime(),to.getTime());
    release();await importing;await changing;
    assert.equal((await db.dungeonSeason.findUniqueOrThrow({where:{id:season.id}})).endsAt?.getTime(),moved.getTime());
    await cancelNextSeason(db,now);
    assert.equal((await db.dungeonSeason.findUniqueOrThrow({where:{id:season.id}})).endsAt,null,"cancel publishes unbounded window atomically");
    // A queued rotation with a stale window must reread the committed calendar.
    await rotateOfficialSeasons(db,officialWindows([{number:900,name:"Observed",startsAt:from,rules:snapshot},{number:901,name:"Old next",startsAt:to}]),now,
      id=>id===guild.discordId,async()=>undefined,async()=>{throw new Error("Must not rotate current season");});
    assert.equal((await db.dungeonSeason.findUniqueOrThrow({where:{id:season.id}})).endsAt,null);
    const restored=await scheduleNextSeason(db,{name:"Observed next",startsAt:to,actorId:"release-test"},now);
    assert.equal(restored.number,901);
    console.log("Observed native capture: both upload orders, sourced participation, relay dedup, concurrent nonempty finalization and late-history preservation passed in PostgreSQL.");
    console.log("Mixed legacy/provenance orders and atomic calendar schedule/cancel/import/stale-rotation checks passed.");
  } finally {
    await db.officialSeason.deleteMany({where:{OR:[{id:{in:[official.id,next.id]}},{gameEdition:"forever",number:{in:[900,901]}}]}});
  }
}
