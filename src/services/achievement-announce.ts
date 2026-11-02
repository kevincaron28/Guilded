import type { PrismaClient } from "../generated/prisma/client.js";
import { achievementById, TIER_LABEL } from "./achievements-catalogue.js";
import { syncMemberAchievements } from "./achievements.js";
import { achievementUnlockedCard } from "./end-cards.js";
import { enqueueDiscordJob } from "./discord-jobs.js";

// Opt-in celebration posts. An officer turns them on per guild (/config achievements); until then nothing is
// ever posted. Newly stored achievements wait with announcedAt = null; one pass claims a member's waiting rows
// in a transaction (so a restart or a second pass cannot post them twice), queues ONE message through the
// Discord job queue (retried and rate-limited there), and marks them announced. A member who hid their web
// profile is never announced: their rows are marked announced silently. Evaluation never depends on posting.

type Db = Pick<PrismaClient, "guildSettings" | "member" | "memberAchievement" | "webAccount" | "discordJob" | "$transaction">;
const MAX_LISTED = 6;

/** Marks everything not yet announced as announced, without posting. Used when announcing is switched on. */
export async function markAnnouncedSilently(db: Pick<PrismaClient, "memberAchievement">, guildId: string, now = new Date()): Promise<number> {
  return (await db.memberAchievement.updateMany({ where: { guildId, announcedAt: null }, data: { announcedAt: now } })).count;
}

/** Queues one celebration message for a member's waiting achievements. Returns how many were announced. */
export async function announceNewAchievements(db: Db, guildId: string, memberId: string, now = new Date()): Promise<number> {
  const settings = await db.guildSettings.findUnique({ where: { guildId }, select: { achievementAnnounceEnabled: true, achievementChannelId: true, achievementsEnabled: true, language: true } });
  if (!settings?.achievementAnnounceEnabled || !settings.achievementChannelId || !settings.achievementsEnabled) return 0;
  const member = await db.member.findFirst({ where: { id: memberId, guildId, status: "ACTIVE", isTest: false }, select: { discordUserId: true, displayName: true } });
  if (!member) return 0;
  const waiting = await db.memberAchievement.findMany({ where: { guildId, memberId, announcedAt: null }, select: { id: true, key: true, earnedAt: true }, orderBy: { earnedAt: "asc" }, take: 200 });
  if (!waiting.length) return 0;
  const ids = waiting.map(row => row.id);
  const account = await db.webAccount.findFirst({ where: { discordUserId: member.discordUserId }, select: { publicProfile: true } });
  if (account && !account.publicProfile) { await db.memberAchievement.updateMany({ where: { id: { in: ids }, announcedAt: null }, data: { announcedAt: now } }); return 0; }

  const lang = settings.language === "fr" ? "fr" : "en";
  const defs = waiting.flatMap(row => { const def = achievementById(row.key); return def ? [def] : []; });
  const total = await db.memberAchievement.count({ where: { guildId, memberId } });
  const listed = defs.slice(-MAX_LISTED).reverse();
  const lines = listed.map(def => `**${def[lang].name}** (${TIER_LABEL[def.tier][lang]}): ${def[lang].description}`);
  if (defs.length > listed.length) lines.push(lang === "fr" ? `…et ${defs.length - listed.length} autre(s)` : `…and ${defs.length - listed.length} more`);
  const title = defs.length === 1
    ? (lang === "fr" ? `🏅 Succès débloqué : ${defs[0]![lang].name}` : `🏅 Achievement unlocked: ${defs[0]![lang].name}`)
    : (lang === "fr" ? `🏅 ${defs.length} succès débloqués` : `🏅 ${defs.length} achievements unlocked`);
  const content = lang === "fr" ? `🎉 Bravo <@${member.discordUserId}> !` : `🎉 Congratulations <@${member.discordUserId}>!`;
  const card = achievementUnlockedCard(member.displayName, defs.map(def => def.id), total, lang);

  return db.$transaction(async tx => {
    const claim = await tx.memberAchievement.updateMany({ where: { id: { in: ids }, announcedAt: null }, data: { announcedAt: now } });
    if (claim.count !== ids.length) throw new Error("achievements already announced"); // another pass got there first: roll back
    await enqueueDiscordJob(tx, guildId, `achievement-unlock:${memberId}:${now.getTime()}`, "MESSAGE", {
      route: "achievements", channelId: settings.achievementChannelId!, mentionUsers: [member.discordUserId],
      message: { content, embeds: [{ title: title.slice(0, 250), description: lines.join("\n").slice(0, 3800), footer: { text: lang === "fr" ? "Calculé à partir des données enregistrées · aucun point" : "Computed from recorded data · no points" } }] },
      card: JSON.parse(JSON.stringify(card))
    });
    return ids.length;
  }).catch(error => { if (error instanceof Error && error.message === "achievements already announced") return 0; throw error; });
}

/**
 * Hourly pass: evaluates every active member of guilds that announce (evaluation is otherwise on view only),
 * then queues the celebrations. One member or guild failing never stops the rest.
 */
export async function sweepAchievementAnnouncements(db: Db & Pick<PrismaClient, "character" | "professionSkill" | "dungeonRunPlayer" | "raidAttendance" | "communityParticipationDay" | "poeLevelReached" | "poeMapVisit">, now = new Date(), onError: (error: unknown) => void = () => undefined): Promise<number> {
  let posted = 0;
  const guilds = await db.guildSettings.findMany({ where: { achievementAnnounceEnabled: true, achievementsEnabled: true, achievementChannelId: { not: null } }, select: { guildId: true }, take: 100 });
  for (const { guildId } of guilds) {
    try {
      for (const member of await db.member.findMany({ where: { guildId, status: "ACTIVE", isTest: false }, select: { id: true }, take: 2000 })) {
        try { await syncMemberAchievements(db, guildId, member.id, now); posted += await announceNewAchievements(db, guildId, member.id, now); } catch (error) { onError(error); }
      }
    } catch (error) { onError(error); }
  }
  return posted;
}

/** Evaluates every active member without posting: the baseline taken when announcing is switched on. */
export async function baselineAchievements(db: Parameters<typeof sweepAchievementAnnouncements>[0], guildId: string, now = new Date()): Promise<number> {
  for (const member of await db.member.findMany({ where: { guildId, status: "ACTIVE", isTest: false }, select: { id: true }, take: 2000 })) {
    try { await syncMemberAchievements(db, guildId, member.id, now); } catch { /* the next view or pass records it */ }
  }
  return markAnnouncedSilently(db, guildId, now);
}
