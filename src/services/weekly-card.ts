import type { Lang } from "../i18n.js";
import { cardDate } from "./card-format.js";
import { plural } from "./card-plural.js";
import type { ScoreCard } from "./score-card.js";
import type { WeeklyReport } from "./weekly-report.js";
import { dungeonShare } from "./community-ingame.js";

// The weekly report card (9.3): the headline of the guild's week (raids, boss kills, dungeon clears against the week before) and
// the players of the week. It replaces the report's first embed; the cores and dungeon embeds stay as text under it, and the
// whole text report is the fallback when the picture cannot be drawn. Follows the existing weekly report switch.

const delta = (now: number, before: number, fr: boolean) => before === now ? (fr ? "comme la semaine passée" : "same as last week") : `${now > before ? "+" : "−"}${Math.abs(now - before)} ${fr ? "vs semaine passée" : "vs last week"}`;

export function weeklyReportCard(report: WeeklyReport, lang: Lang, timeZone?: string): ScoreCard {
  const day = (date: Date) => cardDate(date, lang, timeZone);
  const fr = lang === "fr", t = (en: string, french: string) => fr ? french : en;
  const d = report.dungeons;
  const rows: NonNullable<ScoreCard["rows"]> = [];
  if (report.raiderOfWeek) rows.push({ name: report.raiderOfWeek.name, sub: t("Raider of the week", "Raider de la semaine"), right: `${report.raiderOfWeek.ep} ${t("raid pts", "pts de raid")}`, rightTone: "gold" });
  if (report.dungeonHero) rows.push({ name: report.dungeonHero.name, sub: t("Dungeon hero", "Héros des donjons"), right: `${dungeonShare(report.dungeonHero.points)} pts`, rightTone: "green" });
  if (d.marathon) rows.push({ name: d.marathon.name, sub: t("Dungeon marathon", "Marathon de donjons"), right: `×${d.marathon.runs}`, rightTone: "green" });
  for (const core of report.cores.slice(0, Math.max(0, 5 - rows.length)))
    rows.push({ name: core.name, sub: `${plural(lang, core.raids, ["raid", "raids"], ["raid", "raids"])} · ${plural(lang, core.bossKills, ["boss kill", "boss kills"], ["victoire", "victoires"])}`, right: core.attendancePct === null ? undefined : `${core.attendancePct}%` });
  // A quiet week (no raid, few names) would leave most of the card empty: the week before is the next useful fact.
  if (rows.length < 2 && (report.previous.raids > 0 || report.previous.bossKills > 0))
    rows.push({ name: t("Last week", "Semaine passée"), sub: `${plural(lang, report.previous.raids, ["raid", "raids"], ["raid", "raids"])} · ${plural(lang, report.previous.bossKills, ["boss kill", "boss kills"], ["victoire", "victoires"])}` });
  const badges: NonNullable<ScoreCard["badges"]> = [];
  if (d.records.length) badges.push({ text: plural(lang, d.records.length, ["dungeon record", "dungeon records"], ["record de donjon", "records de donjon"]), tone: "ok" });
  if (d.firsts.length) badges.push({ text: plural(lang, d.firsts.length, ["first clear", "first clears"], ["première complétion", "premières complétions"]), tone: "ok" });
  return {
    eyebrow: t("Guilded · Weekly report", "Guilded · Bilan hebdo"), title: t("The guild's week", "La semaine de la guilde"),
    subtitle: `${day(report.weekStart)} → ${day(report.weekEnd)}`,
    backdrop: { kind: "board", key: "weekly", fallbackKey: "activity" },
    stats: [
      { label: t("Raids", "Raids"), value: String(report.guild.raids), accent: "gold", note: `${delta(report.guild.raids, report.previous.raids, fr)}${report.guild.raids ? ` · ${report.guild.averageRaiders}${fr ? " raiders/raid" : " raiders/raid"}` : ""}` },
      { label: t("Boss kills", "Boss vaincus"), value: String(report.guild.bossKills), note: delta(report.guild.bossKills, report.previous.bossKills, fr) },
      { label: t("Dungeon clears", "Donjons terminés"), value: String(d.completed), accent: "green", note: d.runs > d.completed ? t(`${d.runs} runs`, `${d.runs} parcours`) : undefined }
    ],
    rowsLabel: t("Players of the week", "Joueurs de la semaine"), rows,
    ...(badges.length ? { badges } : {}),
    footer: t("Weekly report · Counts from the guild's own records · No points · guildedwow.com", "Bilan hebdo · Chiffres tirés des données de la guilde · Aucun point · guildedwow.com")
  };
}
