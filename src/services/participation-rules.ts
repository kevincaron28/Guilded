import { createHash } from "node:crypto";
import { z } from "zod";
import { localParts, zonedTime } from "./raid-time.js";

export const participationRules = z.object({
  textChannels: z.array(z.string().min(1)).max(20).default([]),
  voiceChannels: z.array(z.string().min(1)).max(20).default([]),
  // By default every text channel and every voice channel counts (temporary group channels
  // included). Turned off, only the listed channels do.
  allText: z.boolean().default(true),
  allVoice: z.boolean().default(true),
  emojis: z.array(z.string().min(1).max(80)).max(10).default(["👍", "❤️", "🎉"]),
  messageDailyCap: z.number().int().min(0).max(50).default(10),
  reactionDailyCap: z.number().int().min(0).max(20).default(6),
  voiceDailyMinutes: z.number().int().min(0).max(240).default(240),
  minimumMemberDays: z.number().int().min(0).max(30).default(3),
  weeklyGoal: z.number().int().min(2).max(500).default(10)
});
export type ParticipationRules = z.infer<typeof participationRules>;
export const VOICE_BLOCK_MS = 15 * 60_000;
export const MAX_VOICE_GAP_MS = 90_000;
export const MESSAGE_COOLDOWN_MS = 5 * 60_000;
export const normalizeEmoji = (value: string) => value.replace(/\uFE0F/g, "");

export function participationDay(now: Date, timezone: string): string {
  const p = localParts(now, timezone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}
export function participationWeek(now: Date, timezone: string): string {
  const p = localParts(now, timezone);
  return new Date(Date.UTC(p.year, p.month - 1, p.day - (p.weekday + 6) % 7)).toISOString().slice(0, 10);
}
export function dayStart(day: string, timezone: string): Date {
  const [year, month, date] = day.split("-").map(Number);
  return zonedTime(year!, month!, date!, 0, 0, timezone);
}
export function dateAfter(day: string, days: number): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, date! + days)).toISOString().slice(0, 10);
}

// No raw message text is persisted. This is duplicate detection, not a quality judgment.
export function messageFingerprint(content: string): string | null {
  const clean = content.normalize("NFKC").toLowerCase().replace(/https?:\/\/\S+/g, "").replace(/<(?:[@#][^>]+|a?:[^>]+)>/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  if (clean.replace(/\s/g, "").length < 12 || new Set(clean.replace(/\s/g, "")).size < 4 || /^[!/$?.]/.test(content.trim())) return null;
  return createHash("sha256").update(clean).digest("hex");
}

export function memberEligible(member: { bot: boolean; createdAt: number; joinedAt: number | null; audience: boolean; canView: boolean }, rules: ParticipationRules, now: Date): boolean {
  return !member.bot && member.audience && member.canView && member.joinedAt !== null &&
    now.getTime() - member.createdAt >= 7 * 86_400_000 && now.getTime() - member.joinedAt >= rules.minimumMemberDays * 86_400_000;
}

// Intervals are short; split at local midnight without assuming a 24-hour DST day.
export function voiceSegments(start: Date, end: Date, timezone: string): { day: string; start: Date; end: Date }[] {
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start || end.getTime() - start.getTime() > MAX_VOICE_GAP_MS) return [];
  const day = participationDay(start, timezone);
  if (participationDay(new Date(end.getTime() - 1), timezone) === day) return [{ day, start, end }];
  let low = start.getTime(), high = end.getTime();
  while (high - low > 1) {
    const mid = Math.floor((low + high) / 2);
    if (participationDay(new Date(mid), timezone) === day) low = mid; else high = mid;
  }
  return [{ day, start, end: new Date(high) }, { day: participationDay(new Date(high), timezone), start: new Date(high), end }].filter(segment => segment.end > segment.start);
}

export function participationBadge(points: number): string {
  return points >= 300 ? "🏅 300" : points >= 150 ? "🥈 150" : points >= 50 ? "🥉 50" : "—";
}
