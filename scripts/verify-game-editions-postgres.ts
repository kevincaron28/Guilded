import { guildWhere, withGuildScope } from "../src/services/guild-scope.js";
import assert from "node:assert/strict";
import type { PrismaClient } from "../src/generated/prisma/client.js";
import { provisionWowGuild, registerWowGuild, resolveWowGuild } from "../src/services/wow-guilds.js";
import { GAME_EDITIONS } from "../companion/game-edition.mjs";
import { createGuildService } from "../src/services/guild.js";
import { exchangeCharacterPairingCode, hashCompanionSecret, issueCharacterPairingCode } from "../src/services/character-pairing.js";

export async function verifyGameEditionsPostgres(database: PrismaClient, guildId: string) {
  const forever = await registerWowGuild(database, guildId, { gameEdition: "forever", name: "Edition fixture", realm: "Forever" });
  const retail = await registerWowGuild(database, guildId, { gameEdition: "retail", name: "Edition fixture", realm: "TestRealm" });
  const era = await registerWowGuild(database, guildId, { gameEdition: "classic-era", name: "Edition fixture", realm: "TestRealm" });
  assert.equal(new Set([forever.id, retail.id, era.id]).size, 3);
  assert.equal((await registerWowGuild(database, guildId, { gameEdition: "retail", name: " edition fixture ", realm: "testrealm" })).id, retail.id);
  await assert.rejects(resolveWowGuild(database, guildId), /Choose the in-game guild/);
  assert.equal((await resolveWowGuild(database, guildId, retail.id)).gameEdition, "retail");
  await assert.rejects(resolveWowGuild(database, "another-server", retail.id), /not configured in this Discord/);
  const root = await database.guild.findUniqueOrThrow({where:{id:guildId}});
  await database.wowGuild.update({where:{id:forever.id},data:{scopeGuildId:guildId}});
  let index=0;
  for (const gameEdition of [...GAME_EDITIONS, "retail"] as const) {
    const second=index===5;
    const space=gameEdition==="forever"?{scopeGuildId:guildId}:await provisionWowGuild(database,guildId,{gameEdition,name:second?"Second retail guild":"Edition fixture",realm:"TestRealm"},{officer:`officer-${index}`,member:`members-${index}`});
    const id=space.scopeGuildId!;
    const member=await database.member.create({data:{guildId:id,discordUserId:"edition-fixture",displayName:"Edition fixture"}});
    const base={guildId:id,memberId:member.id,gameEdition,name:"EditionFixture",realm:"TestRealm",className:"Warrior"};
    await database.character.create({data:base});
    await assert.rejects(database.character.create({data:base}), (error: unknown)=>Boolean(error&&typeof error==="object"&&"code" in error&&error.code==="P2002"));
    await assert.rejects(database.character.create({data:{...base,name:"WrongEdition",gameEdition:gameEdition==="retail"?"forever":"retail"}}));
    if(gameEdition!=="forever") await database.guildSettings.update({where:{guildId:id},data:{baseGp:700+index}});
    await withGuildScope(database,id,async()=>{
      assert.equal((await createGuildService(database).ensureGuild(root.discordId,"Must not rename this guild")).id,id);
      if(gameEdition!=="forever") assert.equal((await createGuildService(database).getSettings(id))?.baseGp,700+index);
    });
    await database.wowGuildChannel.create({data:{discordId:root.discordId,channelId:`edition-channel-${index}`,scopeGuildId:id}});
    const code=await issueCharacterPairingCode(database,id,member.id);
    const grant=await exchangeCharacterPairingCode(database,root.discordId,code.code);
    assert.equal(grant.wowGuildId,id); assert.equal(grant.gameEdition,gameEdition);
    const credential=await database.companionCredential.findFirstOrThrow({where:{tokenHash:hashCompanionSecret(grant.companionCredential)},include:{member:true}});
    assert.equal(credential.member.guildId,id);
    index++;
  }
  await database.wowGuildSelection.create({data:{discordId:root.discordId,userId:"edition-fixture",scopeGuildId:guildId}});
}

export async function verifyGameEditionsRestored(database: PrismaClient) {
  const guild = await database.guild.findUniqueOrThrow({ where: guildWhere("release-test-guild") });
  assert.equal(await database.wowGuild.count({ where: { guildId: guild.id } }), 6);
  const chars=await database.character.findMany({where:{name:"EditionFixture",realm:"TestRealm"},orderBy:{gameEdition:"asc"},include:{member:{include:{guild:{include:{settings:true}}}}}});
  assert.deepEqual(chars.map(row=>row.gameEdition),["classic-era","classic-mists","classic-tbc","forever","retail","retail"]);
  assert.equal(new Set(chars.map(row=>row.guildId)).size,6);
  for(const char of chars){assert.equal(char.guildId,char.member.guildId);assert.equal(char.gameEdition,char.member.guild.gameEdition);if(char.gameEdition!=="forever")assert.ok(char.member.guild.settings!.baseGp>=700);}
  assert.equal(await database.wowGuildChannel.count({where:{discordId:guild.discordId}}),6);
  assert.equal(await database.wowGuildSelection.count({where:{discordId:guild.discordId}}),1);
  assert.equal(await database.companionCredential.count({where:{member:{discordUserId:"edition-fixture"},revokedAt:null}}),6);
}
