import assert from "node:assert/strict";
import type { PrismaClient } from "../src/generated/prisma/client.js";
import { registerWowGuild, resolveWowGuild } from "../src/services/wow-guilds.js";

export async function verifyGameEditionsPostgres(database: PrismaClient, guildId: string) {
  const forever = await registerWowGuild(database, guildId, { gameEdition: "forever", name: "Edition fixture", realm: "Forever" });
  const retail = await registerWowGuild(database, guildId, { gameEdition: "retail", name: "Edition fixture", realm: "TestRealm" });
  const era = await registerWowGuild(database, guildId, { gameEdition: "classic-era", name: "Edition fixture", realm: "TestRealm" });
  assert.equal(new Set([forever.id, retail.id, era.id]).size, 3);
  assert.equal((await registerWowGuild(database, guildId, { gameEdition: "retail", name: " edition fixture ", realm: "testrealm" })).id, retail.id);
  await assert.rejects(resolveWowGuild(database, guildId), /Choose the in-game guild/);
  assert.equal((await resolveWowGuild(database, guildId, retail.id)).gameEdition, "retail");
  await assert.rejects(resolveWowGuild(database, "another-server", retail.id), /not configured in this Discord/);
  const member = await database.member.create({ data: { guildId, discordUserId: "edition-fixture", displayName: "Edition fixture" } });
  const base = { memberId: member.id, name: "EditionFixture", realm: "TestRealm", className: "Warrior" };
  const legacy = await database.character.create({ data: base });
  const modern = await database.character.create({ data: { ...base, gameEdition: "retail" } });
  assert.equal(legacy.gameEdition, "forever");
  assert.notEqual(legacy.id, modern.id);
  await assert.rejects(database.character.create({ data: { ...base, gameEdition: "retail" } }), (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === "P2002"));
}

export async function verifyGameEditionsRestored(database: PrismaClient) {
  const guild = await database.guild.findUniqueOrThrow({ where: { discordId: "release-test-guild" } });
  assert.equal(await database.wowGuild.count({ where: { guildId: guild.id } }), 3);
  assert.deepEqual((await database.character.findMany({ where: { name: "EditionFixture", realm: "TestRealm" }, orderBy: { gameEdition: "asc" } })).map(row => row.gameEdition), ["forever", "retail"]);
}
