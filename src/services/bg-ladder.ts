import { AttachmentBuilder, EmbedBuilder, escapeMarkdown, type Guild as DiscordGuild, type Message } from "discord.js";
import { isOwnBoard } from "./board-identity.js";
import { prisma } from "../database.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { asLang, type Lang } from "../i18n.js";
import { createGuildService } from "./guild.js";
import { deliverDiscordJob, dispatchDiscordJob, enqueueDiscordJob } from "./discord-jobs.js";
import { percent } from "./duels.js";
import { displayCharacterName, loadFullNameBook } from "./character-display.js";
import { classOf, loadClassBook, type ClassBook } from "./ladder-classes.js";
import { classColor, ladderMeta, scoreCardPng, type ScoreCard } from "./score-card.js";
import { loadWorldPvpData, worldPvpCard, worldPvpEmbed, WORLD_PVP_CARD_FILE } from "./world-pvp.js";
import { moveColumn, moveFields, trackRanks, type Movements } from "./ladder-snapshots.js";

/** The snapshot board id of one mode and bracket. */
export const bgBoardKey = (ladder: { mode: string; bracket: string }) => `bg:${ladder.mode}:${ladder.bracket}`.slice(0, 120);

// The battleground LADDER (8.5, track B2): its own message in the ladder channel (`pvp-ladder`, the statistics channel),
// edited in place, next to the duel ladder. The two never share points: this one counts consented battleground reports only
// (wins, losses, draws, win rate per player and per mode/bracket). The capture records outcomes, mode, bracket and map, not kills
// or honorable kills, so those are not shown. Player reports, not verified matches. On by default (GuildSettings.bgLadderEnabled).

const guildService = createGuildService(prisma);
export const BG_LADDER_MARKER = "Guilded BG ladder";
const TOP = 5, CARD_TOP = 10, BRACKETS = 6, DAYS = 30;
export const BG_CARD_FILE = "battlegrounds.png";

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

/**
 * Pure: the battleground ladder picture (shared ladder layout): one panel per mode and bracket (up to 6, busiest first), top 10
 * each by wins then win rate, with class colours where the guild knows the character.
 */
export function bgLadderCard(data: BgLadderData, lang: Lang, classes: ClassBook = new Map(), updatedAt = new Date(), moves: ReadonlyMap<string, Movements> = new Map()): ScoreCard {
  const fr = lang === "fr";
  return {
    eyebrow: `Guilded · ${fr ? "JcJ" : "PvP"}`, title: fr ? "Champs de bataille" : "Battleground ladder",
    subtitle: fr ? `${data.participations} participations rapportées · ${DAYS} derniers jours` : `${data.participations} reported participations · last ${DAYS} days`,
    stats: [], footer: fr ? "Rapports de joueurs, pas des matchs vérifiés · distinct des duels · aucun point ni récompense" : "Player reports, not verified matches · separate from duels · no points or awards",
    ladder: {
      meta: ladderMeta(lang, updatedAt), empty: fr ? "Aucun rapport de champ de bataille." : "No battleground report yet.",
      columns: [{ label: fr ? "V" : "W", width: 40, primary: true }, { label: fr ? "D" : "L", width: 40 }, { label: "%", width: 52 }, { label: fr ? "Parties" : "Games", width: 56 },
        ...(moves.size ? [moveColumn(lang)] : [])],
      boards: data.brackets.slice(0, BRACKETS).map(ladder => ({ title: `${ladder.mode} · ${ladder.bracket}`, rows: ladder.standings.slice(0, CARD_TOP).map((player, index) => ({
        rank: index + 1, name: player.name, color: classColor(classOf(classes, player.name)),
        values: [String(player.wins), String(player.losses), percent(player.winRate), String(player.games), ""], ...moveFields(moves.get(bgBoardKey(ladder)), player.memberId, lang) })) }))
    }
  };
}

/** Pure: the board's embed. Same input, same output (the timestamp is added by the caller). With `image`, the card holds the ladders and the embed keeps the summary. */
export function bgLadderEmbed(data: BgLadderData, lang: Lang, image?: string): EmbedBuilder {
  const t = (en: string, french: string) => lang === "fr" ? french : en;
  const name = (value: string) => escapeMarkdown(value).slice(0, 32);
  const embed = new EmbedBuilder().setColor(0x1d4ed8).setTitle(t("🏴 Battleground ladder", "🏴 Classement des champs de bataille"));
  if (!data.brackets.length) {
    embed.setDescription(t("No battleground report yet. Members' postmatch reports fill this ladder.", "Aucun rapport de champ de bataille. Les rapports après match des membres remplissent ce classement."));
  } else {
    embed.setDescription(t(`${data.participations} reported participations in the last ${DAYS} days, by mode and bracket. Wins, then win rate.`, `${data.participations} participations rapportées sur les ${DAYS} derniers jours, par mode et tranche. Victoires, puis taux de victoire.`));
    for (const ladder of data.brackets.slice(0, image ? 0 : BRACKETS)) {
      const rows = ladder.standings.slice(0, TOP).map((player, index) => `${["🥇", "🥈", "🥉"][index] ?? `**${index + 1}.**`} ${name(player.name)} — ${player.wins}${t("W", "V")} ${player.losses}${t("L", "D")}${player.draws ? ` ${player.draws}${t("D", "N")}` : ""} · ${percent(player.winRate)} · ${player.games} ${t("games", "parties")}`);
      embed.addFields({ name: `${ladder.mode} · ${ladder.bracket}`.slice(0, 256), value: rows.join("\n").slice(0, 1024) });
    }
  }
  if (image && data.brackets.length) embed.setImage(`attachment://${image}`);
  return embed.setFooter({ text: t("Members' reports after each match, not verified by Blizzard · separate from the duel ladder · no points or awards", "Rapports des membres après chaque match, non vérifiés par Blizzard · distinct du classement des duels · aucun point ni récompense") });
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

const isBoard = (message: Message, botId: string) => isOwnBoard(message, botId, BG_LADDER_MARKER, ["🏴 Battleground ladder", "🏴 Classement des champs de bataille"]);

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
    const data = await loadBgLadderData(prisma, guild.id, guild.gameEdition ?? "forever"), lang = asLang(settings.language);
    const moves = new Map<string, Movements>();
    for (const ladder of data.brackets.slice(0, 6)) {
      const tracked = await trackRanks(prisma, guild.id, bgBoardKey(ladder), ladder.standings.map(player => player.memberId));
      if (tracked) moves.set(bgBoardKey(ladder), tracked);
    }
    const png = data.brackets.length ? await scoreCardPng(bgLadderCard(data, lang, await loadClassBook(prisma, guild.id).catch(() => new Map<string, string>()), new Date(), moves)).catch(() => null) : null;
    const embed = bgLadderEmbed(data, lang, png ? BG_CARD_FILE : undefined).setTimestamp(new Date());
    const embeds = [embed], files = png ? [new AttachmentBuilder(png, { name: BG_CARD_FILE })] : [];
    // World PvP (9.1): a second panel on the same message; officers turn it off with /battleground world-pvp.
    if (settings.worldPvpEnabled !== false) {
      const world = await loadWorldPvpData(prisma, guild.id, guild.gameEdition ?? "forever").catch(() => null);
      if (world) {
        const worldPng = world.standings.length ? await scoreCardPng(worldPvpCard(world, lang, await loadClassBook(prisma, guild.id).catch(() => new Map<string, string>()))).catch(() => null) : null;
        embeds.push(worldPvpEmbed(world, lang, worldPng ? WORLD_PVP_CARD_FILE : undefined));
        if (worldPng) files.push(new AttachmentBuilder(worldPng, { name: WORLD_PVP_CARD_FILE }));
      }
    }
    const payload = { embeds, files, allowedMentions: { parse: [] as never[] } };
    const botId = discordGuild.client.user?.id ?? "";
    let existing: Message | null = settings.bgLadderMessageId ? await channel.messages.fetch(settings.bgLadderMessageId).catch(() => null) : null;
    if (existing && existing.author.id !== botId) existing = null;
    if (!existing) {
      const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
      existing = recent?.find(message => isBoard(message, botId)) ?? null;
    }
    if (existing?.editable) {
      await existing.edit({ ...payload, attachments: [] });
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
