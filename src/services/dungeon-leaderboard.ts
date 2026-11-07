import { ActionRowBuilder, AttachmentBuilder, StringSelectMenuBuilder, EmbedBuilder, type StringSelectMenuInteraction, type Guild as DiscordGuild, type Message, MessageFlags } from "discord.js";
import { prisma } from "../database.js";
import { asLang, t } from "../i18n.js";
import { formatLeaderboard, leaderboard } from "./dungeon-stats.js";
import { activeSeason } from "./dungeon-import.js";
import { createGuildService } from "./guild.js";
import { deliverDiscordJob, dispatchDiscordJob, enqueueDiscordJob } from "./discord-jobs.js";
import { seasonRows } from "./season-archive.js";
import { bestRunsEmbed, seasonBestRuns } from "./dungeon-best-runs.js";
import { dungeonRating, hasDungeonRating, ratingEmbed } from "./dungeon-rating.js";
import { classOf, loadClassBook, type ClassBook } from "./ladder-classes.js";
import { classColor, ladderMeta, scoreCardPng, type ScoreCard } from "./score-card.js";

export const DUNGEON_BOARD_CARD_FILE = "dungeon-season.png";
const CARD_TOP = 25;

/**
 * Pure: the season ladder picture (shared ladder layout): top 25 by points, medals for the top 3, class colours where the guild
 * knows the character, and the number of dungeons counted when the season is rated.
 */
export function dungeonSeasonCard(rows: readonly { name: string; points: number; dungeons?: number | undefined }[], season: string, lang: "en" | "fr", rated: boolean,
  classes: ClassBook = new Map(), updatedAt = new Date()): ScoreCard {
  const fr = lang === "fr";
  const ranked = [...rows].sort((a, b) => b.points - a.points || a.name.localeCompare(b.name)).slice(0, CARD_TOP);
  return {
    eyebrow: fr ? "Guilded · Donjons" : "Guilded · Dungeons", title: rated ? (fr ? "Score de donjon" : "Dungeon score") : (fr ? "Points de donjon" : "Dungeon points"),
    subtitle: fr ? `${rows.length} joueurs classés cette saison` : `${rows.length} ranked players this season`,
    stats: [], footer: fr ? "Toutes les saisons : /dungeon archive · Champions : /dungeon hall-of-fame" : "All seasons: /dungeon archive · Champions: /dungeon hall-of-fame",
    ladder: {
      meta: ladderMeta(lang, updatedAt, season), empty: fr ? "Aucun parcours classé cette saison." : "No ranked run this season.",
      columns: rated ? [{ label: fr ? "Donjons" : "Dungeons", width: 70 }, { label: "Score", width: 70, primary: true }] : [{ label: "Points", width: 70, primary: true }],
      boards: [{ rows: ranked.map((row, index) => ({ rank: index + 1, name: row.name, color: classColor(classOf(classes, row.name)),
        values: rated ? [String(row.dungeons ?? 0), String(Math.round(row.points))] : [String(row.points)] })) }]
    }
  };
}

const guildService = createGuildService(prisma);
export const DUNGEON_SEASON_SELECT = "dseason:choose";

// Titles the bot has used for dungeon panels in this channel over time (beta scoring guide, rating and
// participation boards, past-season blocks). A bot message with one of them that is not the live board is outdated.
const PANEL_TITLE = /comment les points fonctionnent|how points work|^\W*(Exploration|Points de participation|Participation points)|Meilleures tentatives|Best runs|Saison passée|Past season/i;
const isPanelMessage = (message: Pick<Message, "author" | "embeds" | "content">, botId: string) =>
  message.author.id === botId && message.embeds.some(embed => PANEL_TITLE.test(embed.title ?? "") || PANEL_TITLE.test(embed.fields?.[0]?.name ?? ""));

/** The season line on top of the board: it names the season in progress, so a new season is visible at a glance. */
export function seasonHeader(season: { name: string; startsAt: Date }, lang: "fr" | "en"): string {
  const when = `<t:${Math.floor(season.startsAt.getTime() / 1000)}:D>`;
  return lang === "fr" ? `📅 Saison en cours : **${season.name}** · depuis le ${when}` : `📅 Current season: **${season.name}** · since ${when}`;
}

export async function handleDungeonSeasonSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  if (!interaction.guild) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const guild = await guildService.ensureGuild(interaction.guild.id, interaction.guild.name);
  const selectedId = interaction.values[0];
  if (!selectedId) { await interaction.editReply("Choose a season first."); return; }
  const selected = await prisma.dungeonSeason.findFirst({ where: { guildId: guild.id, id: selectedId } });
  if (!selected) { await interaction.editReply("That season is no longer available."); return; }
  const lang = asLang((await guildService.getSettings(guild.id))?.language);
  if (hasDungeonRating(selected.ratingRules)) {
    await interaction.editReply({ embeds: [ratingEmbed(await dungeonRating(prisma, guild.id, selected), selected.name, lang, selected.ratingRules)], allowedMentions: { parse: [] } });
    return;
  }
  const rows = await seasonRows(prisma, guild.id, selected);
  await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0xd4a017).setTitle(selected.name)
    .setDescription(rows.length ? formatLeaderboard(rows) : t(lang, "dungeon.board.empty"))
    .setFooter({ text: `${selected.status === "ACTIVE" ? "Current season" : "Archived season"} · ${selected.startsAt.toISOString().slice(0, 10)}${selected.endsAt ? " → " + selected.endsAt.toISOString().slice(0, 10) : ""}` })], allowedMentions: { parse: [] } });
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
    const season = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${guild.id}, 0))`;
      return activeSeason(tx, guild.id);
    });
    const cardRows = await leaderboard(prisma, guild.id, "season", null, CARD_TOP), rows = cardRows.slice(0, 10);
    const embed = new EmbedBuilder()
      .setColor(0xd4a017)
      .setTitle(t(lang, "dungeon.board.season", { season: season?.name ?? "Season 1" }))
      .setDescription(`${seasonHeader(season, lang === "fr" ? "fr" : "en")}

${rows.length ? formatLeaderboard(rows) : t(lang, "dungeon.board.empty")}`.slice(0, 4096))
      .setTimestamp(new Date());
    const seasons = await prisma.dungeonSeason.findMany({ where: { guildId: guild.id }, orderBy: { startsAt: "desc" }, take: 25 });
    for (const past of seasons.filter((row) => row.status === "ENDED").slice(0, 3)) {
      const top = await seasonRows(prisma, guild.id, past, 3);
      embed.addFields({ name: `${lang === "fr" ? "Saison passée" : "Past season"}: ${past.name}`.slice(0, 256), value: (top.length ? formatLeaderboard(top) : t(lang, "dungeon.board.empty")).slice(0, 1024) });
    }
    embed.setFooter({ text: lang === "fr" ? "Toutes les saisons : /dungeon archive. Champions : /dungeon hall-of-fame." : "All seasons: /dungeon archive. Champions: /dungeon hall-of-fame." });
    const components = seasons.length ? [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder()
      .setCustomId(DUNGEON_SEASON_SELECT).setPlaceholder(lang === "fr" ? "Voir une saison" : "Browse a season")
      .addOptions(seasons.map((row) => ({ label: `${row.name} (${row.status === "ACTIVE" ? lang === "fr" ? "actuelle" : "current" : lang === "fr" ? "passée" : "past"})`.slice(0, 100), value: row.id }))))] : [];
    const best = bestRunsEmbed(await seasonBestRuns(prisma, guild.id, season.id), lang);
    const ratingRows = hasDungeonRating(season.ratingRules) ? await dungeonRating(prisma, guild.id, season) : null;
    const rating = ratingRows ? ratingEmbed(ratingRows, season.name, lang, season.ratingRules) : null;
    if (rating) embed.setTitle(lang === "fr" ? "🤝 Points de participation" : "🤝 Participation points");
    // Discord applies the 6,000-character budget across all embeds in a message.
    if (embed.length + best.length + (rating?.length ?? 0) > 5900) embed.setFields([]);
    if (embed.length + best.length + (rating?.length ?? 0) > 5900) embed.setDescription("/dungeon leaderboard metric:participation");
    // The ladder picture rides on the first embed; without it (drawing busy or failed) the embeds are unchanged.
    const ladderRows = ratingRows ? ratingRows.map((row) => ({ name: row.name, points: row.points, dungeons: row.dungeons })) : cardRows;
    const png = ladderRows.length ? await scoreCardPng(dungeonSeasonCard(ladderRows, season.name, lang === "fr" ? "fr" : "en", Boolean(ratingRows), await loadClassBook(prisma, guild.id).catch(() => new Map<string, string>()))).catch(() => null) : null;
    if (png) (rating ?? embed).setImage(`attachment://${DUNGEON_BOARD_CARD_FILE}`);
    const payload = { embeds: rating ? [rating, best, embed] : [embed, best], components, files: png ? [new AttachmentBuilder(png, { name: DUNGEON_BOARD_CARD_FILE })] : [], allowedMentions: { parse: [] as never[] } };

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
