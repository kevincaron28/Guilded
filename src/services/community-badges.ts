import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { historicalPeak, milestoneCode, reachedMilestones } from "./community-badge-rules.js";

type Tx = Prisma.TransactionClient;
const lock = (tx: Tx, guildId: string) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`community:${guildId}`}, 0))`;

// Call only inside the existing community transaction/lock. The ledger write,
// recognition and outbox row commit or roll back together.
export async function recordCommunityPoint(tx: Tx, data: Prisma.CommunityPointUncheckedCreateInput) {
  const point = await tx.communityPoint.create({ data });
  if (point.kind !== "AWARD" || point.amount <= 0) return point;
  const cfg = await tx.communityBadgeConfig.findUnique({ where: { seasonId: point.seasonId }, include: { season: true } });
  if (!cfg || cfg.season.status !== "ACTIVE") return point;
  const score = (await tx.communityPoint.aggregate({ where: { seasonId: point.seasonId, userId: point.userId, kind: { in: ["AWARD", "REVERSAL"] } }, _sum: { amount: true } }))._sum.amount ?? 0;
  const old = await tx.communityBadge.findMany({ where: { seasonId: point.seasonId, userId: point.userId }, select: { code: true } });
  const missing = reachedMilestones(score).filter(threshold => !old.some(row => row.code === milestoneCode(threshold)));
  const now = new Date();
  for (const threshold of missing) await tx.communityBadge.create({ data: {
    seasonId: point.seasonId, userId: point.userId, code: milestoneCode(threshold), earnedAt: now, evidenceRef: point.id, source: "LEDGER",
    delivery: cfg.enabled && threshold === missing.at(-1) ? "PENDING" : "SILENT"
  } });
  return point;
}

export async function grantCommunityBadge(tx: Tx, seasonId: string, userId: string, code: "helper" | "attendee" | "organizer", evidenceRef: string, now = new Date()) {
  if (!await tx.communityBadgeConfig.findUnique({ where: { seasonId } })) return;
  // No reward, role or announcement. Independent review/attendance is the evidence;
  // the shelf remains private until its owner chooses to share this season.
  await tx.communityBadge.upsert({ where: { seasonId_userId_code: { seasonId, userId, code } },
    create: { seasonId, userId, code, earnedAt: now, source: "REVIEW", evidenceRef }, update: {} });
}


async function baselineBadgeSeason(tx: Tx, seasonId: string, now: Date) {
  // Historical recognition has no invented earning date. Never queue backfill.
  const points = await tx.communityPoint.findMany({ where: { seasonId, kind: { in: ["AWARD", "REVERSAL"] } }, orderBy: { createdAt: "asc" } });
  const members = new Map<string, typeof points>();
  for (const point of points) { const rows = members.get(point.userId) ?? []; rows.push(point); members.set(point.userId, rows); }
  for (const [userId, rows] of members) {
    const peak = historicalPeak(rows);
    for (const code of [...reachedMilestones(peak).map(milestoneCode), ...[50, 150, 300].filter(value => value <= peak).map(value => `legacy-${value}`)]) {
      await tx.communityBadge.upsert({ where: { seasonId_userId_code: { seasonId, userId, code } }, create: { seasonId, userId, code, source: "BASELINE", recordedAt: now }, update: {} });
    }
  }
}

// Lazily materialize old season recognition after the caller's live access check.
// No messages, earning dates, public profile changes or enablement are inferred.
export async function initializeCommunityBadgeHistory(database: PrismaClient, guildId: string, seasonId: string, now = new Date()) {
  await database.$transaction(async tx => {
    await lock(tx, guildId);
    const season = await tx.communitySeason.findFirst({ where: { id: seasonId, guildId, game: "DISCORD" } });
    if (!season || await tx.communityBadgeConfig.findUnique({ where: { seasonId } })) return;
    await baselineBadgeSeason(tx, seasonId, now);
    await tx.communityBadgeConfig.create({ data: { seasonId, channelId: season.channelId, baselineAt: now } });
  }, { timeout: 20_000 });
}

// Caller verifies officer authority and destination audience BEFORE this transaction.
// Every (re-)enable baselines silently under the same lock used by point awards.
export async function configureCommunityBadges(database: PrismaClient, guildId: string, seasonId: string, channelId: string, enabled: boolean, actorId: string, now = new Date()) {
  return database.$transaction(async tx => {
    await lock(tx, guildId);
    const season = await tx.communitySeason.findFirst({ where: { id: seasonId, guildId, game: "DISCORD", status: "ACTIVE" } });
    if (!season) throw new Error("Active Discord season required / Saison Discord active requise.");
    const prior = await tx.communityBadgeConfig.findUnique({ where: { seasonId } });
    if (prior?.enabled === enabled && prior.channelId === channelId) return prior;
    if (!prior) {
      await baselineBadgeSeason(tx, seasonId, now);
    }
    // Old pending announcements are not replayed when settings change.
    await tx.communityBadge.updateMany({ where: { seasonId, delivery: "PENDING" }, data: { delivery: "SILENT" } });
    const config = await tx.communityBadgeConfig.upsert({ where: { seasonId }, create: { seasonId, channelId, enabled, baselineAt: now }, update: { channelId, enabled } });
    await tx.auditLog.create({ data: { guildId, actorId, action: "CONFIG_UPDATED", entityId: seasonId, metadata: { area: "community-badges", enabled, channelId, baseline: !prior } } });
    return config;
  }, { timeout: 20_000 });
}

export async function communityBadgeShelf(database: PrismaClient, seasonId: string, viewer: string, owner: string) {
  const sharing = await database.communityBadgeSharing.findUnique({ where: { seasonId_userId: { seasonId, userId: owner } } });
  if (viewer !== owner && !sharing?.shared) return null;
  return database.communityBadge.findMany({ where: { seasonId, userId: owner }, orderBy: [{ recordedAt: "asc" }, { code: "asc" }], take: 30 });
}
