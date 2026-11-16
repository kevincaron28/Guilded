import { AttachmentBuilder, EmbedBuilder, type Guild as DiscordGuild } from "discord.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import type { Lang } from "../i18n.js";
import { forEachGuildScope, guildWhere } from "./guild-scope.js";
import { weekStart } from "./dungeon-rules.js";
import { recentSnapshots, type StatSnapshot } from "./stat-snapshots.js";
import { scoreCardPng, type ScoreCard } from "./score-card.js";

// Officer member-trend graph: in-game roster, Discord members and active members over 30 or 90 days, from the daily
// GuildStatSnapshot rows (stat-snapshots.ts). Officer-only: `/officer stats trend` (private) and a weekly post in the
// officers-only log channel (on by default, switch `/officer stats trend weekly:false`). Nothing public.

export const TREND_COLORS = { inGame: "#ffd100", discord: "#6aa8ff", active: "#6fdc4f" } as const;
export interface TrendSeries { label: string; color: string; values: (number | null)[] }
export interface TrendDelta { label: string; text: string; tone: "green" | "red" | "muted" }
export interface TrendTile { label: string; value: string; color: string; deltas: TrendDelta[] }
export interface TrendVisual { days: string[]; series: TrendSeries[]; tiles: TrendTile[]; chartTitle: string; emptyNote?: string | undefined }

const DAY_MS = 86_400_000;
const shiftDay = (day: string, by: number) => new Date(new Date(`${day}T00:00:00.000Z`).getTime() + by * DAY_MS).toISOString().slice(0, 10);

/** "+3", "-2", "0": the change in a count. */
export const signed = (n: number) => n > 0 ? `+${n}` : n < 0 ? `-${Math.abs(n)}` : "0";

/** Pure: change of a series against the snapshot on or before `lastDay - back` days; null when that day or either value is unknown. */
export function trendDelta(rows: readonly StatSnapshot[], pick: (row: StatSnapshot) => number | null | undefined, back: number): number | null {
  const last = rows[rows.length - 1];
  if (!last) return null;
  const target = shiftDay(last.day, -back);
  const base = [...rows].reverse().find(row => row.day <= target);
  const now = pick(last), then = base ? pick(base) : null;
  return now === null || now === undefined || then === null || then === undefined ? null : now - then;
}

/** Pure: everything the card draws, for the last `days` days of snapshots (oldest first). */
export function buildTrend(allRows: readonly StatSnapshot[], days: 30 | 90, lang: Lang, today = new Date()): TrendVisual {
  const t = (en: string, fr: string) => lang === "fr" ? fr : en;
  const last = allRows[allRows.length - 1];
  const windowStart = last ? shiftDay(last.day, -(days - 1)) : "";
  const rows = allRows.filter(row => row.day >= windowStart);
  const picks = [
    { label: t("In-game members", "Membres en jeu"), color: TREND_COLORS.inGame, pick: (r: StatSnapshot) => r.inGuildMembers ?? null },
    { label: t("Discord members", "Membres Discord"), color: TREND_COLORS.discord, pick: (r: StatSnapshot) => r.discordMembers },
    { label: t("Active members", "Membres actifs"), color: TREND_COLORS.active, pick: (r: StatSnapshot) => r.activeMembers }
  ];
  const tiles: TrendTile[] = picks.map(p => {
    const now = last ? p.pick(last) : null;
    return { label: p.label, color: p.color, value: now === null ? "—" : String(now), deltas: ([7, 30, 90] as const).map(back => {
      const d = trendDelta(allRows, p.pick, back);
      return { label: `${back}${t("d", "j")}`, text: d === null ? "—" : signed(d), tone: d === null || d === 0 ? "muted" as const : d > 0 ? "green" as const : "red" as const };
    }) };
  });
  const nextDay = shiftDay(last?.day ?? today.toISOString().slice(0, 10), 1);
  return {
    days: rows.map(r => r.day), tiles,
    series: picks.map(p => ({ label: p.label, color: p.color, values: rows.map(p.pick) })),
    chartTitle: t(`Last ${days} days`, `${days} derniers jours`),
    ...(rows.length < 2 ? { emptyNote: t(`Trend starts ${nextDay}`, `La tendance commence le ${nextDay}`) } : {})
  };
}

export function memberTrendCard(rows: readonly StatSnapshot[], days: 30 | 90, guildName: string, lang: Lang, today = new Date()): ScoreCard {
  const fr = lang === "fr", trend = buildTrend(rows, days, lang, today), last = rows[rows.length - 1];
  const inWindow = rows.filter(r => last && r.day >= shiftDay(last.day, -(days - 1)));
  const joins = inWindow.reduce((n, r) => n + (r.joins ?? 0), 0), leaves = inWindow.reduce((n, r) => n + (r.leaves ?? 0), 0);
  const hasFlow = inWindow.some(r => r.joins !== null && r.joins !== undefined);
  return {
    eyebrow: fr ? "Tendance des membres" : "Member trend", title: guildName.slice(0, 30),
    subtitle: trend.chartTitle, stats: [], trend,
    footer: `${last ? `${last.day} UTC` : fr ? "aucun relevé" : "no snapshot yet"}${hasFlow ? ` · ${fr ? "arrivées" : "joins"} ${joins} · ${fr ? "départs" : "leaves"} ${leaves}` : ""}`
  };
}

export function memberTrendEmbed(card: ScoreCard, lang: Lang): EmbedBuilder {
  const trend = card.trend!;
  const lines = trend.tiles.map(tile => `**${tile.label}**: ${tile.value} (${tile.deltas.map(d => `${d.label} ${d.text}`).join(", ")})`);
  return new EmbedBuilder().setColor(0xffd100).setTitle(`${lang === "fr" ? "Tendance des membres" : "Member trend"} · ${card.title}`.slice(0, 256))
    .setDescription([...(trend.emptyNote ? [trend.emptyNote] : []), ...lines].join("\n")).setImage("attachment://member-trend.png");
}

export async function memberTrendMessage(db: Pick<PrismaClient, "guildStatSnapshot">, guildId: string, days: 30 | 90, guildName: string, lang: Lang, today = new Date()) {
  const rows = await recentSnapshots(db, guildId, days + 90);
  const card = memberTrendCard(rows, days, guildName, lang, today);
  const png = await scoreCardPng(card);
  return { empty: Boolean(card.trend?.emptyNote), payload: { embeds: [memberTrendEmbed(card, lang)], files: png ? [new AttachmentBuilder(png, { name: "member-trend.png" })] : [], allowedMentions: { parse: [] as never[] } } };
}

type WeeklyDb = Pick<PrismaClient, "guild" | "guildSettings" | "guildStatSnapshot">;
interface TrendDue { memberTrendPostEnabled: boolean; statsEnabled: boolean; logChannelId: string | null; memberTrendLastPostAt: Date | null; weeklyReportEnabled: boolean; weeklyReportLastAt: Date | null }

/** Pure: due once per weekly reset, after that week's report went out (a server without the weekly report just waits for the reset). */
export function isTrendPostDue(s: TrendDue, now: Date): boolean {
  if (!s.memberTrendPostEnabled || !s.statsEnabled || !s.logChannelId) return false;
  const reset = weekStart(now).getTime();
  if (s.memberTrendLastPostAt && s.memberTrendLastPostAt.getTime() >= reset) return false;
  return !s.weeklyReportEnabled || (s.weeklyReportLastAt?.getTime() ?? 0) >= reset;
}

/** Weekly member-trend card in the officer log channel; nothing before the second day of data. Returns true when posted. */
export async function postWeeklyMemberTrend(db: WeeklyDb, discordGuild: DiscordGuild, now = new Date()): Promise<boolean> {
  const guild = await db.guild.findUnique({ where: guildWhere(discordGuild.id), select: { id: true, settings: true } });
  const s = guild?.settings;
  if (!guild || !s || !s.logChannelId || !isTrendPostDue(s, now)) return false;
  const channel = await discordGuild.channels.fetch(s.logChannelId).catch(() => null);
  if (!channel?.isTextBased() || !("send" in channel)) return false;
  const message = await memberTrendMessage(db, guild.id, 30, discordGuild.name, s.language === "fr" ? "fr" : "en", now);
  if (message.empty) return false;
  // Claim the week first: if the send succeeds but a later database write failed, the card would be posted again every hour. If the
  // send itself fails the claim is given back, so the next hourly run retries.
  await db.guildSettings.update({ where: { guildId: guild.id }, data: { memberTrendLastPostAt: now } });
  try { await channel.send(message.payload); }
  catch (error) {
    await db.guildSettings.update({ where: { guildId: guild.id }, data: { memberTrendLastPostAt: s.memberTrendLastPostAt } }).catch(() => undefined);
    throw error;
  }
  return true;
}

export async function postAllWeeklyMemberTrends(db: WeeklyDb, guilds: Iterable<DiscordGuild>, report: (error: unknown) => void): Promise<void> {
  for (const guild of guilds) await forEachGuildScope(db as PrismaClient, guild.id, () => postWeeklyMemberTrend(db, guild)).catch(report);
}
