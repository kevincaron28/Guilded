import { escapeMarkdown, PermissionFlagsBits, type Guild } from "discord.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { assertCommunityChannelAudience, communityAccess } from "./community-access.js";
import { COMMUNITY_MILESTONES } from "./community-badge-rules.js";
import { asLang, type Lang } from "../i18n.js";

export function milestoneMessage(name: string, threshold: number, lang: Lang) {
  const safe = escapeMarkdown(name.replace(/[\r\n<>@]/g, " ").slice(0, 80));
  return { content: lang === "fr"
    ? `🏅 Bravo **${safe}** ! Tu as atteint **${threshold} points communautaires** cette saison. Ton badge est conservé dans /community badges. Merci de faire vivre la communauté !`
    : `🏅 Congratulations **${safe}**! You reached **${threshold} community points** this season. Your badge is saved in /community badges. Thank you for being part of the community!`,
    allowedMentions: { parse: [] as [], users: [] as string[], roles: [] as string[] } };
}

// Deliberately at-most-once: Discord cannot guarantee deduplication indefinitely.
// Persist the attempt BEFORE sending. Ambiguous responses/crashes require manual
// investigation, never automatic retry, history scanning or deleted-post replay.
export async function attemptBadgeDelivery(database: PrismaClient, id: string, guildId: string, send: () => Promise<string>, now = new Date(), expectedChannelId?: string) {
  const claimed = await database.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`community:${guildId}`}, 0))`;
    const badge = await tx.communityBadge.findFirst({ where: { id, delivery: "PENDING", season: { guildId, status: "ACTIVE", badgeConfig: { enabled: true, ...(expectedChannelId ? { channelId: expectedChannelId } : {}) } } } });
    if (!badge) return false;
    return (await tx.communityBadge.updateMany({ where: { id, delivery: "PENDING" }, data: { delivery: "ATTEMPTED", attemptedAt: now } })).count === 1;
  });
  if (!claimed) return false;
  try {
    const messageId = await send();
    await database.communityBadge.updateMany({ where: { id, delivery: "ATTEMPTED" }, data: { delivery: "SENT", messageId } });
  } catch {
    await database.communityBadge.updateMany({ where: { id, delivery: "ATTEMPTED" }, data: { delivery: "UNCERTAIN" } });
  }
  return true;
}

export async function deliverCommunityBadges(guild: Guild, database: PrismaClient, guildId: string) {
  const rows = await database.communityBadge.findMany({ where: { delivery: "PENDING", season: { guildId } }, include: { season: { include: { badgeConfig: true } } }, orderBy: { recordedAt: "asc" }, take: 5 });
  const lang = asLang((await database.guildSettings.findUnique({ where: { guildId }, select: { language: true } }))?.language);
  for (const row of rows) {
    const cfg = row.season.badgeConfig;
    if (!cfg?.enabled || row.season.status !== "ACTIVE") {
      await database.communityBadge.updateMany({ where: { id: row.id, delivery: "PENDING" }, data: { delivery: "CANCELLED" } }); continue;
    }
    // Resolve live membership, season audience and destination on every attempt.
    await assertCommunityChannelAudience(guild, row.season.channelId, cfg.channelId);
    const member = await communityAccess(guild, row.userId, row.season, false, cfg.channelId);
    const channel = await guild.channels.fetch(cfg.channelId, { force: true });
    if (!channel?.isTextBased() || !guild.members.me || !channel.permissionsFor(guild.members.me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages])) throw new Error("Badge destination unavailable");
    const threshold = Number(row.code.slice("community-".length));
    if (!(COMMUNITY_MILESTONES as readonly number[]).includes(threshold)) throw new Error("Invalid milestone");
    const score = (await database.communityPoint.aggregate({ where: { seasonId: row.seasonId, userId: row.userId, kind: { in: ["AWARD", "REVERSAL"] } }, _sum: { amount: true } }))._sum.amount ?? 0;
    if (score < threshold) {
      await database.communityBadge.updateMany({ where: { id: row.id, delivery: "PENDING" }, data: { delivery: "CANCELLED" } }); continue;
    }
    await attemptBadgeDelivery(database, row.id, guildId, async () => (await channel.send({ ...milestoneMessage(member.displayName, threshold, lang), nonce: row.id.slice(-25), enforceNonce: true })).id, new Date(), cfg.channelId);
  }
}
