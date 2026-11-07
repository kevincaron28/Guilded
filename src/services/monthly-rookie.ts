import type { Guild } from "discord.js";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import type { Standing } from "./community-rules.js";
import { participationDay } from "./participation-rules.js";

export const ROOKIE_DAYS = 60;
export const ROOKIE_MIN_DAYS = 3;
export const ROOKIE_ROLE = { en: "🐣 Rookie of the month", fr: "🐣 Recrue du mois" };
export const WEEKLY_ROOKIE_ROLE = { en: "🌱 Rookie of the week", fr: "🌱 Recrue de la semaine" };
/** A weekly rookie joined the server within this many days of the end of the week. */
export const WEEKLY_ROOKIE_DAYS = 30;
export type RookieMemberLookup = (userId: string) => Promise<Date | null>;
export type MonthlyRookie = Standing & { activeDays: number; messages: number; reactions: number; voiceHours: number };

// Only confirmed absence is ignored. Transient Discord failures retry the award next pass.
export const rookieMemberLookup = (guild: Guild): RookieMemberLookup => async userId => {
  try {
    const member = await guild.members.fetch({ user: userId, force: true });
    return member.user.bot ? null : member.joinedAt;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === 10007) return null;
    throw error;
  }
};

export async function rememberRookieJoin(db: Pick<PrismaClient, "communityRookieMembership">, guildId: string, userId: string, joinedAt: Date) {
  await db.communityRookieMembership.upsert({ where: { guildId_userId: { guildId, userId } }, create: { guildId, userId, joinedAt }, update: {} });
  // Keep the earliest observed join, including when a member leaves and rejoins.
  await db.communityRookieMembership.updateMany({ where: { guildId, userId, joinedAt: { gt: joinedAt } }, data: { joinedAt } });
}

export async function monthlyRookie(db: Prisma.TransactionClient, guildId: string, season: { id: string; createdAt: Date; endedAt: Date | null }, board: Standing[], timezone: string, lookup: RookieMemberLookup): Promise<MonthlyRookie | null> {
  if (!season.endedAt) return null;
  const end = season.endedAt;
  const past = await db.communityHonorAward.findMany({ where: { guildId, kind: "MONTH_ROOKIE" }, select: { userId: true } });
  const won = new Set(past.map(row => row.userId));
  const candidates = board.filter(row => row.points > 0 && !won.has(row.userId));
  if (!candidates.length) return null;
  const userIds = candidates.map(row => row.userId);
  const [activity, points, testMembers] = await Promise.all([
    db.communityParticipationDay.findMany({ where: { seasonId: season.id, userId: { in: userIds } } }),
    db.communityPoint.findMany({ where: { seasonId: season.id, userId: { in: userIds }, createdAt: { gte: season.createdAt, lt: end } }, select: { userId: true, createdAt: true, amount: true, kind: true } }),
    db.member.findMany({ where: { guildId, isTest: true, discordUserId: { in: userIds } }, select: { discordUserId: true } })
  ]);
  const tests = new Set(testMembers.map(row => row.discordUserId));
  const eligible: (MonthlyRookie & { joinedAt: Date })[] = [];
  for (const candidate of candidates) {
    if (tests.has(candidate.userId)) continue;
    const days = new Set(activity.filter(row => row.userId === candidate.userId && (row.messages > 0 || row.reactions > 0 || row.voiceMs > 0)).map(row => row.day));
    for (const row of points) if (row.userId === candidate.userId && row.kind === "AWARD" && row.amount > 0) days.add(participationDay(row.createdAt, timezone));
    if (days.size < ROOKIE_MIN_DAYS) continue;
    const joined = await lookup(candidate.userId);
    if (!joined) continue;
    await rememberRookieJoin(db, guildId, candidate.userId, joined);
    const membership = await db.communityRookieMembership.findUniqueOrThrow({ where: { guildId_userId: { guildId, userId: candidate.userId } } });
    if (membership.joinedAt >= end || membership.joinedAt.getTime() < end.getTime() - ROOKIE_DAYS * 86_400_000) continue;
    const own = activity.filter(row => row.userId === candidate.userId);
    eligible.push({ ...candidate, activeDays: days.size, joinedAt: membership.joinedAt,
      messages: own.reduce((sum, row) => sum + row.messages, 0), reactions: own.reduce((sum, row) => sum + row.reactions, 0),
      voiceHours: Math.round(own.reduce((sum, row) => sum + row.voiceMs, 0) / 3_600_000) });
  }
  eligible.sort((a, b) => b.points - a.points || b.activeDays - a.activeDays || a.joinedAt.getTime() - b.joinedAt.getTime() || a.userId.localeCompare(b.userId));
  return eligible[0] ?? null;
}

/**
 * The best new member of a finished week: most points among members with points that week who joined in the last
 * WEEKLY_ROOKIE_DAYS days and have not been weekly rookie before. Ties go to the earlier join, then the id. Null when nobody qualifies.
 */
export async function weeklyRookie(db: Prisma.TransactionClient, guildId: string, windowEnd: Date, board: Standing[], lookup: RookieMemberLookup): Promise<Standing | null> {
  const won = new Set((await db.communityHonorAward.findMany({ where: { guildId, kind: "ROOKIE" }, select: { userId: true } })).map(row => row.userId));
  const candidates = board.filter(row => row.points > 0 && !won.has(row.userId)).slice(0, 50);
  if (!candidates.length) return null;
  const tests = new Set((await db.member.findMany({ where: { guildId, isTest: true, discordUserId: { in: candidates.map(row => row.userId) } }, select: { discordUserId: true } })).map(row => row.discordUserId));
  const eligible: (Standing & { joinedAt: Date })[] = [];
  for (const candidate of candidates) {
    if (tests.has(candidate.userId)) continue;
    const joined = await lookup(candidate.userId);
    if (!joined) continue;
    await rememberRookieJoin(db, guildId, candidate.userId, joined);
    const membership = await db.communityRookieMembership.findUniqueOrThrow({ where: { guildId_userId: { guildId, userId: candidate.userId } } });
    if (membership.joinedAt >= windowEnd || membership.joinedAt.getTime() < windowEnd.getTime() - WEEKLY_ROOKIE_DAYS * 86_400_000) continue;
    eligible.push({ ...candidate, joinedAt: membership.joinedAt });
  }
  eligible.sort((a, b) => b.points - a.points || a.joinedAt.getTime() - b.joinedAt.getTime() || a.userId.localeCompare(b.userId));
  const best = eligible[0];
  return best ? { userId: best.userId, points: best.points } as Standing : null;
}
