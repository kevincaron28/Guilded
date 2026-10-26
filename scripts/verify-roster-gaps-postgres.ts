import assert from "node:assert/strict";
import type { PrismaClient } from "../src/generated/prisma/client.js";
import { loadRosterSnapshot } from "../src/services/roster-dashboard-store.js";
import { mainPlanRevision } from "../src/services/roster-review.js";
import { prismaRosterPlanWriter } from "../src/services/roster-plan-store.js";
import { prismaAvailabilityStore } from "../src/services/web-availability-store.js";
import { saveOfficialEvent, reminderDue } from "../src/services/game-events.js";

export async function verifyRosterGapsPostgres(database: PrismaClient) {
  const record = await database.guild.create({ data: { discordId: "release-test-roster-gaps", name: "Roster gap fixture", gameEdition: "classic-era" } });
  const guild = { id: record.id, name: record.name, edition: record.gameEdition };
  const member = await database.member.create({ data: { guildId: guild.id, discordUserId: "roster-owner", displayName: "Owner" } });
  const other = await database.member.create({ data: { guildId: guild.id, discordUserId: "roster-other", displayName: "Other" } });
  const first = await database.character.create({ data: { guildId: guild.id, gameEdition: guild.edition, memberId: member.id, name: "First", realm: "Realm", className: "Mage", isMain: true } });
  const second = await database.character.create({ data: { guildId: guild.id, gameEdition: guild.edition, memberId: member.id, name: "Second", realm: "Realm", className: "Mage" } });
  const peer = await database.character.create({ data: { guildId: guild.id, gameEdition: guild.edition, memberId: other.id, name: "Peer", realm: "Realm", className: "Priest", isMain: true } });
  const access = { authorize: async () => guild, guilds: async () => [guild] };
  const writer = prismaRosterPlanWriter(database, access);
  const revision = mainPlanRevision(await loadRosterSnapshot(database, guild));
  const plan = "character,realm,main\nFirst,Realm,false\nSecond,Realm,true";
  const competing = await Promise.allSettled([writer.apply("roster-owner", guild.id, plan, revision), writer.apply("roster-owner", guild.id, plan, revision)]);
  assert.equal(competing.filter(result => result.status === "fulfilled").length, 1);
  assert.equal(await database.auditLog.count({ where: { guildId: guild.id, action: "MEMBER_UPDATED" } }), 1);
  assert.equal((await database.character.findUniqueOrThrow({ where: { id: first.id } })).isMain, false);
  assert.equal((await database.character.findUniqueOrThrow({ where: { id: second.id } })).memberId, member.id);
  assert.equal(await database.epgpTransaction.count({ where: { guildId: guild.id } }), 0);
  const availability = prismaAvailabilityStore(database, access), now = new Date();
  await assert.rejects(availability.share("roster-owner", guild.id, peer.id, "ANY", 15, now));
  await availability.share("roster-owner", guild.id, first.id, "DPS", 15, now);
  await availability.share("roster-other", guild.id, peer.id, "HEALER", 30, now);
  assert.equal((await availability.load("roster-owner", guild.id, now))!.rows.length, 2);
  assert.equal((await availability.load("roster-owner", guild.id, new Date(now.getTime() + 16 * 60_000)))!.rows.length, 1);
  await availability.revoke("roster-owner", guild.id);
  assert.equal(await database.webAvailability.count({ where: { guildId: guild.id } }), 1);
  await database.character.update({ where: { id: peer.id }, data: { memberId: member.id } });
  assert.equal((await availability.load("roster-owner", guild.id, now))!.rows.length, 0);
  await database.member.delete({ where: { id: other.id } });
  assert.equal(await database.webAvailability.count({ where: { guildId: guild.id } }), 0);

  const input = { id: "release-test-retail-event", game: "WOW_RETAIL", region: "GLOBAL", titleEn: "Test", titleFr: "Test", sourceUrl: "https://worldofwarcraft.blizzard.com/en-us/news", dateLabelEn: "", dateLabelFr: "", state: "SCHEDULED", startsAt: now };
  const event = await saveOfficialEvent(database, input, "release-test", now);
  const board = await database.gameEventBoard.create({ data: { guildId: guild.id, channelId: "edition-reminders", games: ["WOW_RETAIL"], region: "NA", enabled: true,
    editionReminders: { WOW_RETAIL: { role: "123456789", offsets: [0], enabledAt: new Date(now.getTime() - 1000).toISOString() } } } });
  assert.equal(reminderDue(event, board, 0, now), true);
  assert.equal(reminderDue({ ...event, game: "WOW_CLASSIC_ERA" }, board, 0, now), false);
}

export async function verifyRosterGapsRestored(database: PrismaClient) {
  const guild = await database.guild.findFirstOrThrow({ where: { discordId: "release-test-roster-gaps" } });
  const characters = await database.character.findMany({ where: { guildId: guild.id }, orderBy: { name: "asc" } });
  assert.equal(characters.find(row => row.name === "First")!.isMain, false);
  assert.equal(characters.find(row => row.name === "Second")!.isMain, true);
  assert.equal(await database.auditLog.count({ where: { guildId: guild.id, action: "MEMBER_UPDATED" } }), 1);
  assert.equal(await database.webAvailability.count({ where: { guildId: guild.id } }), 0);
  const board = await database.gameEventBoard.findFirstOrThrow({ where: { guildId: guild.id, channelId: "edition-reminders" } });
  assert.equal((board.editionReminders as { WOW_RETAIL: { role: string } }).WOW_RETAIL.role, "123456789");
}
