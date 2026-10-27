import assert from "node:assert/strict";
import type { Prisma, PrismaClient } from "../src/generated/prisma/client.js";
import { dungeonRoleFixture } from "../tests/fixtures/dungeon-role-contract.js";
import { importDungeonRuns } from "../src/services/dungeon-import.js";
import { dungeonRating } from "../src/services/dungeon-rating.js";
import { finalizeClosingSeasons } from "../src/services/dungeon-admin.js";
import { UPLOAD_GRACE_MS } from "../src/services/dungeon-integrity.js";
import { ingestPublicRuns, prismaPublicRunStore } from "../src/services/public-runs.js";
import { leaderRun, PUBLIC_RUN_SELECT } from "../src/services/public-leaderboard.js";
import { characterScores, publicRules, snapshotRules } from "../src/services/public-score.js";

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
      await Promise.all(order.map(run=>db.$transaction(tx=>importDungeonRuns(tx,guild.id,[run],characters,"release-test",null,now))));
      assert.equal(await db.dungeonPointTransaction.count({where:{guildId:guild.id}}),points,"retries never award again");

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
      const importing=db.$transaction(async tx=>{
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${guild.id},0))`;
        entered();await gate;
        return importDungeonRuns(tx,guild.id,[order[0]!],characters,"release-test",null,new Date(deadline.getTime()-1));
      });
      await ready;
      const finalizing=Promise.all([1,2,3].map(()=>finalizeClosingSeasons(db,deadline,id=>id===guild.discordId)));
      release();await importing;
      assert.equal((await finalizing).flat().filter(id=>id===guild.id).length,1);
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
    console.log("Observed native capture: both upload orders, sourced participation, relay dedup, concurrent nonempty finalization and late-history preservation passed in PostgreSQL.");
  } finally {
    await db.officialSeason.deleteMany({where:{id:{in:[official.id,next.id]}}});
  }
}
