// Run --apply only after the new bot and migration passed the release gates.
// Default is a read-only plan; never starts a second gateway client.
import { REST, Routes, ChannelType, type APIChannel, type APIGuildTextChannel } from "discord.js";
import { config } from "../src/config.js";
import { prisma } from "../src/database.js";
import { communityAudience, updateCommunityLeaderboard } from "../src/services/community-leaderboard.js";
import { communityMonthName } from "../src/services/community-display.js";
import { createCommunityService } from "../src/services/community.js";
import { COMMUNITY_CHANNEL_SPECS } from "../src/setup-names.js";
import { asLang } from "../src/i18n.js";

try {
  const categoryId = process.argv[2], apply = process.argv.includes("--apply");
  if (!categoryId || !/^\d+$/.test(categoryId)) throw new Error("Existing community category ID required.");
  const rest = new REST({ version: "10", timeout: 15000, retries: 1 }).setToken(config.DISCORD_TOKEN);
  const channels = await rest.get(Routes.guildChannels(config.DISCORD_GUILD_ID)) as APIChannel[];
  const children = channels.filter((c): c is APIGuildTextChannel<ChannelType.GuildText> => c.type === ChannelType.GuildText && c.parent_id === categoryId);
  const hubs = children.filter(c => ["activites", "activities"].includes(c.name));
  const boards = children.filter(c => ["🏆・leaderboard", "leaderboard", "classement", "community-standings"].includes(c.name));
  if (hubs.length !== 1 || boards.length !== 1) throw new Error("Ambiguous community channels.");
  const hub = hubs[0]!, board = boards[0]!;
  if (communityAudience(hub, config.DISCORD_CLIENT_ID) !== communityAudience(board, config.DISCORD_CLIENT_ID)) throw new Error("Community channel visibility differs. Review permissions first.");
  const guild = await prisma.guild.findUniqueOrThrow({ where: { discordId: config.DISCORD_GUILD_ID }, include: { settings: true } });
  const season = await prisma.communitySeason.findFirst({ where: { guildId: guild.id, game: "DISCORD", status: "ACTIVE", audienceRoleId: null, channelId: { in: [board.id, hub.id] } }, select: { id: true, name: true, createdAt: true } });
  if (!season) throw new Error("No unrestricted Discord season in the community channels.");
  const lang = asLang(guild.settings?.language);
  const name = /^(season|saison)\s+\d+$/i.test(season.name.trim()) ? communityMonthName(season.createdAt, guild.settings?.timezone ?? "America/Toronto", lang) : season.name;
  console.log(JSON.stringify({ mode: apply ? "apply" : "preview", seasonName: name, activities: hub.name, rankings: board.name, preservesPointsAndIds: true }));
  if (apply) {
    await createCommunityService(prisma).configureSeason(guild.id, season.id, "community-maintenance", { name, announcementChannelId: hub.id });
    for (const [channel, spec] of [[hub, COMMUNITY_CHANNEL_SPECS[lang].activities], [board, COMMUNITY_CHANNEL_SPECS[lang].standings]] as const) {
      await rest.patch(Routes.channel(channel.id), { body: { topic: spec.topic } });
    }
    await updateCommunityLeaderboard(rest, prisma, config.DISCORD_GUILD_ID, config.DISCORD_CLIENT_ID);
    console.log("Community panels updated; season identity, points and message history preserved.");
  }
} catch (error) {
  console.error(error instanceof Error && error.message.length < 160 ? error.message : "Community update unavailable. No credentials printed."); process.exitCode = 1;
} finally { await prisma.$disconnect(); }
