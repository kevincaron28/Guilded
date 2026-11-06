import { EmbedBuilder, escapeMarkdown, type Guild as DiscordGuild, type Message } from "discord.js";
import { prisma } from "../database.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { asLang, type Lang } from "../i18n.js";
import { createGuildService } from "./guild.js";
import { deliverDiscordJob, dispatchDiscordJob, enqueueDiscordJob } from "./discord-jobs.js";
import { duelLeaderboard, percent, streakText, type DuelStanding } from "./duels.js";

// The live "Duels de la guilde" board (8.4.6): ONE bot message in the PvP statistics channel, edited in place after
// every duel upload and on a schedule. Opt-in per server (GuildSettings.duelBoardEnabled), nothing is awarded and
// nothing is posted as new chatter. It sits next to the static /bg panel, which it never touches.

const guildService = createGuildService(prisma);
export const DUEL_BOARD_MARKER = "Guilded duel board";
const TOP = 10, RECENT = 5, RECENT_DAYS = 7;

export interface RecentDuel { winner: string; loser: string; endedAt: Date; reason: string }
export interface BgSummary { participations: number; wins: number; losses: number; draws: number }
export interface DuelBoardData { standings: DuelStanding[]; duels: number; recent: RecentDuel[]; bg: BgSummary | null; edition: string }

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
  if (data.bg && data.bg.participations > 0) {
    embed.addFields({ name: t("Battlegrounds (last 30 days)", "Champs de bataille (30 derniers jours)"),
      value: t(`${data.bg.participations} reported participations from consenting members: ${data.bg.wins} wins, ${data.bg.losses} losses, ${data.bg.draws} draws. Provisional, not unique matches.`,
        `${data.bg.participations} participations rapportées par des membres consentants : ${data.bg.wins} victoires, ${data.bg.losses} défaites, ${data.bg.draws} nuls. Provisoire, pas des matchs uniques.`) });
  }
  return embed.setFooter({ text: `${DUEL_BOARD_MARKER} • ${guildId} • ${t(`${data.duels} counted duels · ${data.edition} · max 5 per pair per day · no points or awards`, `${data.duels} duels comptés · ${data.edition} · 5 par paire et par jour au plus · aucun point ni récompense`)}`.slice(0, 2048) });
}

export async function loadDuelBoardData(db: Pick<PrismaClient, "duelResult" | "battlegroundReport">, guildId: string, edition: string, now = new Date()): Promise<DuelBoardData> {
  const { standings, duels } = await duelLeaderboard(db, guildId, edition, { limit: TOP });
  const recentRows = await db.duelResult.findMany({ where: { guildId, gameEdition: edition, counted: true, endedAt: { gte: new Date(now.getTime() - RECENT_DAYS * 86_400_000) } },
    orderBy: { endedAt: "desc" }, take: RECENT, select: { winnerCharacter: true, loserCharacter: true, endedAt: true, reason: true } });
  const since = new Date(now.getTime() - 30 * 86_400_000);
  // Same consent filter as /bg stats: only members who allowed guild statistics contribute.
  const groups = await db.battlegroundReport.groupBy({ by: ["outcome"], _count: { _all: true }, where: { guildId, gameEdition: edition, status: "PROVISIONAL", endedAt: { gte: since, lt: now },
    member: { guildId, status: "ACTIVE", battlegroundConsent: { is: { guildId, capture: true, guildStats: true } } } } });
  const count = (outcome: string) => groups.find(row => row.outcome === outcome)?._count._all ?? 0;
  const wins = count("win"), losses = count("loss"), draws = count("draw");
  const participations = groups.reduce((sum, row) => sum + row._count._all, 0);
  return { standings, duels, edition, bg: participations ? { participations, wins, losses, draws } : null,
    recent: recentRows.map(row => ({ winner: row.winnerCharacter, loser: row.loserCharacter, endedAt: row.endedAt, reason: row.reason })) };
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
    if (!settings?.duelBoardEnabled || !settings.bgStatsChannelId) return false;
    const job = await enqueueDiscordJob(prisma, guild.id, "duel-board", "DUEL_BOARD");
    await deliverDiscordJob(prisma, job.id, current => dispatchDiscordJob(discordGuild, current));
    return (await prisma.discordJob.findUnique({ where: { id: job.id } }))?.status === "DONE";
  }
  try {
    const guild = await guildService.ensureGuild(discordGuild.id, discordGuild.name);
    const settings = await guildService.getSettings(guild.id);
    if (!settings?.duelBoardEnabled || !settings.bgStatsChannelId) return false;
    const channel = await discordGuild.channels.fetch(settings.bgStatsChannelId).catch(() => null);
    if (!channel?.isTextBased() || !("send" in channel)) return false;
    const lang = asLang(settings.language);
    const edition = guild.gameEdition ?? "forever";
    const embed = duelBoardEmbed(await loadDuelBoardData(prisma, guild.id, edition), lang, guild.id).setTimestamp(new Date());
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
      await guildService.updateSettings(guild.id, { duelBoardMessageId: sent.id });
    }
    return true;
  } catch (error) {
    console.error("Failed to update duel board", error);
    return false;
  }
}
