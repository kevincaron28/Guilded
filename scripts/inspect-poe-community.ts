// Read-only inventory. Does not start a gateway client or print credentials/logs.
import { REST, Routes, ChannelType, PermissionFlagsBits, type APIChannel, type APIRole } from "discord.js";
import { config } from "../src/config.js";
import { prisma } from "../src/database.js";

try {
  const rest = new REST({ version: "10", timeout: 10000, retries: 0 }).setToken(config.DISCORD_TOKEN);
  const channels = await rest.get(Routes.guildChannels(config.DISCORD_GUILD_ID)) as APIChannel[];
  const roles = await rest.get(Routes.guildRoles(config.DISCORD_GUILD_ID)) as APIRole[];
  const gameRoles = roles.filter(r => /path.*exile|poe.?2/i.test(r.name));
  const categories = channels.filter(c => c.type === ChannelType.GuildCategory && /path.*exile|poe.?2/i.test(c.name ?? ""));
  const relevant = channels.filter(c => categories.some(p => p.id === c.id || "parent_id" in c && c.parent_id === p.id) || "permission_overwrites" in c && c.permission_overwrites?.some(o => gameRoles.some(r => r.id === o.id)));
  const guild = await prisma.guild.findUniqueOrThrow({ where: { discordId: config.DISCORD_GUILD_ID }, select: { id: true, name: true, settings: { select: { poeTrackingEnabled: true, language: true } } } });
  const observations = await prisma.poeMapVisit.groupBy({ by: ["league", "mode"], where: { guildId: guild.id }, _count: true, _max: { startedAt: true } });
  const seasons = await prisma.communitySeason.findMany({ where: { guildId: guild.id, game: "POE2" }, select: { name: true, status: true, channelId: true, audienceRoleId: true } });
  console.log(JSON.stringify({ guild: guild.name, settings: guild.settings, roles: gameRoles.map(r => ({ id: r.id, name: r.name, managed: r.managed })), categories: categories.map(c => ({ id: c.id, name: c.name })), observations, seasons }, null, 2));
  for (const c of relevant) {
    const overwrites = "permission_overwrites" in c ? c.permission_overwrites ?? [] : [];
    console.log(JSON.stringify({ id: c.id, name: "name" in c ? c.name : undefined, type: c.type, parent: "parent_id" in c ? c.parent_id : undefined,
      explicitViewGrants: overwrites.filter(o => (BigInt(o.allow) & PermissionFlagsBits.ViewChannel) !== 0n).map(o => roles.find(r => r.id === o.id)?.name ?? "member override"),
      everyoneViewDenied: overwrites.some(o => o.id === config.DISCORD_GUILD_ID && (BigInt(o.deny) & PermissionFlagsBits.ViewChannel) !== 0n) }));
  }
} catch {
  console.error("PoE2 inventory unavailable. No changes made."); process.exitCode = 1;
} finally { await prisma.$disconnect(); }
