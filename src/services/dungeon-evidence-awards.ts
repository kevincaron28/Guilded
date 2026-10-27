import type { Prisma } from "../generated/prisma/client.js";
import { currentIntegrityPolicy, withIntegrityWindow } from "./dungeon-integrity.js";
import { validBracketedRules } from "./dungeon-november-rules.js";
import { participationDungeonKey, participationMode, participationRecordEligible } from "./dungeon-participation.js";
import { computeWeeklyVarietyPoints, sharedDungeonConfig, weekStart, type PlayerContext } from "./dungeon-rules.js";
import { qualifiedAchievements, type AchievementKey } from "./dungeon-achievements.js";

type Tx=Pick<Prisma.TransactionClient,"dungeonRun"|"dungeonPointTransaction"|"dungeonAchievement"|"auditLog">;
const awardSources=["rule:completion","rule:weeklyVariety","evidence:completion","evidence:weeklyVariety"];

/** Called under the guild/calendar locks. Re-evaluate affected account/weeks,
 * append compensating entries, never rewrite a ledger row or a finalized season.
 * Achievement state is a projection; every source/revocation change is audited. */
export async function reconcileEvidenceAwards(tx:Tx,guildId:string,changedRunId:string,memberIds:string[],actorId:string,now:Date) {
  const deltas=new Map<string,number>();
  if(!memberIds.length) return deltas;
  const config=sharedDungeonConfig();
  const runs=await tx.dungeonRun.findMany({where:{guildId,valid:true,state:"COMPLETED",durationSec:{not:null},endedAt:{not:null}},include:{players:true,season:true},orderBy:[{endedAt:"asc"},{runRef:"asc"}]});
  const changed=runs.find(r=>r.id===changedRunId);
  if(!changed?.endedAt) return deltas;
  const affectedWeek=weekStart(changed.endedAt).getTime();
  const eligible=runs.flatMap(run=>{
    if(!run.season || !validBracketedRules(run.season.ratingRules) || run.runRef.startsWith("SIM-")) return [];
    const rules=withIntegrityWindow(run.season.ratingRules,run.season.startsAt,run.season.endsAt);
    if(!run.startedAt || run.startedAt<run.season.startsAt || run.season.endsAt && run.endedAt!>=run.season.endsAt) return [];
    const route=participationDungeonKey(run,rules), band=rules.participationLevelBands[route];
    const selected=new Set<string>();
    const players=[...run.players].sort((a,b)=>b.presentSec-a.presentSec||a.character.localeCompare(b.character)).flatMap(player=>{
      if(!player.memberId || selected.has(player.memberId)) return [];
      const mode=participationMode(run,player.character,band,rules);
      if(mode==="none") return [];
      selected.add(player.memberId);return [{...player,memberId:player.memberId,mode}];
    });
    return [{run,rules,route,band,players,record:participationRecordEligible(run,band,rules)}];
  });
  const ledger=await tx.dungeonPointTransaction.findMany({where:{guildId,memberId:{in:memberIds},source:{in:awardSources}},select:{runId:true,memberId:true,source:true,amount:true}});
  const balances=new Map<string,number>();
  for(const row of ledger) {const key=`${row.runId}|${row.memberId}|${row.source.split(":")[1]}`;balances.set(key,(balances.get(key)??0)+row.amount);}
  const mutable=runs.filter(run=>run.season && run.season.status!=="ENDED" && currentIntegrityPolicy(run.season.ratingRules) && weekStart(run.endedAt!).getTime()===affectedWeek);
  for(const memberId of new Set(memberIds)) {
    const desired=new Map<string,number>(),counts=new Map<string,number>();
    for(const entry of eligible) {
      const player=entry.players.find(p=>p.memberId===memberId);
      if(!player || weekStart(entry.run.endedAt!).getTime()!==affectedWeek) continue;
      const key=entry.route, earlier=counts.get(key)??0;
      counts.set(key,earlier+1);
      const context:PlayerContext={memberId,character:player.character,deaths:player.deaths,earlierThisWeek:earlier,firstEver:false,previousBest:null,participationMode:player.mode};
      for(const award of computeWeeklyVarietyPoints({instanceId:entry.run.instanceId,dungeonKey:entry.route,durationSec:entry.run.durationSec!,fullGuildGroup:false,guildRecord:false,players:[context],config})) desired.set(`${entry.run.id}|${memberId}|${award.rule}`,award.amount);
    }
    for(const run of mutable) for(const rule of ["completion","weeklyVariety"] as const) {
      const key=`${run.id}|${memberId}|${rule}`,amount=(desired.get(key)??0)-(balances.get(key)??0);
      if(!amount) continue;
      await tx.dungeonPointTransaction.create({data:{guildId,memberId,runId:run.id,seasonId:run.seasonId,amount,
        source:`evidence:${rule}`,reason:`Evidence reconciliation: ${rule} - ${run.dungeonName}`,createdBy:actorId,createdAt:now}});
      if(run.id===changedRunId) deltas.set(memberId,(deltas.get(memberId)??0)+amount);
    }

    // Earliest genuinely eligible supporting run per achievement. Source changes
    // retain the old run/time in AuditLog; no achievement history is deleted.
    const supporting=new Map<AchievementKey,typeof eligible[number]>(),distinct=new Set<number>(),best=new Map<string,number>();
    for(const entry of eligible) {
      const previous=best.get(entry.route);
      if(entry.record) best.set(entry.route,Math.min(previous??Infinity,entry.run.durationSec!));
      const player=entry.players.find(p=>p.memberId===memberId && p.mode==="full");
      if(!player) continue;
      distinct.add(entry.run.instanceId);
      const facts={guildRecord:previous!==undefined && entry.record && entry.run.durationSec!<previous,
        fullGuildGroup:entry.run.players.length>=5 && entry.run.players.every(p=>p.inGuild),
        underTarget:false, // v2 weekly-variety participation has no speed bonus target.
        deathless:entry.run.players.every(p=>p.deaths===0)};
      for(const key of qualifiedAchievements(facts,distinct.size,config.dungeonMasterCount)) if(!supporting.has(key)) supporting.set(key,entry);
    }
    const achievements=await tx.dungeonAchievement.findMany({where:{guildId,memberId,NOT:{key:{startsWith:"seasonChampion:"}}}});
    for(const row of achievements) {
      const source=supporting.get(row.key as AchievementKey);
      // Historical finalized awards are immutable. Only an open v2 source or a
      // previously revoked projection can be corrected by this workflow.
      const original=runs.find(r=>r.id===row.runId);
      if(!row.revokedAt && (!original?.season || original.season.status==="ENDED" || !currentIntegrityPolicy(original.season.ratingRules))) continue;
      if(source && !row.revokedAt && row.runId===source.run.id || !source && row.revokedAt) continue;
      const after=source ? {runId:source.run.id,seasonId:source.run.seasonId,earnedAt:source.run.createdAt,revokedAt:null} : {revokedAt:now};
      await tx.auditLog.create({data:{guildId,actorId,action:"DUNGEON_ADMIN",entityId:row.id,metadata:{area:"dungeon-evidence-achievement",memberId,key:row.key,
        before:{runId:row.runId,seasonId:row.seasonId,earnedAt:row.earnedAt.toISOString(),revokedAt:row.revokedAt?.toISOString()??null},
        after:source?{runId:source.run.id,seasonId:source.run.seasonId,earnedAt:source.run.createdAt.toISOString(),revokedAt:null}:{revokedAt:now.toISOString()}}}});
      await tx.dungeonAchievement.update({where:{id:row.id},data:after});
    }
    for(const [key,source] of supporting) {
      if(achievements.some(row=>row.key===key) || !source.run.season || source.run.season.status==="ENDED" || !currentIntegrityPolicy(source.run.season.ratingRules)) continue;
      const created=await tx.dungeonAchievement.create({data:{guildId,memberId,key,runId:source.run.id,seasonId:source.run.seasonId,earnedAt:source.run.createdAt}});
      await tx.auditLog.create({data:{guildId,actorId,action:"DUNGEON_ADMIN",entityId:created.id,metadata:{area:"dungeon-evidence-achievement",memberId,key,before:null,
        after:{runId:source.run.id,seasonId:source.run.seasonId,earnedAt:source.run.createdAt.toISOString(),revokedAt:null}}}});
    }
  }
  return deltas;
}
