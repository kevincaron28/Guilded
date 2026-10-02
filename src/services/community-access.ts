import { PermissionFlagsBits, type Guild, type GuildMember } from "discord.js";
import type { CommunitySeason, PrismaClient } from "@prisma/client";
import { hasPermission } from "../permissions.js";
import { communityActivityChannel } from "./community-display.js";

export function canAccessCommunity(member: GuildMember, season: Pick<CommunitySeason, "audienceRoleId">, canView: boolean): boolean {
  return !member.user.bot && canView && (!season.audienceRoleId || member.roles.cache.has(season.audienceRoleId) || hasPermission(member, "officer"));
}

export async function assertCommunityChannelAudience(guild: Guild, sourceId: string, destinationId: string) {
  if (sourceId === destinationId) return;
  const source = await guild.channels.fetch(sourceId, { force: true });
  const target = await guild.channels.fetch(destinationId, { force: true });
  const shape = (channel: typeof source) => channel && "permissionOverwrites" in channel
    ? [...channel.permissionOverwrites.cache.values()].filter(o => o.id !== guild.client.user!.id)
      .map(o => `${o.type}:${o.id}:${o.allow.bitfield & PermissionFlagsBits.ViewChannel}:${o.deny.bitfield & PermissionFlagsBits.ViewChannel}`)
      .filter(s => !s.endsWith(":0:0")).sort().join("|") : null;
  const sourceShape = shape(source);
  if (sourceShape === null || sourceShape !== shape(target)) throw new Error("Les salons doivent avoir la même visibilité / Channels must have the same visibility.");
}

export async function communityAccess(guild: Guild, userId: string, season: CommunitySeason, organizer = false, destination?: string) {
  const member = await guild.members.fetch({ user: userId, force: true });
  const channel = await guild.channels.fetch(season.channelId);
  let visible = !!channel?.permissionsFor(member)?.has(PermissionFlagsBits.ViewChannel);
  if (destination && destination !== season.channelId) {
    const target = await guild.channels.fetch(destination);
    visible = visible && !!target?.permissionsFor(member)?.has(PermissionFlagsBits.ViewChannel);
  }
  if (!canAccessCommunity(member, season, visible) || organizer && !hasPermission(member, "officer")) throw new Error("Accès refusé / Access denied.");
  return member;
}

export async function accessibleCommunitySeasons(database: PrismaClient, guild: Guild, guildId: string, userId: string) {
  const member = await guild.members.fetch({ user: userId, force: true });
  if (member.user.bot) return [];
  const channels = await guild.channels.fetch();
  const visible = channels.filter(c => !!c?.permissionsFor(member)?.has(PermissionFlagsBits.ViewChannel)).map(c => c!.id);
  return database.communitySeason.findMany({ where: { guildId, channelId: { in: visible }, ...(hasPermission(member, "officer") ? {} : { OR: [{ audienceRoleId: null }, { audienceRoleId: { in: [...member.roles.cache.keys()] } }] }) }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
}

export async function resolveCommunitySeason(database: PrismaClient, guild: Guild, guildId: string, userId: string, id: string | null, organizer = false) {
  if (id) {
    const row = await database.communitySeason.findFirst({ where: { id, guildId } });
    if (!row) throw new Error("Saison introuvable / Season not found.");
    await communityAccess(guild, userId, row, organizer);
    return row;
  }
  if (organizer) throw new Error("Choisis une saison / Select a season.");
  const seasons = (await accessibleCommunitySeasons(database, guild, guildId, userId)).filter(s => s.game === "DISCORD" && s.status === "ACTIVE");
  if (seasons.length !== 1) throw new Error("Aucune saison Discord active accessible. Consulte /community seasons / No accessible active Discord season. See /community seasons.");
  return seasons[0]!;
}

export async function accessibleCommunityActivities(database: PrismaClient, guild: Guild, guildId: string, userId: string, seasonId?: string) {
  const seasons = await accessibleCommunitySeasons(database, guild, guildId, userId);
  const rows = await database.communityActivity.findMany({ where: { seasonId: { in: seasons.filter(s => !seasonId || s.id === seasonId).map(s => s.id) }, kind: { not: "DICE" } }, include: { season: true }, orderBy: [{ endsAt: "asc" }, { id: "asc" }] });
  const member = await guild.members.fetch({ user: userId, force: true });
  const channels = await guild.channels.fetch();
  return rows.filter(row => !!channels.get(communityActivityChannel(row))?.permissionsFor(member)?.has(PermissionFlagsBits.ViewChannel));
}

export async function accessibleCommunityPolls(database: PrismaClient, guild: Guild, guildId: string, userId: string, season: CommunitySeason, now = new Date()) {
  const member = await communityAccess(guild, userId, season);
  const channels = await guild.channels.fetch();
  const destinations = new Set([season.channelId, season.announcementChannelId ?? season.channelId]);
  const visible = channels.filter(c => !!c && destinations.has(c.id) && !!c.permissionsFor(member)?.has(PermissionFlagsBits.ViewChannel)).map(c => c!.id);
  return database.poll.findMany({ where: { guildId, channelId: { in: visible }, messageId: { not: null }, closed: false, OR: [{ closesAt: null }, { closesAt: { gt: now } }] }, orderBy: { createdAt: "desc" }, take: 5 });
}
