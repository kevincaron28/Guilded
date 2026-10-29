import assert from "node:assert/strict";
import type { PrismaClient } from "../src/generated/prisma/client.js";
import { createCompanionManage, type ManageAccess } from "../src/services/companion-manage.js";
import { createEpgpService } from "../src/services/epgp.js";
import { decemberPricing } from "../src/services/raid-pricing.js";
import { applyAddonLoot } from "../src/services/raid-import.js";
import { lootRulesForAddon } from "../src/services/loot-rules-export.js";

// Only invoked by verify-postgres against the disposable local rehearsal database.
export async function verifyRaidPricingPostgres(database: PrismaClient) {
  const guild=await database.guild.create({data:{discordId:"release-test-pricing",name:"Pricing rehearsal",gameEdition:"forever",settings:{create:{coreLootOnly:true}}}});
  try {
    const member=await database.member.create({data:{guildId:guild.id,discordUserId:"release-test-pricing-member",displayName:"Ann"}});
    const character=await database.character.create({data:{guildId:guild.id,memberId:member.id,name:"Ann",realm:"Forever",className:"Warrior",isMain:true}});
    await database.character.create({data:{guildId:guild.id,memberId:member.id,name:"Annalt",realm:"Forever",className:"Mage"}});
    const leader:ManageAccess={memberId:member.id,actorId:"release-test",officer:true,raidLeader:true};
    const manage=createCompanionManage(database);
    await assert.rejects(manage.apply(guild.id,{...leader,officer:false,raidLeader:false},{action:"pricing.create",name:"Unauthorized"}),{status:403});
    const made=await manage.apply(guild.id,leader,{action:"pricing.create",name:"December"});
    const core=await database.raidCore.findUniqueOrThrow({where:{id:made.rosterCoreId!}});
    assert.equal(core.lootMode,"PRIORITY");assert.equal(core.baseGp,100);assert.equal(core.attendanceEp,100);
    assert.equal(core.separatePool,true);assert.equal(core.pricingAutoDecay,true);
    assert.equal(await database.epgpTransaction.count({where:{guildId:guild.id}}),0);
    await database.raidCoreMember.create({data:{coreId:core.id,memberId:member.id,characterId:character.id,role:"DPS"}});
    const rival=await database.member.create({data:{guildId:guild.id,discordUserId:"release-test-pricing-rival",displayName:"Bob"}});
    await database.raidCoreMember.create({data:{coreId:core.id,memberId:rival.id,role:"DPS"}});
    const points=createEpgpService(database);
    for(const m of[member,rival])await points.createTransaction({guildId:guild.id,memberId:m.id,coreId:core.id,type:"EP_AWARD",epAmount:100,gpAmount:0,reason:"Attendance",createdBy:"release-test"});
    const plain=await database.raidCore.create({data:{guildId:guild.id,name:"Existing",separatePool:true,baseGp:1000}});
    await points.createTransaction({guildId:guild.id,memberId:member.id,coreId:plain.id,type:"EP_AWARD",epAmount:10,gpAmount:0,reason:"Old attendance",createdBy:"release-test"});
    await assert.rejects(manage.apply(guild.id,leader,{action:"pricing.enable",coreId:plain.id,revision:0,applyRules:true}),{status:409});
    await manage.apply(guild.id,leader,{action:"pricing.enable",coreId:plain.id,revision:0,applyRules:false});
    assert.equal((await database.raidCore.findUniqueOrThrow({where:{id:plain.id}})).baseGp,1000);
    await assert.rejects(manage.apply("different-guild",leader,{action:"pricing.update",coreId:core.id,revision:1,slots:decemberPricing("forever").slots}),{status:404});
    const edits=await Promise.allSettled([175,200].map(trinket=>manage.apply(guild.id,leader,{action:"pricing.update",coreId:core.id,revision:1,slots:{...decemberPricing("forever").slots,trinket}})));
    assert.equal(edits.filter(x=>x.status==="fulfilled").length,1);
    assert.equal(edits.filter(x=>x.status==="rejected").length,1);
    assert.equal((await database.raidCore.findUniqueOrThrow({where:{id:core.id}})).pricingRevision,2);
    const view=await manage.view(guild.id,{...leader,officer:false,raidLeader:false});
    assert.deepEqual(view.members,[]);const board=view.cores.find(c=>c.id===core.id)!.leaderboard;
    assert.equal(board.length,2);assert.deepEqual(board.map(r=>r.rank),[1,1]);assert.deepEqual(board.map(r=>r.pr),[1,1]);
    const raid=await database.raid.create({data:{guildId:guild.id,coreId:core.id,title:"Pricing night",createdBy:"release-test",scheduledAt:new Date(),status:"COMPLETED"}});
    const pricing={preset:"december-flat-v1" as const,revision:1,edition:"forever",coreId:core.id,itemLink:"item:12345",baseGp:75,finalGp:38,response:"offspec" as const,source:"slot" as const,provisional:false};
    const loot={ref:"release-test-pricing-award",character:character.name,realm:character.realm,item:"Gloves",gp:38,raidRef:"raid",pricing};
    const imports=()=>database.$transaction(tx=>applyAddonLoot(tx,guild.id,[loot],[character],new Map([["raid",raid.id]]),"release-test",true));
    assert.equal((await imports()).recorded,1);assert.equal((await imports()).recorded,0);
    assert.deepEqual((await database.lootAward.findUniqueOrThrow({where:{sourceRef:loot.ref}})).pricingSnapshot,pricing);
    const mismatch=await database.$transaction(tx=>applyAddonLoot(tx,guild.id,[{...loot,ref:"wrong-edition",pricing:{...pricing,edition:"retail"}}],[character],new Map([["raid",raid.id]]),"release-test",true));
    assert.equal(mismatch.held.length,1);
    await database.coreItemValue.createMany({data:Array.from({length:501},(_,i)=>({guildId:guild.id,coreId:core.id,itemKey:`#${10000+i}`,itemId:10000+i,itemName:`Item ${10000+i}`,gp:i}))});
    const feed=await lootRulesForAddon(database,guild.id,async()=>[]);
    assert.equal(feed.cores.find(c=>c.id===core.id)!.values.length,501);
    assert.equal((await points.getStanding(member.id,100,core.id)).ep,100);
    console.log("Pricing: scoped permissions, pool preservation, concurrent revisions, alt-safe ties, immutable quote import and 501 exceptions passed.");
  } finally {await database.guild.delete({where:{id:guild.id}});}
}
