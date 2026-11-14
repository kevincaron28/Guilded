import { EmbedBuilder, type Guild as DiscordGuild } from "discord.js";
import { prisma } from "../database.js";
import { guildWhere } from "./guild-scope.js";
import { asLang } from "../i18n.js";
import { BRAND } from "../brand.js";
import { COMMUNITY_BOARD_NAMES } from "./community-leaderboard.js";

// The guild activity ladder (9.1) was merged into the community leaderboard on 14 November 2026. Its saved message is edited ONCE
// into a final notice pointing to the community leaderboard, then its saved id is cleared so nothing touches it again. The message
// itself is not deleted (an officer deletes it by hand); the stored switch, the rank snapshots and the channel stay as they were.

/** The notice, in the server's language. `leaderboardId` links the community leaderboard channel when it can be found. */
export function retiredActivityNotice(lang: "en" | "fr", leaderboardId?: string | null) {
  const where = leaderboardId ? `<#${leaderboardId}>` : lang === "fr" ? "le classement de la communauté" : "the community leaderboard";
  return new EmbedBuilder().setColor(BRAND.color)
    .setTitle(lang === "fr" ? "🏅 Le classement d’activité a déménagé" : "🏅 Guild activity has moved")
    .setDescription(lang === "fr"
      ? `Les points des donjons, des duels, des champs de bataille et du JcJ en monde ouvert comptent maintenant dans ${where}, avec ceux de Discord. Ce message ne sera plus mis à jour : un officier peut le supprimer.`
      : `Points from dungeons, duels, battlegrounds and open-world PvP now count in ${where}, together with the Discord points. This message is no longer updated: an officer can delete it.`)
    .setFooter({ text: lang === "fr" ? "Guilded · classement d’activité (retiré)" : "Guilded · guild activity (retired)" });
}

/** Retires one guild's old board message. Never throws; returns true when a message was turned into the notice. */
export async function retireActivityBoard(discordGuild: DiscordGuild | null): Promise<boolean> {
  if (!discordGuild) return false;
  try {
    const guild = await prisma.guild.findUnique({ where: guildWhere(discordGuild.id), select: { id: true } });
    if (!guild) return false;
    const settings = await prisma.guildSettings.findUnique({ where: { guildId: guild.id } });
    if (!settings?.activityBoardMessageId) return false;
    const channelId = settings.dungeonLeaderboardChannelId ?? settings.duelBoardChannelId;
    const channel = channelId ? await discordGuild.channels.fetch(channelId).catch(() => null) : null;
    const message = channel?.isTextBased() && "messages" in channel ? await channel.messages.fetch(settings.activityBoardMessageId).catch(() => null) : null;
    let edited = false;
    if (message && message.author.id === discordGuild.client.user?.id && message.editable) {
      const board = discordGuild.channels.cache.find(c => c.isTextBased() && COMMUNITY_BOARD_NAMES.includes(c.name) && /community|communaut/i.test(c.parent?.name ?? ""));
      await message.edit({ embeds: [retiredActivityNotice(asLang(settings.language), board?.id)], attachments: [], components: [], allowedMentions: { parse: [] } });
      edited = true;
    }
    await prisma.guildSettings.update({ where: { guildId: guild.id }, data: { activityBoardMessageId: null } });
    return edited;
  } catch (error) {
    console.error("Failed to retire the guild activity board", error);
    return false;
  }
}
