import assert from "node:assert/strict";
import type { PrismaClient } from "../src/generated/prisma/client.js";
import { configureCommunityBadges, recordCommunityPoint, communityBadgeShelf, initializeCommunityBadgeHistory } from "../src/services/community-badges.js";
import { attemptBadgeDelivery } from "../src/services/community-badge-delivery.js";

// Called only by the guarded disposable-local PostgreSQL release harness.
export async function verifyCommunityBadgesPostgres(database: PrismaClient) {
  const guild = await database.guild.create({ data: { discordId: "badge-release-fixture", name: "Badge release fixture" } });
  const season = await database.communitySeason.create({ data: { guildId: guild.id, game: "DISCORD", name: "Badge fixture", channelId: "channel", createdBy: "officer" } });
  const point = (userId: string, amount: number, kind: string, reference: string) => ({ seasonId: season.id, userId, amount, kind, reference, reason: "fixture", actorId: "officer" });
  await database.communityPoint.create({ data: point("baseline", 350, "AWARD", "baseline") });
  await configureCommunityBadges(database, guild.id, season.id, "channel", true, "officer");
  assert.equal(await database.communityBadge.count({ where: { seasonId: season.id, delivery: "PENDING" } }), 0);
  const baseline = await database.communityBadge.findMany({ where: { seasonId: season.id, userId: "baseline" } });
  assert.deepEqual(baseline.map(row => row.code).sort(), ["community-100", "community-300", "legacy-150", "legacy-300", "legacy-50"]);
  assert.ok(baseline.every(row => row.earnedAt === null && row.delivery === "SILENT"));
  const write = (data: ReturnType<typeof point>) => database.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`community:${guild.id}`}, 0))`;
    return recordCommunityPoint(tx, data);
  });
  await Promise.all([1, 2, 3].map(n => write(point("concurrent", 100, "AWARD", `concurrent-${n}`))));
  assert.equal(await database.communityBadge.count({ where: { seasonId: season.id, userId: "concurrent" } }), 2);
  await write(point("jump", 550, "AWARD", "jump"));
  const jump = await database.communityBadge.findMany({ where: { seasonId: season.id, userId: "jump" } });
  assert.equal(jump.length, 3);
  assert.deepEqual(jump.filter(row => row.delivery === "PENDING").map(row => row.code), ["community-500"]);
  await write(point("jump", -550, "REVERSAL", "reverse"));
  await write(point("jump", 600, "AWARD", "recross"));
  await write(point("spender", 1000, "REFUND", "refund"));
  assert.equal(await database.communityBadge.count({ where: { seasonId: season.id, userId: "jump" } }), 3);
  assert.equal(await database.communityBadge.count({ where: { seasonId: season.id, userId: "spender" } }), 0);
  await assert.rejects(database.$transaction(async tx => {
    await recordCommunityPoint(tx, point("rollback", 500, "AWARD", "rollback"));
    throw new Error("fixture rollback");
  }));
  assert.equal(await database.communityBadge.count({ where: { seasonId: season.id, userId: "rollback" } }), 0);
  assert.equal(await database.communityPoint.count({ where: { seasonId: season.id, userId: "rollback" } }), 0);
  // An old archived season keeps legacy recognition without creating posts/dates.
  const archived = await database.communitySeason.create({ data: { guildId: guild.id, game: "DISCORD", number: 2, name: "Archived badge fixture", channelId: "private-channel", audienceRoleId: "private-role", status: "ENDED", createdBy: "officer" } });
  await database.communityPoint.create({ data: { ...point("archived", 150, "AWARD", "archived"), seasonId: archived.id } });
  await initializeCommunityBadgeHistory(database, guild.id, archived.id);
  const archivedBadges = await database.communityBadge.findMany({ where: { seasonId: archived.id } });
  assert.equal(archivedBadges.length, 3);
  assert.ok(archivedBadges.every(row => row.earnedAt === null && row.delivery === "SILENT"));
  assert.equal((await database.communityBadgeConfig.findUniqueOrThrow({ where: { seasonId: archived.id } })).enabled, false);
  let sends = 0;
  const highest = jump.find(row => row.code === "community-500")!;
  const send = async () => { sends++; return "real-message-id-fixture"; };
  await configureCommunityBadges(database, guild.id, season.id, "channel", true, "officer");
  assert.equal((await database.communityBadge.findUniqueOrThrow({ where: { id: highest.id } })).delivery, "PENDING");
  assert.equal(await attemptBadgeDelivery(database, highest.id, guild.id, send, new Date(), "changed-channel"), false);
  await Promise.all([1, 2, 3].map(() => attemptBadgeDelivery(database, highest.id, guild.id, send)));
  await attemptBadgeDelivery(database, highest.id, guild.id, send); // restart/deleted post cannot resend
  assert.equal(sends, 1);
  const other = await database.communityBadge.findFirstOrThrow({ where: { seasonId: season.id, userId: "concurrent", delivery: "PENDING" } });
  await attemptBadgeDelivery(database, other.id, guild.id, async () => { sends++; throw new Error("Discord may have accepted"); });
  await attemptBadgeDelivery(database, other.id, guild.id, send);
  assert.equal(sends, 2);
  assert.equal((await database.communityBadge.findUniqueOrThrow({ where: { id: other.id } })).delivery, "UNCERTAIN");
  assert.equal(await communityBadgeShelf(database, season.id, "viewer", "jump"), null);
  await database.communityBadgeSharing.create({ data: { seasonId: season.id, userId: "jump", shared: true } });
  assert.equal((await communityBadgeShelf(database, season.id, "viewer", "jump"))?.length, 3);
  await configureCommunityBadges(database, guild.id, season.id, "channel", false, "officer");
  await write(point("paused", 500, "AWARD", "paused"));
  await configureCommunityBadges(database, guild.id, season.id, "channel", true, "officer");
  assert.equal(await database.communityBadge.count({ where: { seasonId: season.id, delivery: "PENDING" } }), 0);
  assert.equal(await database.communityBadge.count({ where: { seasonId: season.id, delivery: "SENT" } }), 1);
  console.log("Community badges: baseline, concurrent crossings, rollback, outbox ambiguity, recross, privacy and re-enable passed.");
}

export async function verifyCommunityBadgesRestored(database: PrismaClient) {
  const season = await database.communitySeason.findFirstOrThrow({ where: { guild: { discordId: "badge-release-fixture" } } });
  assert.equal(await database.communityBadge.count({ where: { seasonId: season.id, delivery: "SENT" } }), 1);
  assert.equal(await database.communityBadge.count({ where: { seasonId: season.id, delivery: "UNCERTAIN" } }), 1);
  assert.equal(await database.communityBadge.count({ where: { seasonId: season.id, delivery: "PENDING" } }), 0);
}
