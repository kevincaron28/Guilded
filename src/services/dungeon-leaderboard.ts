import { cardAttachment } from "./card-alt.js";
import type { Guild as DiscordGuild, Message } from "discord.js";
import { prisma } from "../database.js";
import { asLang } from "../i18n.js";
import { leaderboard } from "./dungeon-stats.js";
import { activeSeason } from "./dungeon-import.js";
import { createGuildService } from "./guild.js";
import { deliverDiscordJob, dispatchDiscordJob, enqueueDiscordJob } from "./discord-jobs.js";
import { bestRunsEmbed, seasonBestRuns } from "./dungeon-best-runs.js";
import { guildBossRecords } from "./dungeon-records.js";
import { dungeonRating, hasDungeonRating, ratingEmbed } from "./dungeon-rating.js";
import { classOf, loadClassBook, type ClassBook } from "./ladder-classes.js";
import { classColor, ladderMeta, scoreCardPng, type ScoreCard } from "./score-card.js";
import { moveColumn, moveFields, trackRanks, type Movements } from "./ladder-snapshots.js";
import { seasonLabel } from "./season-label.js";
import { diagnoseDungeonBoard, emptyBoardNote } from "./dungeon-board-diagnosis.js";

export const DUNGEON_BOARD_CARD_FILE = "dungeon-season.png";
const CARD_TOP = 25;

/**
 * Pure: the season ladder picture (shared ladder layout): top 25 by points, medals for the top 3, class colours where the guild
 * knows the character, and the number of dungeons counted when the season is rated.
 */
export function dungeonSeasonCard(rows: readonly { name: string; points: number; dungeons?: number | undefined; key?: string | undefined }[], season: string, lang: "en" | "fr", rated: boolean,
  classes: ClassBook = new Map(), updatedAt = new Date(), moves: Movements | null = null): ScoreCard {
  const fr = lang === "fr";
  season = seasonLabel(season, lang);
  const ranked = [...rows].sort((a, b) => b.points - a.points || a.name.localeCompare(b.name)).slice(0, CARD_TOP);
  return {
    eyebrow: fr ? "Guilded · Donjons" : "Guilded · Dungeons", title: rated ? (fr ? "Score de donjon" : "Dungeon score") : (fr ? "Points de donjon" : "Dungeon points"),
    subtitle: fr ? `${rows.length} joueurs classés cette saison` : `${rows.length} ranked players this season`,
    backdrop: { kind: "board", key: "dungeon-season" },
    stats: [], footer: fr ? "Toutes les saisons : /dungeon archive · Champions : /dungeon hall-of-fame" : "All seasons: /dungeon archive · Champions: /dungeon hall-of-fame",
    ladder: {
      meta: ladderMeta(lang, updatedAt, season), empty: fr ? "Aucun parcours classé cette saison." : "No ranked run this season.",
      columns: [...(rated ? [{ label: fr ? "Donjons" : "Dungeons", width: 70 }, { label: "Score", width: 70, primary: true }] : [{ label: "Points", width: 70, primary: true }]),
        ...(moves ? [moveColumn(lang)] : [])],
      boards: [{ rows: ranked.map((row, index) => ({ rank: index + 1, name: row.name, color: classColor(classOf(classes, row.name)),
        values: [...(rated ? [String(row.dungeons ?? 0), String(Math.round(row.points))] : [String(row.points)]), ""], ...moveFields(moves, row.key ?? row.name, lang) })) }]
    }
  };
}

const guildService = createGuildService(prisma);
// Titles the bot has used for dungeon panels in this channel over time (beta scoring guide, rating and
// participation boards, past-season blocks). A bot message with one of them that is not the live board is outdated.
const PANEL_TITLE = /comment les points fonctionnent|how points work|^\W*(Exploration|Points de communauté|Community points|Points de participation|Participation points)|Meilleures tentatives|Best runs|Saison passée|Past season/i;
const isPanelMessage = (message: Pick<Message, "author" | "embeds" | "content">, botId: string) =>
  message.author.id === botId && message.embeds.some(embed => PANEL_TITLE.test(embed.title ?? "") || PANEL_TITLE.test(embed.fields?.[0]?.name ?? ""));

/** The season line on top of the board: it names the season in progress, so a new season is visible at a glance. */
export function seasonHeader(season: { name: string; startsAt: Date }, lang: "fr" | "en"): string {
  const when = `<t:${Math.floor(season.startsAt.getTime() / 1000)}:D>`;
  return lang === "fr" ? `📅 Saison en cours : **${seasonLabel(season.name, "fr")}** · depuis le ${when}` : `📅 Current season: **${season.name}** · since ${when}`;
}

// One leaderboard message in the dungeon leaderboard channel, edited in
// place after every dungeon import so the channel always shows the standings.
// If the message was deleted, a new one is posted and remembered.
// Never throws: a failed refresh must not undo the import it follows.
export async function updateDungeonLeaderboard(discordGuild: DiscordGuild | null, delivery = false): Promise<boolean> {
  if (!discordGuild) return false;
  if (!delivery) {
    const guild = await guildService.ensureGuild(discordGuild.id, discordGuild.name);
    const settings = await guildService.getSettings(guild.id);
    if (!settings?.dungeonLeaderboardChannelId) return false;
    const job = await enqueueDiscordJob(prisma, guild.id, "dungeon-board", "DUNGEON_BOARD");
    await deliverDiscordJob(prisma, job.id, current => dispatchDiscordJob(discordGuild, current));
    return (await prisma.discordJob.findUnique({ where: { id: job.id } }))?.status === "DONE";
  }
  try {
    const guild = await guildService.ensureGuild(discordGuild.id, discordGuild.name);
    const settings = await guildService.getSettings(guild.id);
    if (!settings?.dungeonLeaderboardChannelId) return false;
    const channel = await discordGuild.channels.fetch(settings.dungeonLeaderboardChannelId).catch(() => null);
    if (!channel?.isTextBased()) return false;

    const lang = asLang(settings.language);
    // 9.0.8: the active season is a plain read; the guild lock (held by an upload's import for up to
    // a minute) is only needed to create the first season, and then with a budget that outlasts the wait
    // (the 5 s default timed out behind an import: P2028, 9 November).
    const season = await prisma.dungeonSeason.findFirst({ where: { guildId: guild.id, status: "ACTIVE" }, orderBy: { startsAt: "desc" } })
      ?? await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${guild.id}, 0))`;
        return activeSeason(tx, guild.id);
      }, { timeout: 75_000, maxWait: 15_000 });
    // 15 November 2026: the separate dungeon points embed ("Points de communauté", the season top 10, the past-season blocks) and its
    // "Voir une saison" picker are retired: those points count in the community leaderboard now. An older message that still has them
    // is rebuilt without them by this same edit (components cleared). The rating and best-runs embeds and the ladder picture are unchanged.
    const cardRows = await leaderboard(prisma, guild.id, "season", null, CARD_TOP);
    const best = bestRunsEmbed(await seasonBestRuns(prisma, guild.id, season.id), lang, await guildBossRecords(prisma, guild.id).catch(() => []));
    const ratingRows = hasDungeonRating(season.ratingRules) ? await dungeonRating(prisma, guild.id, season) : null;
    const rating = ratingRows ? ratingEmbed(ratingRows, season.name, lang, season.ratingRules) : null;
    // An empty board says why (runs received but none counted, or none received): the reason sits on the best-runs embed.
    const unranked = !(ratingRows ?? cardRows).some(row => row.points > 0);
    const emptyNote = unranked ? emptyBoardNote(await diagnoseDungeonBoard(prisma, guild.id).catch(() => ({ season: null, received: 0, counted: 1, reasons: [] })), lang === "fr" ? "fr" : "en") : null;
    if (emptyNote && best.length + (rating?.length ?? 0) + emptyNote.length < 5800) best.setDescription(`${best.data.description ?? ""}

${emptyNote}`.trim().slice(0, 4096));
    // The ladder picture rides on the rating embed (on the best-runs embed for a season without rating rules); without it (drawing busy or failed) the embeds are unchanged.
    const ladderRows = (ratingRows ? ratingRows.map((row) => ({ name: row.name, points: row.points, dungeons: row.dungeons, key: `${row.memberId}:${row.character ?? ""}` }))
      : cardRows.map((row) => ({ name: row.name, points: row.points, key: row.memberId })))
      .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
    // A new season starts a new snapshot board, so arrows never compare two seasons.
    const moves = ladderRows.length ? await trackRanks(prisma, guild.id, `dungeon:${season.id}`, ladderRows.map((row) => row.key)) : null;
    const png = ladderRows.length ? await scoreCardPng(dungeonSeasonCard(ladderRows, season.name, lang === "fr" ? "fr" : "en", Boolean(ratingRows), await loadClassBook(prisma, guild.id).catch(() => new Map<string, string>()), new Date(), moves)).catch(() => null) : null;
    if (png) (rating ?? best).setImage(`attachment://${DUNGEON_BOARD_CARD_FILE}`);
    const payload = { embeds: rating ? [rating, best] : [best], components: [], files: png ? [cardAttachment(png, DUNGEON_BOARD_CARD_FILE)] : [], allowedMentions: { parse: [] as never[] } };

    const botId = discordGuild.client.user?.id ?? "";
    const saved = settings.dungeonLeaderboardMessageId
      ? await channel.messages.fetch(settings.dungeonLeaderboardMessageId).catch(() => null)
      : null;
    // Other dungeon panels the bot left in this channel (an older board, the beta scoring guide). Only the bot's
    // own messages with a known panel title are ever touched.
    const older = [...(await channel.messages.fetch({ limit: 50 }).catch(() => null))?.values() ?? []]
      .filter(message => message.id !== saved?.id && isPanelMessage(message, botId));
    // A saved message that is gone is replaced by the newest older panel (edited in place), not by a new post.
    const existing = saved?.author.id === botId ? saved : older.shift() ?? null;
    let keep: Message;
    if (existing?.editable) {
      keep = await existing.edit({ ...payload, attachments: [] });
    } else {
      keep = await channel.send(payload);
    }
    if (keep.id !== settings.dungeonLeaderboardMessageId) await guildService.updateSettings(guild.id, { dungeonLeaderboardMessageId: keep.id });
    for (const message of older) if (message.id !== keep.id && message.deletable) await message.delete().catch(() => undefined);
    return true;
  } catch (error) {
    console.error("Failed to update dungeon leaderboard", error);
    return false;
  }
}
