import { EmbedBuilder } from "discord.js";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import type { Lang } from "../i18n.js";
import { textlessEmbed } from "./card-only.js";
import { frozenRating, hasDungeonRating } from "./dungeon-rating.js";
import { classOf, type ClassBook } from "./ladder-classes.js";
import { classColor, type ScoreCard } from "./score-card.js";
import { finalRows } from "./season-snapshot.js";

// Season cards (9.3): a podium card for a season that ENDED (only once its final results are stored: a season in its upload grace has none yet)
// and a card for the one that begins (name and dates). Posted in the dungeon leaderboard channel by a MESSAGE job on the
// "seasonCard" route. New message, so ON by default with an officer off switch (ROADMAP rule 5): GuildSettings.seasonCardsEnabled,
// /bg season-cards. Switch and channel are re-checked
// at delivery, only for these jobs (key season-card:). Nothing is awarded.

const COLOR = 0xd4a017;
export interface SeasonInfo { name: string; startsAt: Date; endsAt: Date | null }
const day = (date: Date) => date.toISOString().slice(0, 10);
const MEDALS = ["🥇", "🥈", "🥉"];

/** One podium entry: competition rank (equal scores share a place), the player, the score, and a bracket label when the season has brackets. */
export interface PodiumEntry { rank: number; name: string; points: number; label?: string | undefined }
export interface Podium { entries: PodiumEntry[]; ranked: number; /** Champions beyond the rows the card can show. */ moreChampions: number }

const MAX_ROWS = 5;
/**
 * Pure: the podium of an ended season from the SAME source the leaderboard uses: the frozen rating for a rated season (unlinked `char:` rows
 * skipped), the final standings otherwise. A season with several brackets shows each bracket's champion(s), one row each, labelled with
 * the bracket; otherwise the top three places. Equal scores share a place and every champion on the top score is named.
 */
export function seasonPodium(season: { ratingRules?: unknown; finalRating?: unknown; finalStandings?: unknown }): Podium | null {
  const rated = hasDungeonRating(season.ratingRules);
  const source: { memberId: string; name: string; points: number; bracket?: string | undefined }[] | null = rated ? frozenRating(season.finalRating) : finalRows(season.finalStandings);
  if (!source) return null;
  const rows = source.filter(row => !row.memberId.startsWith("char:") && row.points > 0);
  const brackets = [...new Set(rows.map(row => row.bracket).filter((value): value is string => Boolean(value)))].sort();
  const champions = (list: typeof rows) => { const top = Math.max(...list.map(row => row.points)); return list.filter(row => row.points === top); };
  let entries: PodiumEntry[] = [], moreChampions = 0;
  if (brackets.length > 1) {
    for (const bracket of brackets) for (const row of champions(rows.filter(r => r.bracket === bracket))) entries.push({ rank: 1, name: row.name, points: row.points, label: bracket });
  } else if (rows.length) {
    const sorted = [...rows].sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
    entries = sorted.map(row => ({ rank: 1 + sorted.filter(other => other.points > row.points).length, name: row.name, points: row.points })).filter(entry => entry.rank <= 3);
  }
  if (entries.length > MAX_ROWS) { moreChampions = entries.length - MAX_ROWS; entries = entries.slice(0, MAX_ROWS); }
  return { entries, ranked: rows.length, moreChampions };
}

/** Pure: the podium card of a season that ended. Without a podium it says so in words. */
export function seasonEndCard(season: SeasonInfo, podium: Podium | null, lang: Lang, classes: ClassBook): ScoreCard {
  const fr = lang === "fr", t = (en: string, french: string) => fr ? french : en;
  const entries = podium?.entries ?? [];
  const champions = entries.filter(entry => entry.rank === 1 && !entry.label);
  const place = (entry: PodiumEntry) => entry.label ? `${MEDALS[0]} ${t("Champion", "Champion")} · ${entry.label}` : `${MEDALS[entry.rank - 1]} ${entry.rank === 1 ? t("Champion", "Champion") : t(`Place ${entry.rank}`, `${entry.rank}e place`)}`;
  return {
    eyebrow: t("Guilded · Dungeons", "Guilded · Donjons"), title: t(`${season.name} is over`, `${season.name} est terminée`),
    subtitle: `${day(season.startsAt)} → ${season.endsAt ? day(season.endsAt) : "—"}`,
    backdrop: { kind: "board", key: "season-podium", fallbackKey: "dungeon-season" },
    stats: [
      { label: champions.length > 1 ? t("Champions", "Champions") : t("Champion", "Champion"), value: entries.length ? (champions.length > 1 ? String(champions.length + (podium?.moreChampions ?? 0)) : (champions[0] ?? entries[0]!).name) : "—", accent: "gold" },
      { label: t("Ranked players", "Joueurs classés"), value: String(podium?.ranked ?? 0) },
      ...(entries.length ? [{ label: t("Top score", "Meilleur score"), value: String(Math.max(...entries.map(entry => entry.points))), accent: "green" as const }] : [])
    ],
    rowsLabel: t("Podium", "Podium"),
    rows: entries.length ? entries.map(entry => ({ name: entry.name, color: classColor(classOf(classes, entry.name)), sub: place(entry), right: `${entry.points} pts`, rightTone: entry.rank === 1 ? "gold" as const : undefined }))
      : [{ name: t("No ranked player this season", "Aucun joueur classé cette saison"), sub: t("No dungeon points were recorded", "Aucun point de donjon enregistré") }],
    ...(podium?.moreChampions ? { badges: [{ text: t(`and ${podium.moreChampions} more champion(s)`, `et ${podium.moreChampions} autre(s) champion(s)`), tone: "muted" as const }] } : {}),
    footer: t("Season results · Final standings as published · No rewards · guildedwow.com", "Résultats de saison · Classement final publié · Aucune récompense · guildedwow.com")
  };
}

/** Pure: the card of the season that begins. */
export function seasonStartCard(season: SeasonInfo, lang: Lang): ScoreCard {
  const fr = lang === "fr", t = (en: string, french: string) => fr ? french : en;
  return {
    eyebrow: t("Guilded · Dungeons", "Guilded · Donjons"), title: t(`${season.name} begins`, `${season.name} commence`),
    subtitle: season.endsAt ? `${day(season.startsAt)} → ${day(season.endsAt)}` : t(`From ${day(season.startsAt)}`, `Dès le ${day(season.startsAt)}`),
    backdrop: { kind: "board", key: "dungeon-season" },
    stats: [
      { label: t("Starts", "Début"), value: day(season.startsAt), accent: "gold" },
      { label: t("Ends", "Fin"), value: season.endsAt ? day(season.endsAt) : t("Open", "Ouverte") }
    ],
    rowsLabel: t("How it works", "Comment ça marche"),
    rows: [
      { name: t("Run dungeons with the addon", "Faites des donjons avec l'addon"), sub: t("Valid runs count towards your season score", "Les parcours valides comptent pour votre score de saison") },
      { name: t("Follow the board", "Suivez le classement"), sub: t("The top 3 are announced when the season ends", "Le top 3 est annoncé à la fin de la saison") }
    ],
    footer: t("New season · Rules are shared by all guilds · No rewards · guildedwow.com", "Nouvelle saison · Règles communes à toutes les guildes · Aucune récompense · guildedwow.com")
  };
}

export function seasonEndFallback(season: SeasonInfo, podium: Podium | null, lang: Lang): EmbedBuilder {
  const fr = lang === "fr", entries = podium?.entries ?? [];
  return new EmbedBuilder().setColor(COLOR).setTitle(fr ? `🏁 ${season.name} est terminée` : `🏁 ${season.name} is over`)
    .setDescription(entries.length ? entries.map(entry => `${MEDALS[entry.rank - 1]} ${entry.name}${entry.label ? ` (${entry.label})` : ""} — ${entry.points} pts`).join("\n") + (podium?.moreChampions ? `\n+${podium.moreChampions}` : "") : fr ? "Aucun joueur classé cette saison." : "No ranked player this season.");
}
export function seasonStartFallback(season: SeasonInfo, lang: Lang): EmbedBuilder {
  const fr = lang === "fr";
  return new EmbedBuilder().setColor(COLOR).setTitle(fr ? `🚀 ${season.name} commence` : `🚀 ${season.name} begins`)
    .setDescription(season.endsAt ? `${day(season.startsAt)} → ${day(season.endsAt)}` : (fr ? `Dès le ${day(season.startsAt)}` : `From ${day(season.startsAt)}`));
}

type Database = Pick<PrismaClient, "discordJob" | "dungeonSeason" | "guildSettings">;
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
const RECENT_MS = 14 * 86_400_000;

async function enabledChannel(database: Database, guildId: string): Promise<boolean> {
  const settings = await database.guildSettings.findUnique({ where: { guildId }, select: { seasonCardsEnabled: true, dungeonLeaderboardChannelId: true } });
  return Boolean(settings?.seasonCardsEnabled && settings.dungeonLeaderboardChannelId);
}
async function put(database: Database, guildId: string, key: string, card: ScoreCard, fallback: EmbedBuilder): Promise<number> {
  if (await database.discordJob.findUnique({ where: { guildId_key: { guildId, key } } })) return 0;
  await database.discordJob.create({ data: { guildId, key, kind: "MESSAGE", payload: json({ route: "seasonCard", retryCard: true, message: { embeds: [fallback.toJSON()] }, card, cardOnly: { embeds: [textlessEmbed(COLOR)] } }) } });
  return 1;
}

/**
 * Queues the podium card of every season of this guild that ENDED in the last two weeks WITH its final results stored. A season still in its
 * upload grace (CLOSING, no results yet) is skipped and picked up by the call that follows its finalization. One job per season, ever.
 */
export async function queueSeasonEndCards(database: Database, guildId: string, lang: Lang, classes: ClassBook, now = new Date()): Promise<number> {
  if (!await enabledChannel(database, guildId)) return 0;
  const seasons = await database.dungeonSeason.findMany({ where: { guildId, status: "ENDED", endsAt: { gte: new Date(now.getTime() - RECENT_MS) } }, orderBy: { endsAt: "desc" }, take: 3 });
  let queued = 0;
  for (const season of seasons) {
    const podium = seasonPodium(season);
    // No stored results at all (neither rating nor standings): not final yet, so no card and no job.
    if (!podium) continue;
    const info = { name: season.name, startsAt: season.startsAt, endsAt: season.endsAt };
    queued += await put(database, guildId, `season-card:end:${season.id}`, seasonEndCard(info, podium, lang, classes), seasonEndFallback(info, podium, lang));
  }
  return queued;
}

/** Queues the card of the season that is active now (once per season). */
export async function queueSeasonStartCard(database: Database, guildId: string, lang: Lang): Promise<number> {
  if (!await enabledChannel(database, guildId)) return 0;
  const active = await database.dungeonSeason.findFirst({ where: { guildId, status: "ACTIVE" }, orderBy: { startsAt: "desc" } });
  if (!active) return 0;
  const info = { name: active.name, startsAt: active.startsAt, endsAt: active.endsAt };
  return put(database, guildId, `season-card:start:${active.id}`, seasonStartCard(info, lang), seasonStartFallback(info, lang));
}

/** Delivery re-check for a season card job: switch and channel now (never for another job on any route). */
export const seasonCardChannel = (key: string, settings: { seasonCardsEnabled: boolean; dungeonLeaderboardChannelId: string | null } | null): string | null | undefined =>
  key.startsWith("season-card:") ? (settings?.seasonCardsEnabled ? settings.dungeonLeaderboardChannelId : null) : undefined;
