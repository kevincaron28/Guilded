import { EmbedBuilder } from "discord.js";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import type { Lang } from "../i18n.js";
import { textlessEmbed } from "./card-only.js";
import type { LeaderRow } from "./dungeon-stats.js";
import { classOf, type ClassBook } from "./ladder-classes.js";
import { classColor, type ScoreCard } from "./score-card.js";
import { finalRows } from "./season-snapshot.js";

// Season cards (9.3): when the official dungeon season rotates, a podium card for the season that ended (top 3, class colours)
// and a card for the one that begins (name and dates). Posted in the dungeon leaderboard channel by a MESSAGE job on the
// "seasonCard" route; GuildSettings.seasonCardsEnabled (default ON, /officer dungeon season-cards) and the channel are re-checked
// at delivery, only for these jobs (key season-card:). Nothing is awarded.

const COLOR = 0xd4a017;
export interface SeasonInfo { name: string; startsAt: Date; endsAt: Date | null }
const day = (date: Date) => date.toISOString().slice(0, 10);
const MEDALS = ["🥇", "🥈", "🥉"];

/** Pure: the podium card of a season that ended. Without standings it says so in words. */
export function seasonEndCard(season: SeasonInfo, standings: readonly LeaderRow[] | null, lang: Lang, classes: ClassBook): ScoreCard {
  const fr = lang === "fr", t = (en: string, french: string) => fr ? french : en;
  const rows = (standings ?? []).filter(row => row.points > 0);
  return {
    eyebrow: t("Guilded · Dungeons", "Guilded · Donjons"), title: t(`${season.name} is over`, `${season.name} est terminée`),
    subtitle: `${day(season.startsAt)} → ${season.endsAt ? day(season.endsAt) : "—"}`,
    backdrop: { kind: "board", key: "dungeon-season" },
    stats: [
      { label: t("Champions", "Champions"), value: rows[0]?.name ?? "—", accent: "gold" },
      { label: t("Ranked players", "Joueurs classés"), value: String(rows.length) },
      ...(rows.length ? [{ label: t("Top score", "Meilleur score"), value: String(rows[0]!.points), accent: "green" as const }] : [])
    ],
    rowsLabel: t("Podium", "Podium"),
    rows: rows.length ? rows.slice(0, 3).map((row, index) => ({ name: row.name, color: classColor(classOf(classes, row.name)), sub: `${MEDALS[index]} ${index === 0 ? t("Champion", "Champion") : t(`Place ${index + 1}`, `${index + 1}e place`)}`, right: `${row.points} pts`, rightTone: index === 0 ? "gold" as const : undefined }))
      : [{ name: t("No ranked player this season", "Aucun joueur classé cette saison"), sub: t("No dungeon points were recorded", "Aucun point de donjon enregistré") }],
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

export function seasonEndFallback(season: SeasonInfo, standings: readonly LeaderRow[] | null, lang: Lang): EmbedBuilder {
  const fr = lang === "fr", rows = (standings ?? []).filter(row => row.points > 0).slice(0, 3);
  return new EmbedBuilder().setColor(COLOR).setTitle(fr ? `🏁 ${season.name} est terminée` : `🏁 ${season.name} is over`)
    .setDescription(rows.length ? rows.map((row, i) => `${MEDALS[i]} ${row.name} — ${row.points} pts`).join("\n") : fr ? "Aucun joueur classé cette saison." : "No ranked player this season.");
}
export function seasonStartFallback(season: SeasonInfo, lang: Lang): EmbedBuilder {
  const fr = lang === "fr";
  return new EmbedBuilder().setColor(COLOR).setTitle(fr ? `🚀 ${season.name} commence` : `🚀 ${season.name} begins`)
    .setDescription(season.endsAt ? `${day(season.startsAt)} → ${day(season.endsAt)}` : (fr ? `Dès le ${day(season.startsAt)}` : `From ${day(season.startsAt)}`));
}

type Database = Pick<PrismaClient, "discordJob" | "dungeonSeason" | "guildSettings">;
const json = (value: unknown) => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

/**
 * Queues the end card (of the season named `endedName`, when there is one) and the start card of the active season for one guild.
 * A job is created once per season: a repeated call never posts a card again.
 */
export async function queueSeasonCards(database: Database, guildId: string, endedName: string | null, lang: Lang, classes: ClassBook): Promise<number> {
  const settings = await database.guildSettings.findUnique({ where: { guildId }, select: { seasonCardsEnabled: true, dungeonLeaderboardChannelId: true } });
  if (!settings?.seasonCardsEnabled || !settings.dungeonLeaderboardChannelId) return 0;
  const put = async (key: string, card: ScoreCard, fallback: EmbedBuilder) => {
    const existing = await database.discordJob.findUnique({ where: { guildId_key: { guildId, key } } });
    if (existing) return 0;
    await database.discordJob.create({ data: { guildId, key, kind: "MESSAGE", payload: json({ route: "seasonCard", retryCard: true, message: { embeds: [fallback.toJSON()] }, card, cardOnly: { embeds: [textlessEmbed(COLOR)] } }) } });
    return 1;
  };
  let queued = 0;
  if (endedName) {
    const ended = await database.dungeonSeason.findFirst({ where: { guildId, name: endedName, status: { not: "ACTIVE" } }, orderBy: { endsAt: "desc" } });
    if (ended) {
      const standings = finalRows(ended.finalStandings);
      const info = { name: ended.name, startsAt: ended.startsAt, endsAt: ended.endsAt };
      queued += await put(`season-card:end:${ended.id}`, seasonEndCard(info, standings, lang, classes), seasonEndFallback(info, standings, lang));
    }
  }
  const active = await database.dungeonSeason.findFirst({ where: { guildId, status: "ACTIVE" }, orderBy: { startsAt: "desc" } });
  if (active) {
    const info = { name: active.name, startsAt: active.startsAt, endsAt: active.endsAt };
    queued += await put(`season-card:start:${active.id}`, seasonStartCard(info, lang), seasonStartFallback(info, lang));
  }
  return queued;
}

/** Delivery re-check for a season card job: switch and channel now (never for another job on any route). */
export const seasonCardChannel = (key: string, settings: { seasonCardsEnabled: boolean; dungeonLeaderboardChannelId: string | null } | null): string | null | undefined =>
  key.startsWith("season-card:") ? (settings?.seasonCardsEnabled ? settings.dungeonLeaderboardChannelId : null) : undefined;
