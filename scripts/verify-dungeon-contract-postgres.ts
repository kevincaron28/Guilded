import assert from "node:assert/strict";
import type { Prisma, PrismaClient } from "../src/generated/prisma/client.js";
import { dungeonRoleFixture } from "../tests/fixtures/dungeon-role-contract.js";
import { importDungeonRuns } from "../src/services/dungeon-import.js";
import { dungeonRating } from "../src/services/dungeon-rating.js";
import { ingestPublicRuns, prismaPublicRunStore } from "../src/services/public-runs.js";
import { PUBLIC_RUN_SELECT, leaderRun } from "../src/services/public-leaderboard.js";
import { characterScores, publicRules, snapshotRules, rateRun } from "../src/services/public-score.js";
import { roleScores } from "../src/services/public-guidance.js";
import { publicAddonBoard } from "../src/services/public-addon-board.js";
import { dungeonRole } from "../companion/dungeon-role.mjs";

// Only invoked by verify-postgres.ts after its disposable-local database guard.
export async function verifyDungeonContractPostgres(db: PrismaClient) {
  const {run}=dungeonRoleFixture(false,"DAMAGER",{nativeApi:true});run.id="contract-"+run.id;
  const now=new Date((run.endedAt!+1)*1000);
  const rules=snapshotRules(publicRules(),new Date(run.startedAt!*1000)).rules;
  const guild=await db.guild.create({data:{discordId:"release-test-dungeon-contract",name:"Dungeon contract fixture"}});
  const member=await db.member.create({data:{guildId:guild.id,discordUserId:"contract",displayName:"Tester"}});
  const season=await db.dungeonSeason.create({data:{guildId:guild.id,name:"Current evidence contract",startsAt:new Date((run.startedAt!-1)*1000),ratingRules:rules as unknown as Prisma.InputJsonValue}});
  const linked=[{name:"Tester",realm:"TestRealm",memberId:member.id}];
  const imported=await db.$transaction(tx=>importDungeonRuns(tx,guild.id,[run],linked,"release-test",null,now));
  assert.equal(imported.results[0]?.valid,true);
  const stored=await db.dungeonRun.findUniqueOrThrow({where:{guildId_runRef:{guildId:guild.id,runRef:run.id}},include:{players:true}});
  assert.equal(stored.players[0]?.role,"DPS");
  const guildScores=await dungeonRating(db,guild.id,season,null,true);
  assert.equal(guildScores[0]?.points,400);assert.equal(guildScores[0]?.roles?.find(r=>dungeonRole(r.role)==="DPS")?.points,400);
  const store=prismaPublicRunStore(db), request={uploaderKey:"contract-uploader",character:"Tester",source:"personal" as const,runs:[run]};
  assert.equal((await ingestPublicRuns(store,request,now)).accepted.length,1);
  assert.equal((await ingestPublicRuns(store,request,now)).duplicates.length,1);
  const row=await db.publicRun.findFirstOrThrow({where:{runRef:run.id},select:PUBLIC_RUN_SELECT});
  assert.equal(row.players[0]?.role,"DPS");assert.equal(row.evidenceVersion,2);
  const publicRun=leaderRun(row), me=publicRun.players[0]!;
  assert.equal(roleScores([publicRun],rules,me).roles.find(r=>r.role==="DPS")?.rows[0]?.points,400);
  const other=structuredClone(run);other.integrity!.startTrigger="peer";
  other.players[0]!.integrity={knownSec:300,unknownSec:900,mixedRole:false};
  assert.equal((await ingestPublicRuns(store,{...request,uploaderKey:"contract-observer",runs:[other]},now)).confirmed.length,1);
  assert.equal((await db.publicRun.findUniqueOrThrow({where:{id:row.id}})).status,"ACCEPTED");
  const observations=await db.publicRunUpload.findMany({where:{runId:row.id},select:{evidence:true}});
  assert.equal(observations.length,2);assert.ok(observations.every(o=>o.evidence!==null));
  const standalone=dungeonRoleFixture(true,"DAMAGER",{nativeApi:true}).run;
  assert.equal(standalone.startedAt,run.startedAt);assert.deepEqual(standalone.encounters,run.encounters);
  assert.equal(rateRun(publicRun,rules).score?.points,400);
  const board=publicAddonBoard([publicRun],me,[{id:"s1",label:"Official",labelFr:"Officielle",from:season.startsAt,to:null,rules}],now)!;
  assert.equal(board.profiles[0]?.roles.find(r=>dungeonRole(r.role)==="DPS")?.points,400);
  // Read-only alias compatibility on pre-existing rows, without a rewrite migration.
  await db.dungeonRunPlayer.updateMany({where:{runId:stored.id},data:{role:"DAMAGER"}});
  assert.equal((await dungeonRating(db,guild.id,season,null,true))[0]?.roles?.[2]?.points,400);
  await db.publicRun.update({where:{id:row.id},data:{evidenceVersion:0}});
  const legacy=leaderRun(await db.publicRun.findUniqueOrThrow({where:{id:row.id},select:PUBLIC_RUN_SELECT}));
  assert.equal(characterScores([legacy],rules).length,0);assert.equal(characterScores([legacy],publicRules())[0]?.points,400);
  assert.equal(await db.publicRun.count({where:{id:row.id}}),1,"legacy history retained");
  await db.dungeonSeason.update({where:{id:season.id},data:{status:"ENDED",finalRating:guildScores as unknown as Prisma.InputJsonValue}});
  const archive=await db.dungeonSeason.findUniqueOrThrow({where:{id:season.id}});
  assert.deepEqual(await dungeonRating(db,guild.id,archive,null,true),guildScores,"finalized role totals are not recalculated");
  console.log("Actual Lua -> companion -> guild/public database -> guild/web/standalone role and official evidence contract passed.");
}
