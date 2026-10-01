// Read-only inventory using existing bot credentials; no gateway login or writes.
import { REST, Routes, ChannelType, type APIChannel, type APIRole, type APIMessage } from "discord.js";
import { config } from "../src/config.js";
import { prisma } from "../src/database.js";

const rest = new REST({ version: "10", timeout: 10_000, retries: 0 }).setToken(config.DISCORD_TOKEN);
try {
  const [roles, channels, guild] = await Promise.all([
    rest.get(Routes.guildRoles(config.DISCORD_GUILD_ID)) as Promise<APIRole[]>,
    rest.get(Routes.guildChannels(config.DISCORD_GUILD_ID)) as Promise<APIChannel[]>,
    prisma.guild.findUnique({ where: { discordId: config.DISCORD_GUILD_ID }, include: { settings: true } })
  ]);
  const settings = guild?.settings;
  const games = roles.filter(role => /wow|warcraft|poe|exile|diablo|gaming/i.test(role.name));
  const name = (id: string | null | undefined) => channels.find(channel => channel.id === id)?.name ?? "non configuré";
  console.log(JSON.stringify({
    gameRoles: games.map(role => ({ id: role.id, name: role.name })),
    guildedWelcome: { channel: name(settings?.welcomeChannelId), delivery: settings?.welcomeDelivery, roles: settings?.welcomeRoleIds.map(id => roles.find(role => role.id === id)?.name ?? id) ?? [], hasCustomTemplate: !!settings?.welcomeMessageTemplate },
    carlPresent: roles.some(role => /carl.?bot/i.test(role.name)),
    candidateChannels: channels.filter(channel => channel.type === ChannelType.GuildText && /bienvenue|welcome|accueil|r[oô]les|roles|r[eè]gles/i.test(channel.name ?? "")).map(channel => ({ id: channel.id, name: channel.name }))
  }, null, 2));
  const candidates = channels.filter(channel => channel.type === ChannelType.GuildText && /bienvenue|welcome|accueil|r[oô]les|roles/i.test(channel.name ?? "")).slice(0, 6);
  for (const channel of candidates) {
    const messages = await rest.get(Routes.channelMessages(channel.id), { query: new URLSearchParams({ limit: "100" }) }) as APIMessage[];
    for (const message of messages.filter(message => /carl.?bot/i.test(message.author.username) || message.author.id === config.DISCORD_CLIENT_ID)) {
      const roleMentions = [...new Set((JSON.stringify({ content: message.content, embeds: message.embeds }).match(/<@&\d+>/g) ?? []))];
      console.log(JSON.stringify({ channel: channel.name, author: message.author.username, messageId: message.id, roleMentions, hasButtons: !!message.components?.length, reactions: message.reactions?.map(reaction => ({ emoji: reaction.emoji.name, count: reaction.count })) ?? [] }));
    }
  }
} catch {
  // Never print connection strings, request headers or message contents on failure.
  console.error("Inventaire Discord indisponible; aucun réglage modifié.");
  process.exitCode = 1;
} finally { await prisma.$disconnect(); }
