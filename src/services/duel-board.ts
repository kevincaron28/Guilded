import { cardAttachment } from "./card-alt.js";
import { EmbedBuilder, escapeMarkdown, type Guild as DiscordGuild, type Message } from "discord.js";
import { isOwnBoard } from "./board-identity.js";
import { prisma } from "../database.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { asLang, type Lang } from "../i18n.js";
import { createGuildService } from "./guild.js";
import { deliverDiscordJob, dispatchDiscordJob, enqueueDiscordJob } from "./discord-jobs.js";
import { duelLadder, percent, streakText, type DuelStanding, type LadderStanding } from "./duels.js";
import { ratingSeasonName, showRating } from "./duel-rating.js";
import { ratingFooter } from "./duel-rules.js";
import { displayCharacterName, loadFullNameBook, type FullNameBook } from "./character-display.js";
import { classOf, loadClassBook, type ClassBook } from "./ladder-classes.js";
import { classColor, ladderMeta, scoreCardPng, type ScoreCard } from "./score-card.js";
import { moveColumn, moveFields, trackRanks, type Movements } from "./ladder-snapshots.js";

// The live "Duels de la guilde" board (8.4.6): ONE bot message in the PvP statistics channel, edited in place after
// every duel upload and on a schedule. On by default (GuildSettings.duelBoardEnabled), it posts once the ladder channel
// exists; nothing is awarded. It is the DUEL ladder only: battleground reports have their own message and their own
// numbers (bg-ladder.ts), never combined. It sits next to the static /bg panel, which it never touches.

const guildService = createGuildService(prisma);
export const DUEL_BOARD_MARKER = "Guilded duel board";
const TOP = 10, CARD_TOP = 25, RECENT = 5, RECENT_DAYS = 7;
export const DUEL_CARD_FILE = "duels.png";

export interface RecentDuel { winner: string; loser: string; endedAt: Date; reason: string }
export interface DuelBoardData { standings: (DuelStanding & Partial<Pick<LadderStanding, "rank" | "ranked" | "placement">>)[]; duels: number; recent: RecentDuel[]; edition: string;
  /** "rating" from the rating start date (rating-v1); the old points before it (absent = points). */
  mode?: "points" | "rating"; seasonId?: string; startsAt?: Date }

/** What the score column of a row says: the points, or the shown rating, or the placement progress while unranked. */
const scoreText = (row: DuelBoardData["standings"][number]) => row.placement ? `${row.placement.duels}/${row.placement.needDuels}` : String(row.ranked === undefined ? row.score : showRating(row.score));

/**
 * Pure: the duel ladder picture (shared ladder layout): top 25 by the duel ranking, medals for the top 3, class colours where the
 * guild knows the character, wins, losses, win rate, best streak and the current streak.
 */
export function duelBoardCard(data: DuelBoardData, lang: Lang, classes: ClassBook = new Map(), updatedAt = new Date(), moves: Movements | null = null): ScoreCard {
  const fr = lang === "fr";
  return {
    eyebrow: `Guilded · ${fr ? "JcJ" : "PvP"}`, title: fr ? "Duels de la guilde" : "Guild duels",
    subtitle: (data.mode === "rating" && data.seasonId ? `${ratingSeasonName(data.seasonId, lang)} · ` : "") + (fr ? `${data.duels} duels comptés · ${data.standings.length} duellistes` : `${data.duels} counted duels · ${data.standings.length} duellists`),
    backdrop: { kind: "board", key: "duel" },
    stats: [], footer: data.mode === "rating" && data.seasonId ? ratingFooter(lang, ratingSeasonName(data.seasonId, lang), data.startsAt) : fr ? "Score : 10 par victoire, +2 par niveau de l'adversaire au-dessus de vous, -2 par niveau en dessous (0-20) · 5 duels par paire et par jour au plus · aucune récompense" : "Score: 10 per win, +2 per level the opponent is above you, -2 per level below (0-20) · max 5 duels per pair per day · no rewards",
    ladder: {
      meta: ladderMeta(lang, updatedAt), empty: fr ? "Aucun duel enregistré." : "No duel recorded yet.",
      columns: [{ label: data.mode === "rating" ? (fr ? "Cote" : "Rating") : "Score", width: 52, primary: true }, { label: fr ? "V" : "W", width: 44 }, { label: fr ? "D" : "L", width: 44 }, { label: fr ? "% vict." : "Win %", width: 64 },
        { label: fr ? "Record" : "Best", width: 56 }, { label: fr ? "Série" : "Streak", width: 56 }, ...(moves ? [moveColumn(lang)] : [])],
      boards: [{ rows: data.standings.slice(0, CARD_TOP).map((row, index) => ({ rank: row.rank === undefined ? index + 1 : row.rank ?? 0, name: row.name, color: classColor(classOf(classes, row.name)),
        values: [scoreText(row), String(row.wins), String(row.losses), percent(row.winRate), String(row.bestStreak), streakText(row.streak), ""], ...moveFields(moves, row.memberId, lang) })) }]
    }
  };
}

/** Pure: the board's embed. Same input, same output (the timestamp is added by the caller). With `image`, the card holds the ladder and the embed names the top 3. */
export function duelBoardEmbed(data: DuelBoardData, lang: Lang, image?: string): EmbedBuilder {
  const fr = lang === "fr";
  const t = (en: string, french: string) => fr ? french : en;
  const name = (value: string) => escapeMarkdown(value).slice(0, 40);
  const embed = new EmbedBuilder().setColor(0xb91c1c).setTitle(t("⚔️ Guild duels", "⚔️ Duels de la guilde"));
  if (!data.standings.length) {
    embed.setDescription(t("No duel recorded yet. Challenge a guild member!", "Aucun duel enregistré — défie un membre de la guilde!"));
  } else {
    const rows = data.standings.slice(0, image ? 3 : TOP).map((row, index) => {
      const medal = ["🥇", "🥈", "🥉"][index] ?? `**${index + 1}.**`;
      return `${medal} ${name(row.name)} — ${data.mode === "rating" ? (row.placement ? t(`placement ${scoreText(row)}`, `placement ${scoreText(row)}`) : `${scoreText(row)}`) : `${row.score} pts`} · ${row.wins}${t("W", "V")} ${row.losses}${t("L", "D")} · ${percent(row.winRate)} · ${t("best streak", "meilleure série")} ${row.bestStreak} · ${streakText(row.streak)}`;
    });
    // With the picture, its top 3 repeat the card: the embed keeps only the title and the latest duels (9.3).
    if (!image) embed.setDescription(rows.join("\n"));
    if (data.recent.length) {
      embed.addFields({ name: t("Latest duels", "Derniers duels"), value: data.recent.slice(0, RECENT).map(duel =>
        `<t:${Math.floor(duel.endedAt.getTime() / 1000)}:R> · **${name(duel.winner)}** ${duel.reason === "retreat" ? t("won (opponent fled) against", "gagne (adversaire en fuite) contre") : t("beat", "bat")} ${name(duel.loser)}`).join("\n").slice(0, 1024) });
    }
  }
  if (image && data.standings.length) embed.setImage(`attachment://${image}`);
  if (data.mode === "rating" && data.seasonId) return embed.setFooter({ text: `${data.duels} ${t("counted duels", "duels comptés")} · ${ratingFooter(lang, ratingSeasonName(data.seasonId, lang), data.startsAt)}`.slice(0, 2000) });
  return embed.setFooter({ text: t(`${data.duels} counted duels · score: 10 per win, +2 per level the opponent is above you, -2 per level below (0-20) · max 5 per pair per day · no rewards`, `${data.duels} duels comptés · score : 10 par victoire, +2 par niveau de l'adversaire au-dessus de vous, -2 en dessous (0-20) · 5 par paire et par jour · aucune récompense`) });
}

export async function loadDuelBoardData(db: Pick<PrismaClient, "duelResult"> & { guildSettings?: Pick<PrismaClient["guildSettings"], "findUnique"> }, guildId: string, edition: string, now = new Date()): Promise<DuelBoardData> {
  const { standings, duels, mode, season, startsAt } = await duelLadder(db, guildId, edition, { limit: CARD_TOP, now });
  const recentRows = await db.duelResult.findMany({ where: { guildId, gameEdition: edition, counted: true, archived: false, endedAt: { gte: new Date(now.getTime() - RECENT_DAYS * 86_400_000) } },
    orderBy: { endedAt: "desc" }, take: RECENT, select: { winnerCharacter: true, loserCharacter: true, endedAt: true, reason: true } });
  return { standings, duels, edition, mode, ...(season ? { seasonId: season.id } : {}), startsAt,
    recent: recentRows.map(row => ({ winner: row.winnerCharacter, loser: row.loserCharacter, endedAt: row.endedAt, reason: row.reason })) };
}

/** Pure: the board data with every character shown by its full name where the guild knows it. */
export function withFullNames(data: DuelBoardData, book: FullNameBook): DuelBoardData {
  return { ...data, standings: data.standings.map(row => ({ ...row, name: displayCharacterName(row.name, book) })),
    recent: data.recent.map(duel => ({ ...duel, winner: displayCharacterName(duel.winner, book), loser: displayCharacterName(duel.loser, book) })) };
}

const isBoard = (message: Message, botId: string) => isOwnBoard(message, botId, DUEL_BOARD_MARKER, ["⚔️ Guild duels", "⚔️ Duels de la guilde"]);

/**
 * Edits the saved board message in place; if it is gone, adopts an existing bot board in the channel before ever
 * posting a new one. Never throws: a failed refresh must not undo the import it follows.
 * `delivery` is the job worker's call; any other call queues the refresh.
 */
export async function updateDuelBoard(discordGuild: DiscordGuild | null, delivery = false): Promise<boolean> {
  if (!discordGuild) return false;
  if (!delivery) {
    const guild = await guildService.ensureGuild(discordGuild.id, discordGuild.name);
    const settings = await guildService.getSettings(guild.id);
    if (!settings?.duelBoardEnabled || !settings.duelBoardChannelId ) return false;
    const job = await enqueueDiscordJob(prisma, guild.id, "duel-board", "DUEL_BOARD");
    await deliverDiscordJob(prisma, job.id, current => dispatchDiscordJob(discordGuild, current));
    return (await prisma.discordJob.findUnique({ where: { id: job.id } }))?.status === "DONE";
  }
  try {
    const guild = await guildService.ensureGuild(discordGuild.id, discordGuild.name);
    const settings = await guildService.getSettings(guild.id);
    if (!settings?.duelBoardEnabled || !settings.duelBoardChannelId ) return false;
    const channel = await discordGuild.channels.fetch(settings.duelBoardChannelId).catch(() => null);
    if (!channel?.isTextBased() || !("send" in channel)) return false;
    const lang = asLang(settings.language);
    const edition = guild.gameEdition ?? "forever";
    const data = withFullNames(await loadDuelBoardData(prisma, guild.id, edition), await loadFullNameBook(prisma, guild.id));
    const moves = data.standings.length ? await trackRanks(prisma, guild.id, "duel", data.standings.map(row => row.memberId)) : null;
    const png = data.standings.length ? await scoreCardPng(duelBoardCard(data, lang, await loadClassBook(prisma, guild.id).catch(() => new Map<string, string>()), new Date(), moves)).catch(() => null) : null;
    const embed = duelBoardEmbed(data, lang, png ? DUEL_CARD_FILE : undefined).setTimestamp(new Date());
    const payload = { embeds: [embed], files: png ? [cardAttachment(png, DUEL_CARD_FILE)] : [], allowedMentions: { parse: [] as never[] } };
    const botId = discordGuild.client.user?.id ?? "";
    let existing: Message | null = settings.duelBoardMessageId ? await channel.messages.fetch(settings.duelBoardMessageId).catch(() => null) : null;
    if (existing && existing.author.id !== botId) existing = null;
    if (!existing) {
      const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
      existing = recent?.find(message => isBoard(message, botId)) ?? null;
    }
    if (existing?.editable) {
      await existing.edit({ ...payload, attachments: [] });
      if (existing.id !== settings.duelBoardMessageId) await guildService.updateSettings(guild.id, { duelBoardMessageId: existing.id });
    } else {
      const sent = await channel.send(payload);
      const previousId = settings.duelBoardMessageId;
      await guildService.updateSettings(guild.id, { duelBoardMessageId: sent.id });
      // Before 8.5 the duel board shared the statistics channel with the battleground ladder. Once it lives in its own channel,
      // the bot removes its own old copy there (only a message of this bot that carries the duel board footer).
      if (previousId && settings.bgStatsChannelId && settings.bgStatsChannelId !== channel.id) {
        const old = await discordGuild.channels.fetch(settings.bgStatsChannelId).catch(() => null);
        const stale = old?.isTextBased() ? await old.messages.fetch(previousId).catch(() => null) : null;
        if (stale && isBoard(stale, botId)) await stale.delete().catch(() => undefined);
      }
    }
    return true;
  } catch (error) {
    console.error("Failed to update duel board", error);
    return false;
  }
}
