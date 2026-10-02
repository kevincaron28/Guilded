// Read-only inventory; never opens a gateway session or prints credentials.
import { REST, Routes, ChannelType, PermissionFlagsBits, type APIChannel, type APIMessage } from "discord.js";
import { config } from "../src/config.js";
import { prisma } from "../src/database.js";

try {
  const rest = new REST({ version: "10", timeout: 10_000, retries: 0 }).setToken(config.DISCORD_TOKEN);
  const channels = await rest.get(Routes.guildChannels(config.DISCORD_GUILD_ID)) as APIChannel[];
  const record = await prisma.guild.findUniqueOrThrow({ where: { discordId: config.DISCORD_GUILD_ID }, include: { settings: true } });
  const seasons = await prisma.communitySeason.findMany({ where: { guildId: record.id, status: "ACTIVE" }, select: { id: true, name: true, game: true, channelId: true, audienceRoleId: true } });
  const categories = channels.filter(c => c.type === ChannelType.GuildCategory && /community|communaut/i.test(c.name ?? ""));
  const communityChannels = channels.filter(c => "parent_id" in c && categories.some(category => category.id === c.parent_id));
  console.log(JSON.stringify({ language: record.settings?.language, categories: categories.map(c => ({ id: c.id, name: c.name })), channels: communityChannels.map(c => ({ id: c.id, name: c.name })), seasons }, null, 2));
  for (const channel of communityChannels) {
    if (channel.type !== ChannelType.GuildText || !/leaderboard|classement|standings/.test(channel.name)) continue;
    const pins = await rest.get(Routes.channelMessagesPins(channel.id)) as { items: { message: APIMessage }[] };
    const everyone = channel.permission_overwrites?.find(o => o.id === config.DISCORD_GUILD_ID);
    console.log(JSON.stringify({ channel: channel.name, readOnly: !!everyone && (BigInt(everyone.deny) & PermissionFlagsBits.SendMessages) !== 0n, pins: pins.items.filter(item => item.message.author.id === config.DISCORD_CLIENT_ID).map(item => ({ id: item.message.id, titles: item.message.embeds.map(e => e.title), links: item.message.components?.flatMap(row => "components" in row ? row.components.filter(c => "url" in c).map(c => "url" in c ? c.url : null) : []) })) }, null, 2));
  }
} catch {
  console.error("Community inventory unavailable. No changes made.");
  process.exitCode = 1;
} finally { await prisma.$disconnect(); }
