import { EmbedBuilder } from "discord.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import type { Lang } from "../i18n.js";
import { reportedFooter } from "./card-format.js";
import { plural } from "./card-plural.js";
import { textlessEmbed } from "./card-only.js";
import { enqueueDiscordJob } from "./discord-jobs.js";
import { dungeonDisplayName } from "./dungeon-card.js";
import { highlightText, type HighlightKind } from "./dungeon-records.js";
import type { ScoreCard } from "./score-card.js";
import type { DungeonScene } from "./dungeon-art.js";
import { reportWeek } from "./weekly-report.js";

// "Records broken this week": one card after each weekly reset (Tuesday 15:00 UTC, the week that just ended) with the guild's new
// dungeon records, the members who climbed the most on the dungeon score and the new raid boss kills. Posts only when something
// happened. OPT-IN per server (owner rule 5 of 6 November covers the 8.5 features only, and CLAUDE.md forbids automatic posts without a
// configured opt-in): officers turn it on with /officer reports posts records-posts:true; it posts to the weekly-report channel, else the notify channel.

export interface WeeklyRecordsItem { kind: HighlightKind; label?: string; valueSec?: number; previousSec?: number; dungeonName: string; instanceId?: number }
export interface WeeklyRecords {
  weekStart: Date; weekEnd: Date;
  records: WeeklyRecordsItem[];
  climbers: { name: string; points: number }[];
  raidKills: { bosses: number; firsts: number; instances: string[]; latest: { boss: string; instance: string; at: Date } | null };
}

type Db = Pick<PrismaClient, "dungeonHighlight" | "dungeonPointTransaction" | "raidKill" | "member">;

export const recordsIsEmpty = (week: WeeklyRecords): boolean => !week.records.length && !week.climbers.length && !week.raidKills.bosses;

/** What the guild did in the week that ended at the last weekly reset. Nothing is guessed: every line is a stored row. */
export async function weeklyRecords(db: Db, guildId: string, now: Date): Promise<WeeklyRecords> {
  const { start, end } = reportWeek(now);
  const window = { gte: start, lt: end };
  const [highlights, points, kills, earlier] = await Promise.all([
    db.dungeonHighlight.findMany({ where: { guildId, createdAt: window, kind: { in: ["clear", "boss", "first"] } }, orderBy: { createdAt: "asc" }, take: 40,
      select: { kind: true, label: true, valueSec: true, previousSec: true, dungeonName: true, instanceId: true } }),
    db.dungeonPointTransaction.groupBy({ by: ["memberId"], where: { guildId, createdAt: window, amount: { gt: 0 } }, _sum: { amount: true }, orderBy: { _sum: { amount: "desc" } }, take: 5 }),
    db.raidKill.findMany({ where: { guildId, valid: true, killedAt: window }, orderBy: { killedAt: "asc" }, take: 200, select: { instanceId: true, instanceName: true, encounterId: true, difficultyId: true, bossName: true, killedAt: true } }),
    db.raidKill.findMany({ where: { guildId, valid: true, killedAt: { lt: start } }, select: { instanceId: true, encounterId: true, difficultyId: true }, take: 2000 })
  ]);
  const members = points.length ? await db.member.findMany({ where: { id: { in: points.map(row => row.memberId) } }, select: { id: true, displayName: true } }) : [];
  const names = new Map(members.map(member => [member.id, member.displayName]));
  const bossKey = (row: { instanceId: number; encounterId: number; difficultyId: number }) => `${row.instanceId}:${row.encounterId}:${row.difficultyId}`;
  const had = new Set(earlier.map(bossKey));
  const distinct = new Map<string, (typeof kills)[number]>();
  for (const kill of kills) if (!distinct.has(bossKey(kill))) distinct.set(bossKey(kill), kill);
  const latest = kills.at(-1);
  return {
    weekStart: start, weekEnd: end,
    records: highlights.map(row => ({ kind: row.kind as HighlightKind, dungeonName: row.dungeonName, ...(row.instanceId ? { instanceId: row.instanceId } : {}), ...(row.label ? { label: row.label } : {}),
      ...(row.valueSec !== null ? { valueSec: row.valueSec } : {}), ...(row.previousSec !== null ? { previousSec: row.previousSec } : {}) })),
    climbers: points.flatMap(row => row._sum.amount && names.get(row.memberId) ? [{ name: names.get(row.memberId)!, points: row._sum.amount }] : []),
    raidKills: { bosses: distinct.size, firsts: [...distinct.keys()].filter(id => !had.has(id)).length, instances: [...new Set(kills.map(kill => kill.instanceName))].slice(0, 5),
      latest: latest ? { boss: latest.bossName, instance: latest.instanceName, at: latest.killedAt } : null }
  };
}

const label = (date: Date, lang: Lang) => new Intl.DateTimeFormat(lang === "fr" ? "fr-CA" : "en-US", { month: "long", day: "numeric", timeZone: "UTC" }).format(date);
const range = (week: WeeklyRecords, lang: Lang) => `${label(week.weekStart, lang)} - ${label(new Date(week.weekEnd.getTime() - 1), lang)}`;
const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;

/** The text that goes with the card: the same facts, readable without the image. */
export function weeklyRecordsEmbed(week: WeeklyRecords, lang: Lang): EmbedBuilder {
  const fr = lang === "fr";
  const lines: string[] = [];
  if (week.records.length) {
    lines.push(`🏰 **${fr ? "Records de donjon" : "Dungeon records"}**`);
    for (const item of week.records.slice(0, 8)) lines.push(highlightText(item, lang, true));
  }
  if (week.climbers.length) lines.push(`📈 **${fr ? "Plus grosses montées" : "Top climbers"}**: ${week.climbers.slice(0, 5).map(row => `${row.name} (+${row.points})`).join(", ")}`);
  if (week.raidKills.bosses) {
    lines.push(`🐉 **${fr ? "Raids" : "Raids"}** · ${plural(lang, week.raidKills.bosses, ["boss killed", "bosses killed"], ["boss tué", "boss tués"])}${week.raidKills.firsts ? ` (${plural(lang, week.raidKills.firsts, ["first for the guild", "firsts for the guild"], ["première de la guilde", "premières de la guilde"])})` : ""}`);
  }
  return new EmbedBuilder().setColor(0xd4af37).setTitle(`${fr ? "🏆 Records de la semaine" : "🏆 Records broken this week"} · ${range(week, lang)}`.slice(0, 256))
    .setDescription(lines.join("\n").slice(0, 3800))
    .setFooter({ text: reportedFooter(lang) });
}

const SCENES: DungeonScene[] = ["stratholme", "scarlet", "blackrock", "forest", "dalaran", "wailing", "sunken", "shadowfang", "uldaman", "zulfarrak"];
const TIMES = ["dawn", "day", "night"];
const seedOf = (text: string) => { let h = 2166136261; for (const c of text) h = Math.imul(h ^ c.codePointAt(0)!, 16777619); return h >>> 0; };

/** The card, in the recap layout the daily recap uses (painted scene, a stats strip and up to three panels). */
export function weeklyRecordsCard(week: WeeklyRecords, lang: Lang, guildName: string): ScoreCard {
  const t = (en: string, french: string) => lang === "fr" ? french : en;
  const seed = seedOf(week.weekEnd.toISOString());
  const stats: ScoreCard["stats"] = [];
  if (week.records.length) stats.push({ label: t("Dungeon records", "Records de donjon"), value: String(week.records.length), accent: "gold" });
  if (week.climbers.length) stats.push({ label: t("Climbers", "Montées"), value: String(week.climbers.length), accent: "green" });
  if (week.raidKills.bosses) stats.push({ label: t("Raid bosses", "Boss de raid"), value: String(week.raidKills.bosses), accent: "red" });
  const sections: NonNullable<ScoreCard["recap"]>["sections"] = [];
  if (week.records.length) sections.push({ title: t("Dungeons · new records", "Donjons · nouveaux records"), rows: week.records.slice(0, 5).map(item => ({
    name: item.kind === "clear" ? t("Guild record", "Record de guilde") : item.kind === "boss" ? item.label ?? t("Boss record", "Record de boss") : t("First guild clear", "Premier parcours"),
    sub: dungeonDisplayName({ dungeonName: item.dungeonName, instanceId: item.instanceId }, lang),
    ...(item.valueSec !== undefined && item.kind !== "first" ? { right: clock(item.valueSec), rightTone: "gold" as const } : {}) })) });
  if (week.climbers.length) sections.push({ title: t("Top climbers · dungeon score", "Plus grosses montées · score de donjon"), rows: week.climbers.slice(0, 5).map(row => ({ name: row.name, right: `+${row.points}`, rightTone: "green" as const })) });
  if (week.raidKills.bosses) sections.push({ title: t("Raid progress", "Progression en raid"), rows: [
    { name: plural(lang, week.raidKills.bosses, ["boss killed", "bosses killed"], ["boss tué", "boss tués"]), sub: week.raidKills.instances.join(", ") },
    ...(week.raidKills.latest ? [{ name: week.raidKills.latest.boss, sub: week.raidKills.latest.instance, right: t("latest", "dernier"), rightTone: "red" as const }] : [])
  ] });
  return {
    eyebrow: t("Guilded · Records broken this week", "Guilded · Records de la semaine"), title: guildName, subtitle: range(week, lang), stats: stats.slice(0, 4), footer: reportedFooter(lang), moreLabel: t("more", "autres"),
    backdrop: { kind: "recap", key: TIMES[seed % TIMES.length]! },
    recap: { theme: { a: "#1e1236", b: "#6a4aa8", motif: "keep", seed, scene: SCENES[seed % SCENES.length]! }, sections: sections.slice(0, 3) }
  };
}

type QueueDb = Db & Pick<PrismaClient, "guildSettings" | "$transaction">;

/**
 * Hourly: for every server that turned the post on, once per weekly reset, queue the card for the week that ended (nothing in a quiet
 * week). The week is claimed in the same transaction as the job, so two ticks cannot post it twice. Returns how many were queued.
 */
export async function queueWeeklyRecords(db: QueueDb, now = new Date(), options: { scope?: Record<string, unknown>; onError?: (error: unknown) => void } = {}): Promise<number> {
  const onError = options.onError ?? (() => undefined);
  const resetAt = reportWeek(now).end;
  const guilds = await db.guildSettings.findMany({ where: { ...options.scope, weeklyRecordsEnabled: true, OR: [{ weeklyRecordsLastAt: null }, { weeklyRecordsLastAt: { lt: resetAt } }],
    AND: [{ OR: [{ weeklyReportChannelId: { not: null } }, { notifyChannelId: { not: null } }] }] }, select: { guildId: true, language: true, guild: { select: { name: true } } }, take: 500 });
  let queued = 0;
  for (const settings of guilds) {
    try {
      const week = await weeklyRecords(db, settings.guildId, now);
      const lang: Lang = settings.language === "fr" ? "fr" : "en";
      const done = await db.$transaction(async tx => {
        const claim = await tx.guildSettings.updateMany({ where: { guildId: settings.guildId, weeklyRecordsEnabled: true, OR: [{ weeklyRecordsLastAt: null }, { weeklyRecordsLastAt: { lt: resetAt } }] }, data: { weeklyRecordsLastAt: now } });
        if (!claim.count || recordsIsEmpty(week)) return false;
        await enqueueDiscordJob(tx, settings.guildId, `weekly-records:${week.weekEnd.toISOString()}`, "MESSAGE", { route: "wowWeekly",
          message: JSON.parse(JSON.stringify({ embeds: [weeklyRecordsEmbed(week, lang).toJSON()] })), card: JSON.parse(JSON.stringify(weeklyRecordsCard(week, lang, settings.guild.name))), cardOnly: { embeds: [textlessEmbed(0xd4af37)] } });
        return true;
      });
      if (done) queued++;
    } catch (error) { onError(error); }
  }
  return queued;
}
