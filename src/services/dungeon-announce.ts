import { EmbedBuilder, escapeMarkdown } from "discord.js";
import { t, type Lang } from "../i18n.js";
import { achievementName } from "./dungeon-achievements.js";
import type { DungeonImportSummary } from "./dungeon-import.js";
import { formatDuration } from "./dungeon-rules.js";
import { difficultyName } from "./dungeon-stats.js";
import { canonicalClass, type ClassEmojis } from "./character-display.js";
import { canonicalSpecialization } from "../wow-specializations.js";
import { CLASS_NAMES_FR } from "../permissions.js";
import { dungeonTimeline } from "./dungeon-timeline.js";

const MAX_RUNS = 12;

// The importer resolves characters against this guild's linked roster. Do not
// infer membership from points (a guild member can legitimately earn zero).
function guildPlayers(run: DungeonImportSummary["results"][number]): Set<string> {
  return new Set(run.players.filter((name) => !run.unlinked.includes(name)));
}

// One post per import (roadmap D6): the completed runs, then the records
// they set. Abandoned and rejected runs stay out of the channel (officers
// see them in the /import apply reply). Null when there is nothing to show.
export function dungeonAnnouncement(summary: DungeonImportSummary, lang: Lang, emojis: ClassEmojis = {}): EmbedBuilder | null {
  const done = summary.results.filter((run) => run.valid && run.state === "COMPLETED" && run.durationSec !== null && guildPlayers(run).size > 0);
  if (done.length === 0) return null;
  const label = (run: { runRef: string; dungeonName: string; difficultyId: number }) => {
    const difficulty = difficultyName(run.difficultyId);
    const test = run.runRef.startsWith("SIM-") ? "[TEST] " : "";
    return difficulty ? `${test}${run.dungeonName} (${difficulty})` : `${test}${run.dungeonName}`;
  };
  const lines = done.slice(0, MAX_RUNS).map((run) => {
    const fr = lang === "fr";
    const members = guildPlayers(run);
    const details = run.playerDetails?.filter((player) => members.has(player.character));
    const tracked = details?.filter((player) => player.deaths !== null).length;
    const partial = tracked !== undefined && tracked < members.size;
    const memberDeaths = details ? (tracked ? details.reduce((sum, player) => sum + (player.deaths ?? 0), 0) : null)
      : run.unlinked.length === 0 ? run.deaths : null;
    const deaths = memberDeaths === null ? "" : ` · ${fr ? "morts de guilde" : "guild deaths"}: ${memberDeaths}${partial
      ? ` (${tracked}/${members.size} ${fr ? "suivis" : "tracked"})` : ""}`;
    const lines = [`✅ **${escapeMarkdown(label(run))}** ${formatDuration(run.durationSec as number)}${deaths}`];
    if (run.endedAt) lines.push(`${fr ? "Terminé" : "Finished"} <t:${run.endedAt}:f> · ${run.completedBy === "manual"
      ? (fr ? "fin manuelle" : "manually completed") : run.completedBy === "final boss"
        ? (fr ? "boss final vaincu" : "final boss defeated") : (fr ? "donjon terminé" : "completed")}`);
    lines.push(`${members.size} ${fr ? "membre(s) de guilde" : "guild member(s)"} · ${run.points} ${fr ? "points attribués au total" : "total points awarded"}`);
    if (details) {
      const roles: Record<string, string> = { TANK: "Tank", HEALER: fr ? "Soigneur" : "Healer", DPS: "DPS", DAMAGER: "DPS" };
      for (const player of details.slice(0, 8)) {
        const className = canonicalClass(player.class);
        const spec = canonicalSpecialization(className, player.spec);
        const role = player.role === "DAMAGER" ? "DPS" : player.role;
        const roleIcon = role === "TANK" ? emojis["ROLE:TANK"] ?? "🛡️" : role === "HEALER" ? emojis["ROLE:HEALER"] ?? "💚" : role === "DPS" ? emojis["ROLE:DPS"] ?? "⚔️" : "";
        const icons = [className && emojis[className], spec && emojis[spec.key], roleIcon].filter(Boolean).join(" ");
        const info = [className ? (fr ? CLASS_NAMES_FR[className] ?? className : className) : player.class,
          spec ? (fr ? spec.french : spec.name) + (player.specSource === "profile" ? "*" : "") : undefined,
          role ? roles[role] : undefined].filter(Boolean).join(" / ");
        const deathText = player.deaths === null ? (fr ? "morts non suivies" : "deaths untracked") : t(lang, "dungeon.deaths", { count: player.deaths });
        lines.push(`${icons || "•"} **${escapeMarkdown(player.character)}**${info ? ` — ${escapeMarkdown(info)}` : ""}\n  ${deathText} · **${player.points} pts**`);
      }
      if (details.length > 8) lines.push(t(lang, "dungeon.post.more", { count: details.length - 8 }));
      if (details.some(player => player.specSource === "profile")) lines.push(fr ? "* Spé du profil lié; non relevée pendant ce donjon." : "* Spec from linked profile; not captured during this run.");
    } else lines.push(`  ${[...members].map((name) => escapeMarkdown(name)).join(", ")}`);
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
    const personalRecords = run.personalRecords.filter((record) => guildPlayers(run).has(record.character));
    if (personalRecords.length) {
      highlights.push(t(lang, "dungeon.post.personal", { dungeon: label(run), names: personalRecords.map((record) => record.character).join(", ") }));
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
      if (!guildPlayers(run).has(achievement.character)) continue;
      const name = achievementName(achievement.key, lang);
      earned.set(name, [...(earned.get(name) ?? []), achievement.character]);
    }
  }
  if (earned.size) {
    embed.addFields({ name: t(lang, "dungeon.post.achievements"), value: [...earned].map(([name, who]) => `${name}: ${[...new Set(who)].join(", ")}`).join("\n").slice(0, 1024) });
  }
  // Keep the full embed under Discord's 6,000-character limit, even for batches.
  for (const run of done.slice(0, 3)) {
    const timeline = dungeonTimeline(run, lang);
    const name = `⏱️ ${lang === "fr" ? "Chronologie" : "Timeline"} · ${label(run)}`.slice(0, 256);
    if (timeline && embed.length + name.length + timeline.length <= 5900) embed.addFields({ name, value: timeline });
  }
  return embed;
}
