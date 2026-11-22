import type { Lang } from "../i18n.js";
import { cardDate, reportedFooter } from "./card-format.js";
import { plural } from "./card-plural.js";
import type { ScoreCard } from "./score-card.js";
import type { DungeonScene } from "./dungeon-art.js";
import type { WeeklyReport } from "./weekly-report.js";
import { dungeonShare } from "./community-ingame.js";
import { pvpSub } from "./world-pvp-sub.js";

// The weekly report card (9.3): the headline of the guild's week (raids, boss kills, dungeon clears against the week before) and
// the players of the week. It replaces the report's first embed; the cores and dungeon embeds stay as text under it, and the
// whole text report is the fallback when the picture cannot be drawn. Follows the existing weekly report switch.

/** "3 raids · 18 boss kills · 92 % present · 7 items (210 GP)": one raid core's week, in the card and in the text report. */
export function coreLine(core: WeeklyReport["cores"][number], lang: Lang): string {
  const fr = lang === "fr";
  return [plural(lang, core.raids, ["raid", "raids"], ["raid", "raids"]), plural(lang, core.bossKills, ["boss kill", "boss kills"], ["boss vaincu", "boss vaincus"]),
    ...(core.attendancePct === null ? [] : [`${core.attendancePct} % ${fr ? "présents" : "present"}`]),
    `${plural(lang, core.loot, ["item", "items"], ["objet", "objets"])} (${core.gp} GP)`].join(" · ");
}

const delta = (now: number, before: number, fr: boolean) => before === now ? (fr ? "comme la semaine passée" : "same as last week") : `${now > before ? "+" : "−"}${Math.abs(now - before)} ${fr ? "vs semaine passée" : "vs last week"}`;

export function weeklyReportCard(report: WeeklyReport, lang: Lang, timeZone?: string): ScoreCard {
  const day = (date: Date) => cardDate(date, lang, timeZone);
  const fr = lang === "fr", t = (en: string, french: string) => fr ? french : en;
  const d = report.dungeons;
  const rows: NonNullable<ScoreCard["rows"]> = [];
  if (report.raiderOfWeek) rows.push({ name: report.raiderOfWeek.name, sub: t("Raider of the week", "Raider de la semaine"), right: `${report.raiderOfWeek.ep} ${t("raid pts", "pts de raid")}`, rightTone: "gold" });
  if (report.dungeonHero) rows.push({ name: report.dungeonHero.name, sub: t("Dungeon hero", "Héros des donjons"), right: `${dungeonShare(report.dungeonHero.points)} pts`, rightTone: "green" });
  if (d.marathon) rows.push({ name: d.marathon.name, sub: t("Dungeon marathon", "Marathon de donjons"), right: `×${d.marathon.runs}`, rightTone: "green" });
  for (const core of report.cores.slice(0, Math.max(0, 6 - rows.length)))
    rows.push({ name: core.name, sub: coreLine(core, lang), right: core.attendancePct === null ? undefined : `${core.attendancePct} %` });
  // A quiet week (no raid, few names) would leave most of the card empty: the week before is the next useful fact.
  if (rows.length < 2 && (report.previous.raids > 0 || report.previous.bossKills > 0))
    rows.push({ name: t("Last week", "Semaine passée"), sub: `${plural(lang, report.previous.raids, ["raid", "raids"], ["raid", "raids"])} · ${plural(lang, report.previous.bossKills, ["boss kill", "boss kills"], ["victoire", "victoires"])}` });
  if (report.worldPvp) rows.push({ name: t("World PvP", "JcJ en monde ouvert"), sub: pvpSub(report.worldPvp, t), right: String(report.worldPvp.kills), rightTone: "red" });
  return {
    eyebrow: t("Guilded · Weekly report", "Guilded · Bilan hebdo"), title: t("The guild's week", "La semaine de la guilde"),
    subtitle: `${t("Week", "Semaine")} ${day(report.weekStart)} → ${day(report.weekEnd)}`,
    backdrop: { kind: "board", key: "weekly", fallbackKey: "activity" },
    stats: [
      { label: t("Raids", "Raids"), value: String(report.guild.raids), accent: "gold", note: `${delta(report.guild.raids, report.previous.raids, fr)}${report.guild.raids ? ` · ${report.guild.averageRaiders}${fr ? " raiders/raid" : " raiders/raid"}` : ""}` },
      { label: t("Boss kills", "Boss vaincus"), value: String(report.guild.bossKills), note: delta(report.guild.bossKills, report.previous.bossKills, fr) },
      { label: t("Dungeon clears", "Donjons terminés"), value: String(d.completed), accent: "green", note: d.runs > d.completed ? t(`${d.runs} runs`, `${d.runs} parcours`) : undefined }
    ],
    rowsLabel: t("Players of the week", "Joueurs de la semaine"), rows,
    footer: reportedFooter(lang)
  };
}

const clock = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
const SCENES: DungeonScene[] = ["stratholme", "scarlet", "blackrock", "forest", "dalaran", "wailing", "sunken", "shadowfang", "uldaman", "zulfarrak"];
const seedOf = (text: string) => { let h = 2166136261; for (const c of text) h = Math.imul(h ^ c.codePointAt(0)!, 16777619); return h >>> 0; };

/**
 * The second card of the weekly post (the dungeon week, 9.4): fastest clear per dungeon and the top dungeon points, in the recap layout.
 * Records and first clears are not here: they have one home, the weekly records post. Null when no dungeon run was recorded.
 */
export function weeklyDungeonCard(report: WeeklyReport, lang: Lang, guildName: string, timeZone?: string): ScoreCard | null {
  const d = report.dungeons;
  if (d.runs <= 0) return null;
  const fr = lang === "fr", t = (en: string, french: string) => fr ? french : en;
  const day = (date: Date) => cardDate(date, lang, timeZone);
  const seed = seedOf(report.weekEnd.toISOString());
  const sections: NonNullable<ScoreCard["recap"]>["sections"] = [];
  // The dungeon hero and the marathon already sit on the first card; this one adds the clear times and the runners-up.
  const fastestRows = d.fastest.map(row => ({ name: row.dungeon, sub: row.players.slice(0, 5).join(", "), right: clock(row.durationSec), rightTone: "gold" as const }));
  if (fastestRows.length) sections.push({ title: t("Fastest clear per dungeon", "Parcours le plus rapide par donjon"), rows: fastestRows.slice(0, 5) });
  if (fastestRows.length > 5) sections.push({ title: t("Fastest clear per dungeon", "Parcours le plus rapide par donjon"), rows: fastestRows.slice(5, 10) });
  if (d.topPoints.length > 1) sections.push({ title: t("Also on the dungeon board", "Aussi au classement des donjons"), rows: d.topPoints.slice(1).map(row => ({ name: row.name, right: `${dungeonShare(row.points)} pts`, rightTone: "green" as const })) });
  if (!sections.length) return null;
  return {
    eyebrow: t("Guilded · Dungeon week", "Guilded · Semaine des donjons"), title: guildName, subtitle: `${t("Week", "Semaine")} ${day(report.weekStart)} → ${day(report.weekEnd)}`,
    stats: [{ label: t("Dungeon clears", "Donjons terminés"), value: String(d.completed), accent: "green" }, ...(d.runs > d.completed ? [{ label: t("Runs recorded", "Parcours enregistrés"), value: String(d.runs) }] : [])],
    footer: reportedFooter(lang), moreLabel: t("more", "autres"),
    backdrop: { kind: "recap", key: ["dawn", "day", "night"][seed % 3]! },
    recap: { theme: { a: "#1e1236", b: "#6a4aa8", motif: "keep", seed, scene: SCENES[seed % SCENES.length]! }, sections: sections.slice(0, 3) }
  };
}
