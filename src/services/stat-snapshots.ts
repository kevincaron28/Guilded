import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { PrismaClient } from "../generated/prisma/client.js";

// 8.5 track G: one statistics row per guild per UTC day, the CSV feed built from those rows, and the
// revocable feed key. Charts (the Statistics page, /stats server) and Google Sheets read the same rows.
// Only a SHA-256 hash of the feed key is stored, and the key is never logged.

export const LEVEL_BANDS = ["1-9", "10-19", "20-29", "30-39", "40-49", "50-59", "60"] as const;
export const MAX_FEED_DAYS = 400;
const DAY_MS = 86_400_000;

export interface StatSnapshot {
  day: string; discordMembers: number; activeMembers: number; linkedMembers: number; rosterSize: number; onlinePeak: number; level60: number;
  messages: number; voiceMinutes: number; raids: number; dungeonRuns: number;
  levelBands: Record<string, number>; classCounts: Record<string, number>;
}

export const utcDay = (date: Date) => date.toISOString().slice(0, 10);
export const levelBand = (level: number): string => level >= 60 ? "60" : level < 10 ? "1-9" : `${Math.floor(level / 10) * 10}-${Math.floor(level / 10) * 10 + 9}`;

type Db = Pick<PrismaClient, "guildStatSnapshot" | "member" | "character" | "memberActivityTotal" | "raid" | "dungeonRun" | "guildSettings" | "guild">;

const counts = (value: unknown): Record<string, number> => {
  const out: Record<string, number> = {};
  if (value && typeof value === "object" && !Array.isArray(value)) for (const [key, n] of Object.entries(value)) if (typeof n === "number" && Number.isFinite(n)) out[key] = n;
  return out;
};

/** Writes (or refreshes) today's row for one guild. `discordMembers` is null when the server is not in the cache. */
export async function takeGuildSnapshot(db: Db, guildId: string, discordMembers: number | null, now = new Date()): Promise<StatSnapshot> {
  const day = utcDay(now);
  const dayStart = new Date(`${day}T00:00:00.000Z`);
  const dayEnd = new Date(dayStart.getTime() + DAY_MS);
  const since = new Date(now.getTime() - DAY_MS);
  const members = { status: "ACTIVE" as const, isTest: false };
  const [linkedMembers, characters, totals, active, raids, dungeonRuns, previous, today] = await Promise.all([
    db.member.count({ where: { guildId, ...members, characters: { some: {} } } }),
    db.character.findMany({ where: { guildId, member: members }, select: { level: true, className: true, lastSeenAt: true }, take: 20_000 }),
    db.memberActivityTotal.aggregate({ where: { guildId }, _sum: { messages: true, voiceSeconds: true } }),
    db.memberActivityTotal.count({ where: { guildId, updatedAt: { gte: since } } }),
    db.raid.count({ where: { guildId, isTest: false, startedAt: { gte: dayStart, lt: dayEnd } } }),
    db.dungeonRun.count({ where: { guildId, valid: true, OR: [{ startedAt: { gte: dayStart, lt: dayEnd } }, { startedAt: null, createdAt: { gte: dayStart, lt: dayEnd } }] } }),
    db.guildStatSnapshot.findFirst({ where: { guildId, day: { lt: day } }, orderBy: { day: "desc" }, select: { totalMessages: true, totalVoiceSeconds: true, discordMembers: true } }),
    db.guildStatSnapshot.findUnique({ where: { guildId_day: { guildId, day } }, select: { onlinePeak: true, discordMembers: true } })
  ]);
  const levelBands: Record<string, number> = Object.fromEntries(LEVEL_BANDS.map(band => [band, 0]));
  const classCounts: Record<string, number> = {};
  let seen = 0;
  for (const row of characters) {
    if (row.level) levelBands[levelBand(row.level)]! += 1;
    classCounts[row.className] = (classCounts[row.className] ?? 0) + 1;
    if (row.lastSeenAt && row.lastSeenAt >= since) seen += 1;
  }
  const totalMessages = totals._sum.messages ?? 0, totalVoiceSeconds = totals._sum.voiceSeconds ?? 0;
  const row = {
    discordMembers: discordMembers ?? today?.discordMembers ?? previous?.discordMembers ?? 0,
    activeMembers: active, linkedMembers, rosterSize: characters.length,
    onlinePeak: Math.max(seen, today?.onlinePeak ?? 0), level60: levelBands["60"]!,
    // Differences against the last earlier snapshot; the first snapshot has nothing to compare with.
    messages: previous ? Math.max(0, totalMessages - previous.totalMessages) : 0,
    voiceMinutes: previous ? Math.max(0, Math.round((totalVoiceSeconds - previous.totalVoiceSeconds) / 60)) : 0,
    raids, dungeonRuns, totalMessages, totalVoiceSeconds, levelBands, classCounts
  };
  await db.guildStatSnapshot.upsert({ where: { guildId_day: { guildId, day } }, create: { guildId, day, ...row }, update: row });
  return { day, ...row };
}

/** The daily job: every guild with statistics on, skipping servers `allowed` refuses (the 8.5 preview switch). */
export async function runStatSnapshots(db: Db, discordMemberCount: (discordId: string) => number | null, allowed: (discordId: string) => boolean = () => true, now = new Date()): Promise<number> {
  const rows = await db.guildSettings.findMany({ where: { statsEnabled: true }, select: { guildId: true, guild: { select: { discordId: true } } }, take: 500 });
  let written = 0;
  for (const row of rows) {
    if (!allowed(row.guild.discordId)) continue;
    await takeGuildSnapshot(db, row.guildId, discordMemberCount(row.guild.discordId), now);
    written += 1;
  }
  return written;
}

export async function recentSnapshots(db: Pick<PrismaClient, "guildStatSnapshot">, guildId: string, days: number): Promise<StatSnapshot[]> {
  const rows = await db.guildStatSnapshot.findMany({ where: { guildId }, orderBy: { day: "desc" }, take: Math.min(Math.max(1, days), MAX_FEED_DAYS) });
  return rows.reverse().map(row => ({ day: row.day, discordMembers: row.discordMembers, activeMembers: row.activeMembers, linkedMembers: row.linkedMembers, rosterSize: row.rosterSize,
    onlinePeak: row.onlinePeak, level60: row.level60, messages: row.messages, voiceMinutes: row.voiceMinutes, raids: row.raids, dungeonRuns: row.dungeonRuns,
    levelBands: counts(row.levelBands), classCounts: counts(row.classCounts) }));
}

const cell = (value: string | number) => {
  const text = String(value).replace(/[\r\n]+/g, " ");
  const safe = /^[=+\-@\t]/.test(text) ? `'${text}` : text;
  return /[",]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
};

/** The feed Google Sheets loads: a header row, then one row per day, oldest first. */
export function statsCsv(rows: StatSnapshot[]): string {
  const classes = [...new Set(rows.flatMap(row => Object.keys(row.classCounts)))].sort();
  const header = ["day", "discord_members", "active_members", "linked_members", "roster_characters", "online_peak", "level_60", "messages", "voice_minutes", "raids", "dungeon_runs",
    ...LEVEL_BANDS.map(band => `level_${band.replace("-", "_")}`), ...classes.map(name => `class_${name.replace(/[^A-Za-z]+/g, "_")}`)];
  const lines = rows.map(row => [row.day, row.discordMembers, row.activeMembers, row.linkedMembers, row.rosterSize, row.onlinePeak, row.level60, row.messages, row.voiceMinutes, row.raids, row.dungeonRuns,
    ...LEVEL_BANDS.map(band => row.levelBands[band] ?? 0), ...classes.map(name => row.classCounts[name] ?? 0)].map(cell).join(","));
  return `${[header.join(","), ...lines].join("\r\n")}\r\n`;
}

// --- The feed key -------------------------------------------------------------------------------

const hashKey = (key: string) => createHash("sha256").update(key).digest("hex");
export const newFeedKey = () => randomBytes(24).toString("base64url");

/** Makes a new key (replacing any old one, which stops working at once) and returns it: shown once, never stored. */
export async function regenerateFeedKey(db: Pick<PrismaClient, "guildSettings">, guildId: string, now = new Date()): Promise<string> {
  const key = newFeedKey();
  await db.guildSettings.update({ where: { guildId }, data: { statsFeedKeyHash: hashKey(key), statsFeedKeyAt: now } });
  return key;
}

export async function revokeFeedKey(db: Pick<PrismaClient, "guildSettings">, guildId: string): Promise<void> {
  await db.guildSettings.update({ where: { guildId }, data: { statsFeedKeyHash: null, statsFeedKeyAt: null } });
}

/** Constant-time check of a presented key; false for a missing key, a revoked feed or statistics turned off. */
export async function feedAccess(db: Pick<PrismaClient, "guildSettings">, guildId: string, key: string): Promise<boolean> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(key) || guildId.length > 64) return false;
  const settings = await db.guildSettings.findUnique({ where: { guildId }, select: { statsEnabled: true, statsFeedKeyHash: true } });
  if (!settings?.statsEnabled || !settings.statsFeedKeyHash) return false;
  const a = Buffer.from(hashKey(key)), b = Buffer.from(settings.statsFeedKeyHash);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function feedUrl(siteUrl: string, guildId: string, key: string): string {
  const url = new URL("/api/v1/stats-feed", siteUrl);
  url.searchParams.set("guild", guildId);
  url.searchParams.set("key", key);
  return url.href;
}
