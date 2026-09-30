import { ActionRowBuilder, StringSelectMenuBuilder, EmbedBuilder, type StringSelectMenuInteraction, type Guild as DiscordGuild } from "discord.js";
import { prisma } from "../database.js";
import { asLang, t } from "../i18n.js";
import { formatLeaderboard, leaderboard } from "./dungeon-stats.js";
import { activeSeason } from "./dungeon-import.js";
import { createGuildService } from "./guild.js";

const guildService = createGuildService(prisma);
export const DUNGEON_SEASON_SELECT = "dseason:choose";

export async function handleDungeonSeasonSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  if (!interaction.guild) return;
  await interaction.deferReply({ ephemeral: true });
  const guild = await guildService.ensureGuild(interaction.guild.id, interaction.guild.name);
  const selectedId = interaction.values[0];
  if (!selectedId) { await interaction.editReply("Choose a season first."); return; }
  const selected = await prisma.dungeonSeason.findFirst({ where: { guildId: guild.id, id: selectedId } });
  if (!selected) { await interaction.editReply("That season is no longer available."); return; }
  const lang = asLang((await guildService.getSettings(guild.id))?.language);
  const rows = await leaderboard(prisma, guild.id, "season", null, 10, new Date(), selected.id);
  await interaction.editReply({ embeds: [new EmbedBuilder().setColor(0xd4a017).setTitle(selected.name)
    .setDescription(rows.length ? formatLeaderboard(rows) : t(lang, "dungeon.board.empty"))
    .setFooter({ text: `${selected.status === "ACTIVE" ? "Current season" : "Archived season"} · ${selected.startsAt.toISOString().slice(0, 10)}${selected.endsAt ? " → " + selected.endsAt.toISOString().slice(0, 10) : ""}` })], allowedMentions: { parse: [] } });
}

// One leaderboard message in the dungeon leaderboard channel, edited in
// place after every dungeon import so the channel always shows the standings.
// If the message was deleted, a new one is posted and remembered.
// Never throws: a failed refresh must not undo the import it follows.
export async function updateDungeonLeaderboard(discordGuild: DiscordGuild | null): Promise<boolean> {
  if (!discordGuild) return false;
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
    const rows = await leaderboard(prisma, guild.id, "season", null);
    const embed = new EmbedBuilder()
      .setColor(0xd4a017)
      .setTitle(t(lang, "dungeon.board.season", { season: season?.name ?? "Season 1" }))
      .setDescription(rows.length ? formatLeaderboard(rows) : t(lang, "dungeon.board.empty"))
      .setTimestamp(new Date());
    const seasons = await prisma.dungeonSeason.findMany({ where: { guildId: guild.id }, orderBy: { startsAt: "desc" }, take: 25 });
    for (const past of seasons.filter((row) => row.status === "ENDED").slice(0, 3)) {
      const top = await leaderboard(prisma, guild.id, "season", null, 3, new Date(), past.id);
      embed.addFields({ name: `${lang === "fr" ? "Saison passée" : "Past season"}: ${past.name}`.slice(0, 256), value: (top.length ? formatLeaderboard(top) : t(lang, "dungeon.board.empty")).slice(0, 1024) });
    }
    embed.setFooter({ text: lang === "fr" ? "Historique conservé. Choisissez une saison ci-dessous ou /dungeon leaderboard season." : "Season history is preserved. Choose a season below or use /dungeon leaderboard season." });
    const components = seasons.length ? [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder()
      .setCustomId(DUNGEON_SEASON_SELECT).setPlaceholder(lang === "fr" ? "Voir une saison" : "Browse a season")
      .addOptions(seasons.map((row) => ({ label: `${row.name} (${row.status === "ACTIVE" ? lang === "fr" ? "actuelle" : "current" : lang === "fr" ? "passée" : "past"})`.slice(0, 100), value: row.id }))))] : [];
    const payload = { embeds: [embed], components, allowedMentions: { parse: [] as never[] } };

    const existing = settings.dungeonLeaderboardMessageId
      ? await channel.messages.fetch(settings.dungeonLeaderboardMessageId).catch(() => null)
      : null;
    if (existing?.editable) {
      await existing.edit(payload);
    } else {
      const sent = await channel.send(payload);
      await guildService.updateSettings(guild.id, { dungeonLeaderboardMessageId: sent.id });
    }
    return true;
  } catch (error) {
    console.error("Failed to update dungeon leaderboard", error);
    return false;
  }
}
