import { EmbedBuilder } from "discord.js";
import type { ScoreCard } from "./score-card.js";
import { classColor } from "./score-card.js";
import type { StatSnapshot } from "./stat-snapshots.js";
import { localClassName } from "./character-display.js";

// /stats server: the latest snapshot as an embed, with the class counts drawn in the shared ladder layout
// (classes ranked by count, class-coloured bars) as the chart image.
export function serverStatsCard(rows: StatSnapshot[], guildName: string, lang: "en" | "fr"): ScoreCard | null {
  const last = rows[rows.length - 1];
  if (!last) return null;
  const t = (en: string, fr: string) => lang === "fr" ? fr : en;
  const classes = Object.entries(last.classCounts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 14);
  const max = Math.max(1, ...classes.map(([, n]) => n));
  const first = rows[0]!;
  const delta = last.discordMembers - first.discordMembers;
  return {
    eyebrow: t("Server statistics", "Statistiques du serveur"), title: guildName.slice(0, 30),
    subtitle: `${last.discordMembers} ${t("members", "membres")} · ${last.rosterSize} ${t("characters", "personnages")} · ${last.level60} ${t("at 60", "au 60")}`,
    stats: [],
    ladder: { columns: [{ label: "", width: 420, kind: "bar" }, { label: t("Characters", "Personnages"), width: 90, primary: true }],
      boards: [{ rows: classes.map(([name, n], index) => ({ rank: index + 1, name: localClassName(name, lang), color: classColor(name), values: ["", String(n)], bar: { value: n, max } })) }] },
    footer: `${last.day} UTC · ${rows.length > 1 ? `${delta >= 0 ? "+" : ""}${delta} ${t("members over", "membres sur")} ${rows.length} ${t("days", "jours")}` : t("first snapshot", "premier relevé")}`
  };
}

export function serverStatsEmbed(rows: StatSnapshot[], guildName: string, lang: "en" | "fr", webUrl?: string): EmbedBuilder | null {
  const last = rows[rows.length - 1];
  if (!last) return null;
  const t = (en: string, fr: string) => lang === "fr" ? fr : en;
  const week = rows.slice(-7);
  const sum = (pick: (row: StatSnapshot) => number) => week.reduce((total, row) => total + pick(row), 0);
  return new EmbedBuilder().setTitle(`${guildName} · ${t("server statistics", "statistiques du serveur")}`)
    .setDescription(t(`Snapshot of ${last.day} (UTC).`, `Relevé du ${last.day} (UTC).`) + (webUrl ? `\n${webUrl}` : ""))
    .addFields(
      { name: t("Members", "Membres"), value: `${last.discordMembers} Discord · ${last.linkedMembers} ${t("linked", "liés")} · ${last.activeMembers} ${t("active", "actifs")}`, inline: true },
      { name: t("Roster", "Effectif"), value: `${last.rosterSize} ${t("characters", "personnages")} · ${last.level60} ${t("at level 60", "au niveau 60")}`, inline: true },
      { name: t(`Last ${week.length} day(s)`, `${week.length} derniers jours`), value: `${sum(r => r.messages)} ${t("messages", "messages")} · ${Math.round(sum(r => r.voiceMinutes) / 60)} ${t("voice hours", "heures vocales")} · ${sum(r => r.raids)} raids · ${sum(r => r.dungeonRuns)} ${t("dungeon runs", "donjons")}` }
    );
}
