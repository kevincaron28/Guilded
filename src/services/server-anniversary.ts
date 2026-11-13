import { textlessEmbed } from "./card-only.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { serverAnniversaryCard } from "./end-cards.js";
import { enqueueDiscordJob } from "./discord-jobs.js";
import { RETIRED_ACHIEVEMENT_IDS } from "./achievements-catalogue.js";

// Server anniversaries. The server's birthday is its Discord creation date, which is encoded in the server id
// (a snowflake), so nothing is configured or stored. Two things use it: the member achievements ("Anniversary
// Guest" and up, see achievements-catalogue.ts) and the celebration post with a card below. The post goes to the
// achievements channel, so it is opt-in the same way (/config achievements): until an officer turns announcements
// on, nothing is ever posted.

const DISCORD_EPOCH = 1420070400000n;
const DAY = 86_400_000;
/** How long after the day a missed celebration (bot offline on the day) is still posted. */
const GRACE_DAYS = 3;

type Db = Pick<PrismaClient, "guild" | "guildSettings" | "member" | "memberAchievement" | "discordJob">;

/** When the Discord server was created, from its id. Null for an id that is not a snowflake. */
export function serverCreatedAt(discordId: string): Date | null {
  if (!/^\d{17,20}$/.test(discordId)) return null;
  const ms = Number((BigInt(discordId) >> 22n) + DISCORD_EPOCH);
  return Number.isFinite(ms) ? new Date(ms) : null;
}

/** The n-th anniversary of `founded` (same month and day, UTC; 29 February rolls to 1 March in other years). */
export const anniversaryDate = (founded: Date, year: number): Date => new Date(Date.UTC(founded.getUTCFullYear() + year, founded.getUTCMonth(), founded.getUTCDate()));

/** Anniversary dates (1st, 2nd, ...) that have already passed by `now`. */
export function anniversariesElapsed(founded: Date, now: Date): Date[] {
  const dates: Date[] = [];
  for (let year = 1; year <= 200; year++) {
    const date = anniversaryDate(founded, year);
    if (date.getTime() > now.getTime()) break;
    dates.push(date);
  }
  return dates;
}

/** The anniversaries a member was on the server for: those on or after the day Guilded first recorded them. */
export function anniversariesAttended(founded: Date, memberSince: Date, now: Date): Date[] {
  const start = Date.UTC(memberSince.getUTCFullYear(), memberSince.getUTCMonth(), memberSince.getUTCDate());
  return anniversariesElapsed(founded, now).filter(date => date.getTime() >= start);
}

/** The anniversary to celebrate right now: its day is today or within the grace days. Null otherwise. */
export function anniversaryDue(founded: Date, now: Date): { year: number; date: Date } | null {
  const elapsed = anniversariesElapsed(founded, now);
  const year = elapsed.length;
  if (!year) return null;
  const date = elapsed[year - 1]!;
  return now.getTime() - date.getTime() < (GRACE_DAYS + 1) * DAY ? { year, date } : null;
}

/** Queues at most one celebration per guild per anniversary (checked first: re-queueing the same key would repost). */
export async function celebrateServerAnniversary(db: Db, guildId: string, now = new Date()): Promise<boolean> {
  const settings = await db.guildSettings.findUnique({ where: { guildId }, select: { achievementAnnounceEnabled: true, achievementChannelId: true, achievementsEnabled: true, language: true } });
  if (!settings?.achievementAnnounceEnabled || !settings.achievementChannelId || !settings.achievementsEnabled) return false;
  const guild = await db.guild.findUnique({ where: { id: guildId }, select: { discordId: true, name: true } });
  const founded = guild ? serverCreatedAt(guild.discordId) : null;
  const due = founded ? anniversaryDue(founded, now) : null;
  if (!guild || !founded || !due) return false;
  const key = `server-anniversary:${due.year}`;
  if (await db.discordJob.findUnique({ where: { guildId_key: { guildId, key } }, select: { id: true } })) return false;

  const lang = settings.language === "fr" ? "fr" : "en";
  const [members, oldest, earned] = await Promise.all([
    db.member.count({ where: { guildId, status: "ACTIVE", isTest: false } }),
    db.member.findMany({ where: { guildId, status: "ACTIVE", isTest: false }, select: { displayName: true, createdAt: true }, orderBy: { createdAt: "asc" }, take: 5 }),
    db.memberAchievement.count({ where: { guildId, key: { notIn: [...RETIRED_ACHIEVEMENT_IDS] } } })
  ]);
  const card = serverAnniversaryCard({ serverName: guild.name, years: due.year, founded, members, achievementsEarned: earned, oldestMembers: oldest }, lang);
  const content = lang === "fr" ? `🎂 **${guild.name}** fête ses ${due.year} ${due.year === 1 ? "an" : "ans"} !` : `🎂 **${guild.name}** turns ${due.year}!`;
  await enqueueDiscordJob(db, guildId, key, "MESSAGE", {
    route: "achievements", channelId: settings.achievementChannelId,
    message: { content }, card: JSON.parse(JSON.stringify(card)), cardOnly: { embeds: [textlessEmbed(0xd4a017)] }
  });
  return true;
}

/** Hourly pass: celebrates every guild whose anniversary is due and that opted in. One guild failing never stops the rest. */
export async function sweepServerAnniversaries(db: Db, now = new Date(), onError: (error: unknown) => void = () => undefined): Promise<number> {
  let queued = 0;
  const guilds = await db.guildSettings.findMany({ where: { achievementAnnounceEnabled: true, achievementsEnabled: true, achievementChannelId: { not: null } }, select: { guildId: true }, take: 100 });
  for (const { guildId } of guilds) {
    try { if (await celebrateServerAnniversary(db, guildId, now)) queued++; } catch (error) { onError(error); }
  }
  return queued;
}
