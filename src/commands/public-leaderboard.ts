import { MessageFlags, SlashCommandBuilder, type ChatInputCommandInteraction, type GuildMember } from "discord.js";
import { prisma } from "../database.js";
import { hasPermission } from "../permissions.js";

// /mod leaderboard: include this guild's dungeon runs on guilded.kcaron.top/leaderboards/ (7.0).
// Only valid, completed runs, with character names, class, role, time and deaths.
export const publicLeaderboardCommand = new SlashCommandBuilder()
  .setName("leaderboard")
  .setDescription("Share dungeon runs on the public leaderboards.")
  .addBooleanOption((o) => o.setName("share").setDescription("On or off").setRequired(true));

export async function executePublicLeaderboard(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guildId || !hasPermission(interaction.member as GuildMember, "officer")) {
    await interaction.reply({ content: "Only Officers, Guild Masters and server administrators can change this.", flags: MessageFlags.Ephemeral });
    return;
  }
  const guild = await prisma.guild.findUnique({ where: { discordId: interaction.guildId }, select: { id: true } });
  if (!guild) { await interaction.reply({ content: "Run `/setup start` first.", flags: MessageFlags.Ephemeral }); return; }
  const share = interaction.options.getBoolean("share", true);
  const settings = await prisma.guildSettings.upsert({ where: { guildId: guild.id }, create: { guildId: guild.id, publicDungeonRuns: share }, update: { publicDungeonRuns: share } });
  const window = settings.publicDungeonRunsSince
    ? `started since <t:${Math.ceil(settings.publicDungeonRunsSince.getTime() / 1000)}:f>, within the last 30 days`
    : "last 30 days";
  await interaction.reply({
    content: share
      ? `This guild's valid completed dungeon runs (${window}, then every 15 minutes) go to https://guilded.kcaron.top/leaderboards/ for anyone to see: all recorded party members' character names/realms, class, role, level, time, deaths and scores, including non-guild players. Turn it off with /mod leaderboard share:false; runs already shown stay.`
      : "Turned off: new runs from this guild are no longer shared. Runs already on the leaderboards stay.",
    flags: MessageFlags.Ephemeral
  });
}
