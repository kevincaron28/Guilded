import { EmbedBuilder, escapeMarkdown } from "discord.js";
import { t, type Lang } from "../i18n.js";
import { achievementName } from "./dungeon-achievements.js";
import type { DungeonImportSummary } from "./dungeon-import.js";
import { formatDuration } from "./dungeon-rules.js";
import { difficultyName } from "./dungeon-stats.js";

const MAX_RUNS = 12;

// One post per import (roadmap D6): the completed runs, then the records
// they set. Abandoned and rejected runs stay out of the channel (officers
// see them in the /import apply reply). Null when there is nothing to show.
export function dungeonAnnouncement(summary: DungeonImportSummary, lang: Lang): EmbedBuilder | null {
  const done = summary.results.filter((run) => run.valid && run.state === "COMPLETED" && run.durationSec !== null);
  if (done.length === 0) return null;
  const label = (run: { runRef: string; dungeonName: string; difficultyId: number }) => {
    const difficulty = difficultyName(run.difficultyId);
    const test = run.runRef.startsWith("SIM-") ? "[TEST] " : "";
    return difficulty ? `${test}${run.dungeonName} (${difficulty})` : `${test}${run.dungeonName}`;
  };
  const lines = done.slice(0, MAX_RUNS).map((run) => {
    const fr = lang === "fr";
    const details = run.playerDetails;
    const tracked = details?.filter((player) => player.deaths !== null).length;
    const partial = tracked !== undefined && tracked < run.players.length;
    const deaths = run.deaths === null ? "" : ` · ${partial
      ? `${run.deaths} ${fr ? "mort(s) connue(s)" : "recorded death(s)"} (${tracked}/${run.players.length} ${fr ? "suivis" : "tracked"})`
      : run.deaths === 0 ? t(lang, "dungeon.post.flawless") : t(lang, "dungeon.deaths", { count: run.deaths })}`;
    const lines = [`✅ **${escapeMarkdown(label(run))}** ${formatDuration(run.durationSec as number)}${deaths}`];
    if (run.endedAt) lines.push(`${fr ? "Terminé" : "Finished"} <t:${run.endedAt}:f> · ${run.completedBy === "manual"
      ? (fr ? "fin manuelle" : "manually completed") : run.completedBy === "final boss"
        ? (fr ? "boss final vaincu" : "final boss defeated") : (fr ? "donjon terminé" : "completed")}`);
    lines.push(`${run.players.length === 1 ? (fr ? "Solo" : "Solo") : `${run.players.length} ${fr ? "participants (remplacements inclus)" : "participants (including replacements)"}`} · ${run.points} ${fr ? "points attribués au total" : "total points awarded"}`);
    if (details) {
      const roles: Record<string, string> = { TANK: "Tank", HEALER: fr ? "Soigneur" : "Healer", DPS: "DPS", DAMAGER: "DPS" };
      for (const player of details.slice(0, 8)) {
        const info = [player.class, player.role ? roles[player.role] ?? player.role : undefined].filter(Boolean).join(" / ");
        const deathText = player.deaths === null ? (fr ? "morts non suivies" : "deaths untracked") : t(lang, "dungeon.deaths", { count: player.deaths });
        lines.push(`• **${escapeMarkdown(player.character)}**${info ? ` — ${escapeMarkdown(info)}` : ""} · ${deathText} · ${player.points} pts`);
      }
      if (details.length > 8) lines.push(t(lang, "dungeon.post.more", { count: details.length - 8 }));
    } else lines.push(`  ${run.players.map((name) => escapeMarkdown(name)).join(", ")}`);
    return lines.join("\n");
  });
  if (done.length > MAX_RUNS) lines.push(t(lang, "dungeon.post.more", { count: done.length - MAX_RUNS }));

  const highlights: string[] = [];
  for (const run of done) {
    if (run.guildRecord && run.previousGuildBest !== null) {
      highlights.push(t(lang, "dungeon.post.guildRecord", {
        dungeon: label(run), before: formatDuration(run.previousGuildBest), now: formatDuration(run.durationSec as number)
      }));
    }
    if (run.personalRecords.length) {
      highlights.push(t(lang, "dungeon.post.personal", { dungeon: label(run), names: run.personalRecords.map((record) => record.character).join(", ") }));
    }
  }
  const embed = new EmbedBuilder().setColor(0xd4a017).setTitle(t(lang, "dungeon.post.title"))
    .setDescription(lines.join("\n").slice(0, 3500))
    .setFooter({ text: t(lang, "dungeon.post.footer") });
  if (highlights.length) embed.addFields({ name: t(lang, "dungeon.post.records"), value: highlights.join("\n").slice(0, 1024) });
  // One line per achievement: "🩸 First Blood: Kev, Bob".
  const earned = new Map<string, string[]>();
  for (const run of done) {
    for (const achievement of run.achievements) {
      const name = achievementName(achievement.key, lang);
      earned.set(name, [...(earned.get(name) ?? []), achievement.character]);
    }
  }
  if (earned.size) {
    embed.addFields({ name: t(lang, "dungeon.post.achievements"), value: [...earned].map(([name, who]) => `${name}: ${[...new Set(who)].join(", ")}`).join("\n").slice(0, 1024) });
  }
  return embed;
}
