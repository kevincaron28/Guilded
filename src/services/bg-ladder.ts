import { EmbedBuilder, escapeMarkdown, type Guild as DiscordGuild, type Message } from "discord.js";
import { prisma } from "../database.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { asLang, type Lang } from "../i18n.js";
import { createGuildService } from "./guild.js";
import { deliverDiscordJob, dispatchDiscordJob, enqueueDiscordJob } from "./discord-jobs.js";
import { percent } from "./duels.js";
import { displayCharacterName, loadFullNameBook } from "./character-display.js";

// The battleground LADDER (8.5, track B2): its own message in the ladder channel (`pvp-ladder`, the statistics channel),
// edited in place, next to the duel ladder. The two never share points: this one counts consented battleground reports only
// (wins, losses, draws, win rate per player and per mode/bracket). The capture records outcomes, mode, bracket and map, not kills
// or honorable kills, so those are not shown. Player reports, not verified matches. On by default (GuildSettings.bgLadderEnabled).

const guildService = createGuildService(prisma);
export const BG_LADDER_MARKER = "Guilded BG ladder";
const TOP = 5, BRACKETS = 6, DAYS = 30;

export interface BgGroup { memberId: string; mode: string; bracket: string; outcome: string; _count: { _all: number } }
export interface BgStanding { memberId: string; name: string; games: number; wins: number; losses: number; draws: number; winRate: number }
export interface BgBracketLadder { mode: string; bracket: string; games: number; standings: BgStanding[] }
export interface BgLadderData { brackets: BgBracketLadder[]; participations: number; edition: string }

/** Pure: one ladder per mode and bracket, players by wins, then win rate, then games, then name. */
export function bgLadders(groups: readonly BgGroup[], names: ReadonlyMap<string, string>): BgBracketLadder[] {
  const byBracket = new Map<string, Map<string, BgStanding>>();
  for (const group of groups) {
    const key = `${group.mode}\u0000${group.bracket}`;
    const players = byBracket.get(key) ?? new Map<string, BgStanding>();
    byBracket.set(key, players);
    const player = players.get(group.memberId) ?? { memberId: group.memberId, name: names.get(group.memberId) ?? "?", games: 0, wins: 0, losses: 0, draws: 0, winRate: 0 };
    players.set(group.memberId, player);
    const n = group._count._all;
    player.games += n;
    if (group.outcome === "win") player.wins += n; else if (group.outcome === "loss") player.losses += n; else if (group.outcome === "draw") player.draws += n;
  }
  return [...byBracket.entries()].map(([key, players]) => {
    const [mode = "", bracket = ""] = key.split("\u0000");
    const standings = [...players.values()].map(player => ({ ...player, winRate: player.games ? player.wins / player.games : 0 }))
      .sort((a, b) => b.wins - a.wins || b.winRate - a.winRate || b.games - a.games || a.name.localeCompare(b.name));
    return { mode, bracket, games: standings.reduce((sum, player) => sum + player.games, 0), standings };
  }).sort((a, b) => b.games - a.games || a.mode.localeCompare(b.mode) || a.bracket.localeCompare(b.bracket));
}

/** Pure: the board's embed. Same input, same output (the timestamp is added by the caller). */
export function bgLadderEmbed(data: BgLadderData, lang: Lang, guildId = ""): EmbedBuilder {
  const t = (en: string, french: string) => lang === "fr" ? french : en;
  const name = (value: string) => escapeMarkdown(value).slice(0, 32);
  const embed = new EmbedBuilder().setColor(0x1d4ed8).setTitle(t("🏴 Battleground ladder", "🏴 Classement des champs de bataille"));
  if (!data.brackets.length) {
    embed.setDescription(t("No battleground report yet. Members' postmatch reports fill this ladder.", "Aucun rapport de champ de bataille. Les rapports après match des membres remplissent ce classement."));
  } else {
    embed.setDescription(t(`${data.participations} reported participations in the last ${DAYS} days, by mode and bracket. Wins, then win rate.`, `${data.participations} participations rapportées sur les ${DAYS} derniers jours, par mode et tranche. Victoires, puis taux de victoire.`));
    for (const ladder of data.brackets.slice(0, BRACKETS)) {
      const rows = ladder.standings.slice(0, TOP).map((player, index) => `${["🥇", "🥈", "🥉"][index] ?? `**${index + 1}.**`} ${name(player.name)} — ${player.wins}${t("W", "V")} ${player.losses}${t("L", "D")}${player.draws ? ` ${player.draws}${t("D", "N")}` : ""} · ${percent(player.winRate)} · ${player.games} ${t("games", "parties")}`);
      embed.addFields({ name: `${ladder.mode} · ${ladder.bracket}`.slice(0, 256), value: rows.join("\n").slice(0, 1024) });
    }
  }
  return embed.setFooter({ text: `${BG_LADDER_MARKER} • ${guildId} • ${t(`${data.edition} · player reports, not verified matches · separate from the duel ladder · no points or awards`, `${data.edition} · rapports de joueurs, pas des matchs vérifiés · distinct du classement des duels · aucun point ni récompense`)}`.slice(0, 2048) });
}

export async function loadBgLadderData(db: Pick<PrismaClient, "battlegroundReport" | "member"> & Partial<Pick<PrismaClient, "unclaimedCharacter" | "guildRosterEntry" | "character">>, guildId: string, edition: string, now = new Date()): Promise<BgLadderData> {
  const since = new Date(now.getTime() - DAYS * 86_400_000);
  const groups = await db.battlegroundReport.groupBy({ by: ["memberId", "mode", "bracket", "outcome"], _count: { _all: true },
    where: { guildId, gameEdition: edition, status: "PROVISIONAL", endedAt: { gte: since, lt: now },
      member: { guildId, status: "ACTIVE" } } });
  const members = await db.member.findMany({ where: { id: { in: [...new Set(groups.map(group => group.memberId))] } }, select: { id: true, displayName: true, characters: { where: { gameEdition: edition }, orderBy: [{ isMain: "desc" }, { name: "asc" }], take: 1, select: { name: true, displayName: true } } } });
  const book = await loadFullNameBook(db as never, guildId);
  const names = new Map(members.map(member => [member.id, member.characters?.[0] ? displayCharacterName(member.characters[0], book) : member.displayName]));
  return { brackets: bgLadders(groups, names), participations: groups.reduce((sum, group) => sum + group._count._all, 0), edition };
}

const isBoard = (message: Message, botId: string) => message.author.id === botId && message.embeds.some(embed => embed.footer?.text?.startsWith(`${BG_LADDER_MARKER} •`));

/**
 * Edits the saved ladder message in place; if it is gone, adopts an existing bot ladder in the channel before ever posting a
 * new one. Never throws. `delivery` is the job worker's call; any other call queues the refresh.
 */
export async function updateBgLadder(discordGuild: DiscordGuild | null, delivery = false): Promise<boolean> {
  if (!discordGuild) return false;
  if (!delivery) {
    const guild = await guildService.ensureGuild(discordGuild.id, discordGuild.name);
    const settings = await guildService.getSettings(guild.id);
    if (!settings?.bgLadderEnabled || !settings.bgStatsChannelId) return false;
    const job = await enqueueDiscordJob(prisma, guild.id, "bg-ladder", "BG_LADDER");
    await deliverDiscordJob(prisma, job.id, current => dispatchDiscordJob(discordGuild, current));
    return (await prisma.discordJob.findUnique({ where: { id: job.id } }))?.status === "DONE";
  }
  try {
    const guild = await guildService.ensureGuild(discordGuild.id, discordGuild.name);
    const settings = await guildService.getSettings(guild.id);
    if (!settings?.bgLadderEnabled || !settings.bgStatsChannelId) return false;
    const channel = await discordGuild.channels.fetch(settings.bgStatsChannelId).catch(() => null);
    if (!channel?.isTextBased() || !("send" in channel)) return false;
    const embed = bgLadderEmbed(await loadBgLadderData(prisma, guild.id, guild.gameEdition ?? "forever"), asLang(settings.language), guild.id).setTimestamp(new Date());
    const payload = { embeds: [embed], allowedMentions: { parse: [] as never[] } };
    const botId = discordGuild.client.user?.id ?? "";
    let existing: Message | null = settings.bgLadderMessageId ? await channel.messages.fetch(settings.bgLadderMessageId).catch(() => null) : null;
    if (existing && existing.author.id !== botId) existing = null;
    if (!existing) {
      const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
      existing = recent?.find(message => isBoard(message, botId)) ?? null;
    }
    if (existing?.editable) {
      await existing.edit(payload);
      if (existing.id !== settings.bgLadderMessageId) await guildService.updateSettings(guild.id, { bgLadderMessageId: existing.id });
    } else {
      const sent = await channel.send(payload);
      await guildService.updateSettings(guild.id, { bgLadderMessageId: sent.id });
    }
    return true;
  } catch (error) {
    console.error("Failed to update battleground ladder", error);
    return false;
  }
}
