import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, escapeMarkdown } from "discord.js";
import { t, type Lang } from "../i18n.js";
import { achievementName } from "./dungeon-achievements.js";
import { highlightHeadline, highlightText } from "./dungeon-records.js";
import type { DungeonImportResult, DungeonImportSummary } from "./dungeon-import.js";
import { formatDuration } from "./dungeon-rules.js";
import { dungeonTimeline } from "./dungeon-timeline.js";
import { unrankedLabel, dungeonRunCard, finalBoss, guildPlayers, partyOf, roleName, className, runLabel } from "./dungeon-card.js";
import type { ScoreCard } from "./score-card.js";
import { recordItems } from "./record-card.js";

/** Button on a run post: shows the boss chronology to whoever asks, privately. */
export const DUNGEON_TIMELINE_PREFIX = "dgtl:";

export { unrankedLabel };

export interface DungeonPost {
  runRef: string;
  embed: EmbedBuilder;
  /** The completion card, drawn on delivery; null only for a run with nothing to draw. */
  card: ScoreCard;
  /** 9.1: the lead line when the run set a guild record or completed a challenge (the post is the notification). */
  content?: string | undefined;
  /** Chronologie button, present only when the run holds a boss chronology and a stored id. */
  components: ActionRowBuilder<ButtonBuilder>[];
  /** 9.3: what is sent instead when the card is drawn: the lines the card cannot carry, or nothing but the picture and the button. */
  cardOnly: { content?: string | undefined; embed: EmbedBuilder };
}

const MAX_POSTS = 12;

/** Completed, valid runs with at least one guildmate. Abandoned and rejected runs stay out of the channel. */
function announced(summary: DungeonImportSummary): DungeonImportResult[] {
  return summary.results.filter((run) => run.valid && run.state === "COMPLETED" && run.durationSec !== null && guildPlayers(run).size > 0);
}

/**
 * One post per completed run (9.1): a rendered card and a short embed. The embed names the guildmates (tagged without a
 * ping), shows the points line only above zero, one "Non classé ×N" summary and any records or achievements; the boss
 * chronology sits behind a button instead of stacking under every run. Empty when nothing was completed in the guild.
 */
export function dungeonPosts(summary: DungeonImportSummary, lang: Lang, options: { deathPoints?: Record<string, { x: number; y: number }[]> } = {}): DungeonPost[] {
  return announced(summary).slice(0, MAX_POSTS).map((run) => ({
    runRef: run.runRef,
    ...(run.highlights?.length ? { content: highlightHeadline(run.highlights, runLabel(run), lang) } : {}),
    embed: dungeonEmbed(run, lang),
    cardOnly: dungeonCardOnly(run, lang),
    card: dungeonRunCard(run, lang, options.deathPoints?.[run.runRef] ? { deathPoints: options.deathPoints[run.runRef]! } : {}),
    components: timelineRow(run, lang)
  }));
}

/**
 * The run post when its card is drawn: the card already shows the time, final boss, deaths, score, party, roles and who is in
 * the guild (outsiders as dashed rows), and a guild record has its own card right after. What stays is what the card has no room
 * for: the "Unranked" line (the card names only the first reason, cut to 28 characters, and not how many members), the outsiders
 * when the party is too long for the card's rows, the points line, boss records and challenges, personal records and
 * achievements (and a guild record line when records are switched off, so no record card follows). Member tags are not
 * kept: they never pinged. Pure.
 */
export function dungeonCardOnly(run: DungeonImportResult, lang: Lang): { content?: string | undefined; embed: EmbedBuilder } {
  const fr = lang === "fr", members = guildPlayers(run), lines: string[] = [];
  const recordCardFollows = recordItems(run.highlights).length > 0;
  if (run.points > 0) lines.push(`${run.points} ${run.ratingEnabled ? (fr ? "points de participation" : "participation points") : (fr ? "points attribués au total" : "total points awarded")}`);
  // Why a run is unranked: the card shows one reason, truncated; the post keeps every distinct reason and the count.
  const unranked = (run.playerDetails ?? []).filter((player) => members.has(player.character) && player.unrankedReason);
  if (unranked.length) {
    const reasons = [...new Set(unranked.map((player) => unrankedLabel(player.unrankedReason!, lang)))];
    lines.push(`${fr ? "Non classé" : "Unranked"} ×${unranked.length}: ${reasons.slice(0, 2).map((reason) => escapeMarkdown(reason)).join(" · ")}${reasons.length > 2 ? " …" : ""}`);
  }
  // The card has six party rows (five with a death map); a longer party hides outsiders behind "+N more".
  const party = partyOf(run), outsiders = party.filter((row) => !row.guild);
  if (outsiders.length && party.length > 5) {
    const shown = outsiders.slice(0, 8).map((row) => {
      const info = [className(row.detail.class, lang), roleName(row.detail.role, lang)].filter(Boolean).join(", ");
      const who = row.detail.character === "Unknown" ? (fr ? "Inconnu" : "Unknown") : escapeMarkdown(run.fullNames?.[row.detail.character] ?? row.detail.character);
      return `${who}${info ? ` (${escapeMarkdown(info)})` : ""}`;
    });
    lines.push(`🌐 ${fr ? "Hors guilde" : "Outside the guild"} (${outsiders.length})${fr ? " :" : ":"} ${shown.join(", ")}${outsiders.length > 8 ? ` ${t(lang, "dungeon.post.more", { count: outsiders.length - 8 })}` : ""}`);
  }
  const others = (run.highlights ?? []).filter(item => item.kind !== "clear" && item.kind !== "first");
  for (const item of others.slice(0, 6)) lines.push(highlightText(item, lang));
  if (!recordCardFollows && run.guildRecord && run.previousGuildBest !== null) {
    lines.push(t(lang, "dungeon.post.guildRecord", { dungeon: runLabel(run), before: formatDuration(run.previousGuildBest), now: formatDuration(run.durationSec as number) }));
  }
  const personal = run.personalRecords.filter((record) => members.has(record.character));
  if (personal.length) lines.push(t(lang, "dungeon.post.personal", { dungeon: runLabel(run), names: personal.map((record) => run.fullNames?.[record.character] ?? record.character).join(", ") }));
  const earned = new Map<string, string[]>();
  for (const achievement of run.achievements) {
    if (!members.has(achievement.character)) continue;
    const label = achievementName(achievement.key, lang);
    earned.set(label, [...(earned.get(label) ?? []), run.fullNames?.[achievement.character] ?? achievement.character]);
  }
  for (const [label, who] of earned) lines.push(`🎖️ ${label}: ${[...new Set(who)].join(", ")}`);
  const embed = new EmbedBuilder().setColor(0xd4a017);
  if (lines.length) embed.setDescription(lines.join("\n").slice(0, 3500));
  const headline = others.length ? highlightHeadline(others, runLabel(run), lang) : undefined;
  return { ...(headline ? { content: headline } : {}), embed };
}

function timelineRow(run: DungeonImportResult, lang: Lang): ActionRowBuilder<ButtonBuilder>[] {
  if (!run.runId || !dungeonTimeline(run, lang)) return [];
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setCustomId(`${DUNGEON_TIMELINE_PREFIX}${run.runId}`)
    .setLabel(lang === "fr" ? "Chronologie" : "Timeline").setEmoji("⏱️").setStyle(ButtonStyle.Secondary))];
}

function dungeonEmbed(run: DungeonImportResult, lang: Lang): EmbedBuilder {
  const fr = lang === "fr";
  const members = guildPlayers(run);
  const party = partyOf(run);
  const name = (character: string) => escapeMarkdown(run.fullNames?.[character] ?? character);
  const lines: string[] = [];

  const boss = finalBoss(run);
  const memberDeaths = party.filter((row) => row.guild).reduce((sum, row) => sum + (row.detail.deaths ?? 0), 0);
  const tracked = party.filter((row) => row.guild && row.detail.deaths !== null && row.detail.deaths !== undefined).length;
  lines.push([`⏱️ **${formatDuration(run.durationSec as number)}**`, boss ? `${fr ? "boss final" : "final boss"} **${escapeMarkdown(boss)}**` : undefined,
    tracked ? `${fr ? "morts de guilde" : "guild deaths"} ${memberDeaths}` : undefined].filter(Boolean).join(" · "));

  // Guildmates: their full character name, with the member tagged after it when linked (no ping, the delivery allows
  // no mentions). Never the mention alone: the post should say which character ran.
  const guildRows = party.filter((row) => row.guild);
  const tagged = guildRows.map((row) => { const mention = run.mentions?.[row.detail.character]; return `**${name(row.detail.character)}**${mention ? ` (<@${mention}>)` : ""}`; });
  const linked = guildRows.filter((row) => run.mentions?.[row.detail.character] || !run.unlinked.includes(row.detail.character)).length;
  const linkedNote = linked > 0 && linked < members.size ? ` (${linked} ${fr ? (linked > 1 ? "liés" : "lié") : "linked"})` : "";
  const memberWord = fr ? (members.size > 1 ? "membres de la guilde" : "membre de la guilde") : (members.size > 1 ? "guild members" : "guild member");
  lines.push(`🏰 ${members.size} ${memberWord}${linkedNote}${fr ? " :" : ":"} ${tagged.join(", ")}`);
  if (run.points > 0) lines.push(`${run.points} ${run.ratingEnabled ? (fr ? "points de participation" : "participation points") : (fr ? "points attribués au total" : "total points awarded")}`);

  // One "Non classé ×N" for the whole run, with the distinct reasons: never one line per member.
  const unranked = (run.playerDetails ?? []).filter((player) => members.has(player.character) && player.unrankedReason);
  if (unranked.length) {
    const reasons = [...new Set(unranked.map((player) => unrankedLabel(player.unrankedReason!, lang)))];
    lines.push(`${fr ? "Non classé" : "Unranked"} ×${unranked.length}: ${reasons.slice(0, 2).map((reason) => escapeMarkdown(reason)).join(" · ")}${reasons.length > 2 ? " …" : ""}`);
  }
  // People from outside the guild, with localized roles (never the raw HEALER/TANK).
  const outsiders = party.filter((row) => !row.guild);
  if (outsiders.length) {
    const shown = outsiders.slice(0, 8).map((row) => {
      const info = [className(row.detail.class, lang), roleName(row.detail.role, lang)].filter(Boolean).join(", ");
      // The addon sends "Unknown" when the game had not loaded a player's name yet.
      const who = row.detail.character === "Unknown" ? (fr ? "Inconnu" : "Unknown") : name(row.detail.character);
      return `${who}${info ? ` (${escapeMarkdown(info)})` : ""}`;
    });
    lines.push(`🌐 ${fr ? "Hors guilde" : "Outside the guild"} (${outsiders.length})${fr ? " :" : ":"} ${shown.join(", ")}${outsiders.length > 8 ? ` ${t(lang, "dungeon.post.more", { count: outsiders.length - 8 })}` : ""}`);
  }
  // 9.1 records and challenges: the clear record keeps its own line below; boss records and challenges are listed here.
  for (const item of (run.highlights ?? []).filter(item => item.kind !== "clear").slice(0, 6)) lines.push(highlightText(item, lang));
  if (run.guildRecord && run.previousGuildBest !== null) {
    lines.push(t(lang, "dungeon.post.guildRecord", { dungeon: runLabel(run), before: formatDuration(run.previousGuildBest), now: formatDuration(run.durationSec as number) }));
  }
  const personal = run.personalRecords.filter((record) => members.has(record.character));
  if (personal.length) lines.push(t(lang, "dungeon.post.personal", { dungeon: runLabel(run), names: personal.map((record) => run.fullNames?.[record.character] ?? record.character).join(", ") }));
  const earned = new Map<string, string[]>();
  for (const achievement of run.achievements) {
    if (!members.has(achievement.character)) continue;
    const label = achievementName(achievement.key, lang);
    earned.set(label, [...(earned.get(label) ?? []), run.fullNames?.[achievement.character] ?? achievement.character]);
  }
  for (const [label, who] of earned) lines.push(`🎖️ ${label}: ${[...new Set(who)].join(", ")}`);

  return new EmbedBuilder().setColor(0xd4a017).setTitle(`✅ ${runLabel(run)}`.slice(0, 256))
    .setDescription(lines.join("\n").slice(0, 3500)).setFooter({ text: t(lang, "dungeon.post.footer") });
}
