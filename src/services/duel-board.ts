import { EmbedBuilder, escapeMarkdown, type Guild as DiscordGuild, type Message } from "discord.js";
import { prisma } from "../database.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { asLang, type Lang } from "../i18n.js";
import { createGuildService } from "./guild.js";
import { deliverDiscordJob, dispatchDiscordJob, enqueueDiscordJob } from "./discord-jobs.js";
import { duelLeaderboard, percent, streakText, type DuelStanding } from "./duels.js";
import { previewAllows } from "./feature-preview.js";
import { displayCharacterName, loadFullNameBook, type FullNameBook } from "./character-display.js";

// The live "Duels de la guilde" board (8.4.6): ONE bot message in the PvP statistics channel, edited in place after
// every duel upload and on a schedule. On by default (GuildSettings.duelBoardEnabled), it posts once the ladder channel
// exists; nothing is awarded. It is the DUEL ladder only: battleground reports have their own message and their own
// numbers (bg-ladder.ts), never combined. It sits next to the static /bg panel, which it never touches.

const guildService = createGuildService(prisma);
export const DUEL_BOARD_MARKER = "Guilded duel board";
const TOP = 10, RECENT = 5, RECENT_DAYS = 7;

export interface RecentDuel { winner: string; loser: string; endedAt: Date; reason: string }
export interface DuelBoardData { standings: DuelStanding[]; duels: number; recent: RecentDuel[]; edition: string }

/** Pure: the board's embed. Same input, same output (the timestamp is added by the caller). */
export function duelBoardEmbed(data: DuelBoardData, lang: Lang, guildId = ""): EmbedBuilder {
  const fr = lang === "fr";
  const t = (en: string, french: string) => fr ? french : en;
  const name = (value: string) => escapeMarkdown(value).slice(0, 40);
  const embed = new EmbedBuilder().setColor(0xb91c1c).setTitle(t("⚔️ Guild duels", "⚔️ Duels de la guilde"));
  if (!data.standings.length) {
    embed.setDescription(t("No duel recorded yet. Challenge a guild member!", "Aucun duel enregistré — défie un membre de la guilde!"));
  } else {
    const rows = data.standings.slice(0, TOP).map((row, index) => {
      const medal = ["🥇", "🥈", "🥉"][index] ?? `**${index + 1}.**`;
      return `${medal} ${name(row.name)} — ${row.wins}${t("W", "V")} ${row.losses}${t("L", "D")} · ${percent(row.winRate)} · ${t("best streak", "meilleure série")} ${row.bestStreak} · ${streakText(row.streak)}`;
    });
    embed.setDescription(rows.join("\n"));
    if (data.recent.length) {
      embed.addFields({ name: t("Latest duels", "Derniers duels"), value: data.recent.slice(0, RECENT).map(duel =>
        `<t:${Math.floor(duel.endedAt.getTime() / 1000)}:R> · **${name(duel.winner)}** ${duel.reason === "retreat" ? t("won (opponent fled) against", "gagne (adversaire en fuite) contre") : t("beat", "bat")} ${name(duel.loser)}`).join("\n").slice(0, 1024) });
    }
  }
  return embed.setFooter({ text: `${DUEL_BOARD_MARKER} • ${guildId} • ${t(`${data.duels} counted duels · ${data.edition} · max 5 per pair per day · no points or awards`, `${data.duels} duels comptés · ${data.edition} · 5 par paire et par jour au plus · aucun point ni récompense`)}`.slice(0, 2048) });
}

export async function loadDuelBoardData(db: Pick<PrismaClient, "duelResult">, guildId: string, edition: string, now = new Date()): Promise<DuelBoardData> {
  const { standings, duels } = await duelLeaderboard(db, guildId, edition, { limit: TOP });
  const recentRows = await db.duelResult.findMany({ where: { guildId, gameEdition: edition, counted: true, endedAt: { gte: new Date(now.getTime() - RECENT_DAYS * 86_400_000) } },
    orderBy: { endedAt: "desc" }, take: RECENT, select: { winnerCharacter: true, loserCharacter: true, endedAt: true, reason: true } });
  return { standings, duels, edition,
    recent: recentRows.map(row => ({ winner: row.winnerCharacter, loser: row.loserCharacter, endedAt: row.endedAt, reason: row.reason })) };
}

/** Pure: the board data with every character shown by its full name where the guild knows it. */
export function withFullNames(data: DuelBoardData, book: FullNameBook): DuelBoardData {
  return { ...data, standings: data.standings.map(row => ({ ...row, name: displayCharacterName(row.name, book) })),
    recent: data.recent.map(duel => ({ ...duel, winner: displayCharacterName(duel.winner, book), loser: displayCharacterName(duel.loser, book) })) };
}

const isBoard = (message: Message, botId: string) => message.author.id === botId && message.embeds.some(embed => embed.footer?.text?.startsWith(`${DUEL_BOARD_MARKER} •`));

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
    if (!settings?.duelBoardEnabled || !settings.duelBoardChannelId || (!settings.duelBoardMessageId && !previewAllows(discordGuild.id))) return false;
    const job = await enqueueDiscordJob(prisma, guild.id, "duel-board", "DUEL_BOARD");
    await deliverDiscordJob(prisma, job.id, current => dispatchDiscordJob(discordGuild, current));
    return (await prisma.discordJob.findUnique({ where: { id: job.id } }))?.status === "DONE";
  }
  try {
    const guild = await guildService.ensureGuild(discordGuild.id, discordGuild.name);
    const settings = await guildService.getSettings(guild.id);
    if (!settings?.duelBoardEnabled || !settings.duelBoardChannelId || (!settings.duelBoardMessageId && !previewAllows(discordGuild.id))) return false;
    const channel = await discordGuild.channels.fetch(settings.duelBoardChannelId).catch(() => null);
    if (!channel?.isTextBased() || !("send" in channel)) return false;
    const lang = asLang(settings.language);
    const edition = guild.gameEdition ?? "forever";
    const embed = duelBoardEmbed(withFullNames(await loadDuelBoardData(prisma, guild.id, edition), await loadFullNameBook(prisma, guild.id)), lang, guild.id).setTimestamp(new Date());
    const payload = { embeds: [embed], allowedMentions: { parse: [] as never[] } };
    const botId = discordGuild.client.user?.id ?? "";
    let existing: Message | null = settings.duelBoardMessageId ? await channel.messages.fetch(settings.duelBoardMessageId).catch(() => null) : null;
    if (existing && existing.author.id !== botId) existing = null;
    if (!existing) {
      const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
      existing = recent?.find(message => isBoard(message, botId)) ?? null;
    }
    if (existing?.editable) {
      await existing.edit(payload);
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
