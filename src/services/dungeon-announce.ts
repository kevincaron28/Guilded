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
import { challengeClock } from "./challenge-leaderboard.js";

const MAX_RUNS = 12;

function unrankedLabel(reason: string, lang: Lang): string {
  if (lang !== "fr") return reason;
  const labels: Record<string, string> = {
    "Outside season window": "Hors de la période de saison", "Simulation run": "Simulation",
    "Automatic final-boss completion required": "Victoire automatique sur le boss final requise",
    "Dungeon route unknown": "Parcours inconnu", "Level range not configured": "Plage de niveaux non configurée",
    "Required encounter evidence missing": "Preuves de boss requis manquantes", "Participation-only route": "Parcours de participation seulement",
    "Different difficulty": "Difficulté différente", "Party levels unknown": "Niveaux du groupe inconnus",
    "Overlevel carry": "Aide au-dessus du niveau maximal", "Below level range": "Sous le niveau minimal",
    "Target not calibrated": "Cible non calibrée"
  };
  const presence = /^Presence (\d+)% \/ 80% required$/.exec(reason);
  return presence ? `Présence ${presence[1]} % / 80 % requis` : labels[reason] ?? reason;
}

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
    if (run.challenge) lines.push(`Mythic+ **+${run.challenge.level}** · ${challengeClock(run.challenge.durationMs)} · ${run.challenge.onTime
      ? fr ? "à temps" : "in time" : fr ? "hors délai" : "overtime"} · affixes ${run.challenge.affixIds.join(", ") || "—"}`);
    if (run.endedAt) lines.push(`${fr ? "Terminé" : "Finished"} <t:${run.endedAt}:f> · ${run.completedBy === "manual"
      ? (fr ? "fin manuelle" : "manually completed") : run.completedBy === "final boss"
        ? (fr ? "boss final vaincu" : "final boss defeated") : (fr ? "donjon terminé" : "completed")}`);
    lines.push(`${members.size} ${fr ? "membre(s) de guilde" : "guild member(s)"} · ${run.points} ${run.ratingEnabled ? (fr ? "points de participation" : "participation points") : (fr ? "points attribués au total" : "total points awarded")}`);
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
        if (player.participationMode === "helper") lines.push(fr ? "  Aide : points de complétion seulement." : "  Helper: completion points only.");
        if (player.participationRecipient) lines.push(fr ? `  Points du compte attribués via ${escapeMarkdown(player.participationRecipient)}.` : `  Account points awarded through ${escapeMarkdown(player.participationRecipient)}.`);
        if (player.participationMode === "none") lines.push(run.ratingVersion === 5
          ? fr ? "  Aucun point de participation : preuves de parcours, présence ou conditions d’entraide non remplies." : "  No participation points: route evidence, presence or helper requirements not met."
          : fr ? "  Aucun point de participation : présence insuffisante ou aide sans membre admissible." : "  No participation points: insufficient presence or no eligible member to help.");
        if (player.unrankedReason) lines.push(`  ${fr ? "Non classé" : "Unranked"}: ${escapeMarkdown(unrankedLabel(player.unrankedReason, lang))}`);
        else if (player.ratingTotal !== undefined) lines.push(`  🏅 ${(run.ratingVersion ?? 0) >= 3 ? (fr ? "Score de donjon" : "Dungeon Rating") : (fr ? "Exploration" : "Exploration rating")}: **${player.ratingTotal}** (+${player.ratingGain ?? 0})`);
      }
      if (details.length > 8) lines.push(t(lang, "dungeon.post.more", { count: details.length - 8 }));
      if (details.some(player => player.specSource === "profile")) lines.push(fr ? "* Spé du profil lié; non relevée pendant ce donjon." : "* Spec from linked profile; not captured during this run.");
    } else lines.push(`  ${[...members].map((name) => escapeMarkdown(name)).join(", ")}`);
    if ((run.ratingVersion ?? 0) >= 3) lines.push(fr ? "Score de vitesse : meilleure tentative par donjon, 200 à la cible. Sans cible : calibration." : "Dungeon-time rating: best run per dungeon, 200 at target. No target: calibrating.");
    if (run.ratingVersion === 4) lines.push(fr ? "Bêta niveau 30 : seuls les 8 meilleurs donjons/ailes distincts comptent; maximum 3 200. `/dungeon rules`"
      : "Level-30 beta: only your best 8 distinct dungeons/wings count; maximum 3,200. `/dungeon rules`");
    if (run.ratingVersion === 5) lines.push(fr ? "Niveau 60 : vos 8 meilleurs parcours vérifiés comptent; maximum 3 200. Participation par compte séparée. `/dungeon rules`"
      : "Level 60: your best 8 verified routes count; maximum 3,200. Account participation is separate. `/dungeon rules`");
    if (run.ratingEnabled && (run.ratingVersion ?? 0) < 3) lines.push(fr ? "100 par donjon distinct admissible; répétitions, alts et difficultés ne s’additionnent pas." : "100 per eligible distinct dungeon; repeats, alts and difficulties do not stack.");
    if (run.ratingSpeedBonus === 20) lines.push(fr ? "Jusqu’à +20 de vitesse par donjon, selon la cible figée de la saison. Seule la meilleure tentative compte."
      : "Up to +20 speed per dungeon against the season's fixed target. Only the best result counts.");
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
