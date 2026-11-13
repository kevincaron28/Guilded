import type { Lang } from "../i18n.js";
import type { ScoreCard } from "./score-card.js";
import type { WeeklyReport } from "./weekly-report.js";

// The weekly report card (9.3): the headline of the guild's week (raids, boss kills, dungeon clears against the week before) and
// the players of the week. It replaces the report's first embed; the cores and dungeon embeds stay as text under it, and the
// whole text report is the fallback when the picture cannot be drawn. Follows the existing weekly report switch.

const day = (date: Date) => date.toISOString().slice(0, 10);
const delta = (now: number, before: number, fr: boolean) => before === now ? (fr ? "comme la semaine passée" : "same as last week") : `${now > before ? "+" : "−"}${Math.abs(now - before)} ${fr ? "vs semaine passée" : "vs last week"}`;

export function weeklyReportCard(report: WeeklyReport, lang: Lang): ScoreCard {
  const fr = lang === "fr", t = (en: string, french: string) => fr ? french : en;
  const d = report.dungeons;
  const rows: NonNullable<ScoreCard["rows"]> = [];
  if (report.raiderOfWeek) rows.push({ name: report.raiderOfWeek.name, sub: t("Raider of the week", "Raider de la semaine"), right: `${report.raiderOfWeek.ep} EP`, rightTone: "gold" });
  if (report.dungeonHero) rows.push({ name: report.dungeonHero.name, sub: t("Dungeon hero", "Héros des donjons"), right: `${report.dungeonHero.points} pts`, rightTone: "green" });
  if (d.marathon) rows.push({ name: d.marathon.name, sub: t("Dungeon marathon", "Marathon de donjons"), right: `×${d.marathon.runs}`, rightTone: "green" });
  if (report.guild.coreId === undefined && report.guild.newMembers > 0) rows.push({ name: t(`${report.guild.newMembers} new member(s)`, `${report.guild.newMembers} nouveau(x) membre(s)`), sub: t("Joined the Discord this week", "Arrivés cette semaine") });
  for (const core of report.cores.slice(0, Math.max(0, 5 - rows.length)))
    rows.push({ name: core.name, sub: t(`${core.raids} raid(s) · ${core.bossKills} boss kill(s)`, `${core.raids} raid(s) · ${core.bossKills} victoire(s)`), right: core.attendancePct === null ? undefined : `${core.attendancePct}%` });
  const badges: NonNullable<ScoreCard["badges"]> = [];
  if (d.records.length) badges.push({ text: t(`${d.records.length} dungeon record(s)`, `${d.records.length} record(s) de donjon`), tone: "ok" });
  if (d.firsts.length) badges.push({ text: t(`${d.firsts.length} first clear(s)`, `${d.firsts.length} première(s) complétion(s)`), tone: "ok" });
  return {
    eyebrow: t("Guilded · Weekly report", "Guilded · Bilan hebdo"), title: t("The guild's week", "La semaine de la guilde"),
    subtitle: `${day(report.weekStart)} → ${day(report.weekEnd)}`,
    backdrop: { kind: "board", key: "weekly", fallbackKey: "activity" },
    stats: [
      { label: t("Raids", "Raids"), value: String(report.guild.raids), accent: "gold", note: delta(report.guild.raids, report.previous.raids, fr) },
      { label: t("Boss kills", "Boss vaincus"), value: String(report.guild.bossKills), note: delta(report.guild.bossKills, report.previous.bossKills, fr) },
      { label: t("Dungeon clears", "Donjons terminés"), value: String(d.completed), accent: "green", note: d.runs > d.completed ? t(`${d.runs} runs`, `${d.runs} parcours`) : undefined }
    ],
    rowsLabel: t("Players of the week", "Joueurs de la semaine"), rows,
    ...(badges.length ? { badges } : {}),
    footer: t("Weekly report · Counts from the guild's own records · No points · guildedwow.com", "Bilan hebdo · Chiffres tirés des données de la guilde · Aucun point · guildedwow.com")
  };
}
