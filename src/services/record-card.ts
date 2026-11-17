import { EmbedBuilder, escapeMarkdown } from "discord.js";
import type { Lang } from "../i18n.js";
import type { DungeonArtTheme } from "./dungeon-art.js";
import type { DungeonImportResult } from "./dungeon-import.js";
import type { DungeonHighlightItem } from "./dungeon-records.js";
import { formatDuration } from "./dungeon-rules.js";
import { dungeonRunCard, dungeonTheme } from "./dungeon-card.js";
import type { DungeonCardMember, ScoreCard } from "./score-card.js";

// The "new guild record" card (owner, 7 November 2026: records were missable among the run cards in the completed-dungeons
// channel). A run that sets a guild record (or the first guild clear of a dungeon) gets this card as its own message right after
// the run's card: the dungeon's painted scene, a gold "NEW RECORD" ribbon, the new time large, the old time and the difference,
// the party with roles, and who held the record before. It follows the records rules (dungeon-records.ts) and the officer switch (dungeonHighlightsEnabled).

/** `previousSec` is absent for a first guild clear; equal to `newSec` for a tie. */
export interface RecordVisual { theme: DungeonArtTheme; ribbon: string; newSec: number; previousSec?: number | undefined; diffLabel: string; oldLabel: string;
  party: Pick<DungeonCardMember, "name" | "color" | "role" | "roleLabel" | "guild">[]; partyLabel: string; previousHolders: string[]; previousLabel: string }

/** Pure: "−4:03", "+0:12" or "=" for a tie (seconds, formatted like every run time). */
export function recordDiff(newSec: number, previousSec: number): string {
  const delta = previousSec - newSec;
  return delta === 0 ? "=" : `${delta > 0 ? "−" : "+"}${formatDuration(Math.abs(delta))}`;
}

/** The record items that earn a card: a new fastest clear, or the guild's first clear of a dungeon (its first record). */
export function recordItems(highlights: readonly DungeonHighlightItem[] | undefined): DungeonHighlightItem[] {
  const items = (highlights ?? []).filter(item => item.kind === "clear" || item.kind === "first");
  // A first clear of a route cannot also beat an earlier clear; keep the clear record when both somehow appear.
  return items.some(item => item.kind === "clear") ? items.filter(item => item.kind === "clear") : items.slice(0, 1);
}

/** Pure: the record card for one run and its record item. */
export function recordCard(run: DungeonImportResult, item: DungeonHighlightItem, lang: Lang, timeZone?: string): ScoreCard {
  const fr = lang === "fr", runCard = dungeonRunCard(run, lang, timeZone ? { timeZone } : {});
  const newSec = item.valueSec ?? run.durationSec ?? 0, previousSec = item.kind === "clear" ? item.previousSec : undefined;
  const tie = previousSec !== undefined && previousSec === newSec;
  const ribbon = item.kind === "first" ? (fr ? "Premier record de la guilde" : "First guild record")
    : tie ? (fr ? "Record de guilde égalé" : "Guild record tied") : (fr ? "Nouveau record de guilde" : "New guild record");
  const party = (runCard.dungeon?.party ?? []).slice(0, 5).map(member => ({ name: member.name, color: member.color, role: member.role, roleLabel: member.roleLabel, guild: member.guild }));
  return {
    eyebrow: fr ? "Guilded · Record de donjon" : "Guilded · Dungeon record", title: runCard.title, subtitle: runCard.subtitle,
    stats: [], footer: fr ? "Le chrono démarre au premier combat" : "Times start at the first pull",
    record: {
      theme: runCard.dungeon?.theme ?? dungeonTheme(run.dungeonName), ribbon, newSec, previousSec,
      diffLabel: previousSec === undefined ? (fr ? "Premier temps" : "First time") : recordDiff(newSec, previousSec),
      oldLabel: previousSec === undefined ? (fr ? "Aucun temps avant celui-ci" : "No time before this one") : `${fr ? "Ancien record" : "Previous record"} ${formatDuration(previousSec)}`,
      party, partyLabel: fr ? "Le groupe" : "The party",
      previousHolders: previousSec === undefined ? [] : (item.previousPlayers ?? []).slice(0, 5),
      previousLabel: fr ? "Détenu avant par :" : "Held before by:"
    }
  };
}

/** Pure: the record post's embed. The title carries the dungeon, the time and the difference; no one is pinged. */
export function recordEmbed(run: DungeonImportResult, item: DungeonHighlightItem, lang: Lang): EmbedBuilder {
  const fr = lang === "fr", card = recordCard(run, item, lang), visual = card.record!;
  const time = formatDuration(visual.newSec), diff = visual.previousSec === undefined ? "" : ` (${visual.diffLabel})`;
  const colon = fr ? " : " : ": ", where = `${card.title} ${time}`;
  const title = item.kind === "first" ? `🚩 ${fr ? "Premier record de guilde" : "First guild record"}${colon}${where}` : `🏆 ${visual.ribbon}${colon}${where}${diff}`;
  const lines = [`${fr ? "Le groupe" : "The party"}${colon}${visual.party.map(member => `**${escapeMarkdown(member.name)}**${member.roleLabel ? ` (${member.roleLabel})` : ""}`).join(", ")}`];
  if (visual.previousSec !== undefined) lines.push(`${visual.oldLabel}${visual.previousHolders.length ? ` · ${visual.previousLabel} ${visual.previousHolders.map(name => escapeMarkdown(name)).join(", ")}` : ""}`);
  return new EmbedBuilder().setColor(0xffd100).setTitle(title.slice(0, 256)).setDescription(lines.join("\n").slice(0, 2000));
}
