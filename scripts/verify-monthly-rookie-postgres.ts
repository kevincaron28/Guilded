import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import { advanceCommunityHonors } from "../src/services/community-honors.js";

// Called only by the disposable-local-database release harness.
export async function verifyMonthlyRookiePostgres(database: PrismaClient) {
  const guild = await database.guild.create({ data: { discordId: "release-test-rookie", name: "Rookie fixture", settings: { create: { timezone: "America/Toronto" } } } });
  await database.communityHonors.create({ data: { guildId: guild.id, channelId: "fame", week: "2026-10-26", rookieRoleId: "rookie-role", rookieHolderId: "old" } });
  const season = await database.communitySeason.create({ data: {
    guildId: guild.id, game: "DISCORD", name: "Rookie October", number: 1, channelId: "community", createdBy: "release-test", status: "ENDED",
    createdAt: new Date("2026-10-01T04:00:00Z"), endedAt: new Date("2026-11-01T04:00:00Z"), finalStandings: [{ userId: "rookie-a", points: 30, balance: 30 }]
  } });
  await database.communityPoint.createMany({ data: [5, 6, 7].map(day => ({ seasonId: season.id, userId: "rookie-a", kind: "AWARD", amount: 10, reference: `rookie-day-${day}`, reason: "participation", actorId: "release-test", createdAt: new Date(`2026-10-0${day}T12:00:00Z`) })) });
  const lookup = async () => new Map([["rookie-a", "Alice"]]);
  const join = async () => new Date("2026-10-03T12:00:00Z");
  const run = () => advanceCommunityHonors(database, guild.id, new Date("2026-11-02T12:00:00Z"), lookup, join);
  await Promise.all([run(), run()]);
  assert.equal(await database.communityHonorAward.count({ where: { guildId: guild.id, kind: "MONTH_ROOKIE" } }), 1);
  assert.equal(await database.discordJob.count({ where: { guildId: guild.id, key: `community-month:${season.id}` } }), 1);
  assert.equal((await database.communityHonors.findUniqueOrThrow({ where: { guildId: guild.id } })).rookieHolderId, "rookie-a");
  const member = await database.member.create({ data: { guildId: guild.id, discordUserId: "rookie-a", displayName: "Alice" } });
  await database.member.delete({ where: { id: member.id } });
  assert.equal(await database.communityRookieMembership.count({ where: { guildId: guild.id, userId: "rookie-a" } }), 1);
  await database.communitySeason.create({ data: {
    guildId: guild.id, game: "DISCORD", name: "Rookie November", number: 2, channelId: "community", createdBy: "release-test", status: "ENDED",
    createdAt: new Date("2026-11-01T04:00:00Z"), endedAt: new Date("2026-12-01T05:00:00Z"), finalStandings: [{ userId: "rookie-a", points: 30, balance: 30 }]
  } });
  await advanceCommunityHonors(database, guild.id, new Date("2026-12-01T12:00:00Z"), lookup, join);
  assert.equal((await database.communityHonors.findUniqueOrThrow({ where: { guildId: guild.id } })).rookieHolderId, null);
  assert.equal(await database.communityHonorAward.count({ where: { guildId: guild.id, kind: "MONTH_ROOKIE" } }), 1);
}
