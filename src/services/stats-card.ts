import { EmbedBuilder } from "discord.js";
import { cardDate } from "./card-format.js";
import { plural } from "./card-plural.js";
import type { ScoreCard } from "./score-card.js";
import { classColor } from "./score-card.js";
import type { StatSnapshot } from "./stat-snapshots.js";
import { localClassName } from "./character-display.js";

// /report stats server: the latest snapshot as an embed, with the class counts drawn in the shared ladder layout
// (classes ranked by count, class-coloured bars) as the chart image.
export function serverStatsCard(rows: StatSnapshot[], guildName: string, lang: "en" | "fr"): ScoreCard | null {
  const last = rows[rows.length - 1];
  if (!last) return null;
  const t = (en: string, fr: string) => lang === "fr" ? fr : en, n = (value: number) => value.toLocaleString(lang === "fr" ? "fr-CA" : "en-US");
  const classes = Object.entries(last.classCounts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 14);
  const max = Math.max(1, ...classes.map(([, n]) => n));
  const first = rows[0]!, delta = last.discordMembers - first.discordMembers;
  const week = rows.slice(-7), sum = (pick: (row: StatSnapshot) => number) => week.reduce((total, row) => total + pick(row), 0);
  const span = week.length === 1 ? t("1 day", "1 jour") : t(`${week.length} days`, `${week.length} jours`);
  // One compact card: the member count as the headline (with the change over the period), figures as tiles, classes as bars. No figure appears twice.
  return {
    eyebrow: t("Server statistics", "Statistiques du serveur"), title: guildName.slice(0, 30),
    subtitle: plural(lang, last.discordMembers, ["member", "members"], ["membre", "membres"]),
    badges: [{ text: rows.length > 1 ? `${delta >= 0 ? "+" : "−"}${Math.abs(delta)} ${t("over", "sur")} ${rows.length} ${t("days", "jours")}` : t("first snapshot", "premier relevé"), tone: "muted" }],
    rowsLabel: t("Activity and roster", "Activité et effectif"),
    stats: [
      { label: t("Linked", "Liés"), value: String(last.linkedMembers) },
      { label: t("Active", "Actifs"), value: String(last.activeMembers) },
      { label: t("Characters", "Personnages"), value: String(last.rosterSize) },
      { label: t("Level 60", "Niveau 60"), value: String(last.level60) },
      { label: t("Messages", "Messages"), value: n(sum(r => r.messages)), note: span },
      { label: t("Voice hours", "Heures vocales"), value: String(Math.round(sum(r => r.voiceMinutes) / 60)), note: span },
      { label: t("Dungeons", "Donjons"), value: String(sum(r => r.dungeonRuns)), note: span },
      { label: "Raids", value: String(sum(r => r.raids)), note: span }
    ],
    backdrop: { kind: "board", key: "server-stats", fallbackKey: "community" },
    ladder: { columns: [{ label: "", width: 420, kind: "bar" }, { label: t("Characters", "Personnages"), width: 90, primary: true }],
      boards: [{ title: t("Characters by class", "Personnages par classe"), rows: classes.map(([name, n], index) => ({ rank: index + 1, name: localClassName(name, lang), color: classColor(name), values: ["", String(n)], bar: { value: n, max } })) }] },
    footer: cardDate(new Date(`${last.day}T12:00:00Z`), lang, "UTC")
  };
}

export function serverStatsEmbed(rows: StatSnapshot[], guildName: string, lang: "en" | "fr", webUrl?: string): EmbedBuilder | null {
  const last = rows[rows.length - 1];
  if (!last) return null;
  const t = (en: string, fr: string) => lang === "fr" ? fr : en;
  const week = rows.slice(-7);
  const sum = (pick: (row: StatSnapshot) => number) => week.reduce((total, row) => total + pick(row), 0);
  return new EmbedBuilder().setTitle(`${guildName} · ${t("server statistics", "statistiques du serveur")}`)
    .setDescription(t(`Snapshot of ${cardDate(new Date(`${last.day}T12:00:00Z`), lang, "UTC")}.`, `Relevé du ${cardDate(new Date(`${last.day}T12:00:00Z`), lang, "UTC")}.`) + (webUrl ? `\n${webUrl}` : ""))
    .addFields(
      { name: t("Members", "Membres"), value: `${last.discordMembers} Discord · ${last.linkedMembers} ${t("linked", "liés")} · ${last.activeMembers} ${t("active", "actifs")}`, inline: true },
      { name: t("Roster", "Effectif"), value: `${last.rosterSize} ${t("characters", "personnages")} · ${last.level60} ${t("at level 60", "au niveau 60")}`, inline: true },
      { name: t(week.length === 1 ? "Last day" : `Last ${week.length} days`, week.length === 1 ? "Dernier jour" : `${week.length} derniers jours`), value: `${sum(r => r.messages)} ${t("messages", "messages")} · ${Math.round(sum(r => r.voiceMinutes) / 60)} ${t("voice hours", "heures vocales")} · ${sum(r => r.raids)} raids · ${sum(r => r.dungeonRuns)} ${t("dungeon runs", "donjons")}` }
    );
}
