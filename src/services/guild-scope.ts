import { AsyncLocalStorage } from "node:async_hooks";
import type { Guild, Prisma, PrismaClient } from "../generated/prisma/client.js";

export interface GuildScope {
  guild: Guild;
  permissionRoles?: Record<string, string>;
  memberRoleId?: string | null;
}
const context = new AsyncLocalStorage<GuildScope>();
export const currentGuildScope = () => context.getStore();
export const runInGuildScope = <T>(scope: GuildScope, work: () => T): T => context.run(scope, work);
// Discord collectors emit later from a different request. Capture the originating
// guild now so changing /wow use cannot redirect an open setup/reset/core wizard.
export const bindGuildScope = AsyncLocalStorage.bind;

/** A Discord lookup follows the current request/job; an unscoped lookup is legacy/default. */
export function guildWhere(discordId: string): Prisma.GuildWhereUniqueInput {
  const scope = currentGuildScope();
  return scope?.guild.discordId === discordId ? { id: scope.guild.id } : { discordId_scopeKey: { discordId, scopeKey: "default" } };
}

export async function loadGuildScope(database: Pick<PrismaClient, "guild">, guildId: string, discordId?: string): Promise<GuildScope> {
  const guild = await database.guild.findFirst({ where: { id: guildId, ...(discordId ? { discordId } : {}) }, include: { wowSpace: true } });
  if (!guild) throw new Error("That in-game guild is not available in this Discord server.");
  const roles = guild.wowSpace?.permissionRoles;
  return { guild, ...(guild.scopeKey !== "default" ? {
    permissionRoles: roles && typeof roles === "object" && !Array.isArray(roles) ? Object.fromEntries(Object.entries(roles).filter((entry): entry is [string, string] => typeof entry[1] === "string")) : {},
    memberRoleId: guild.wowSpace?.memberRoleId ?? null
  } : {}) };
}

export async function withGuildScope<T>(database: Pick<PrismaClient, "guild">, guildId: string, work: () => Promise<T>): Promise<T> {
  return runInGuildScope(await loadGuildScope(database, guildId), work);
}

export async function forEachGuildScope(database: Pick<PrismaClient, "guild">, discordId: string, work: () => Promise<unknown>): Promise<void> {
  const scopes = await database.guild.findMany({ where: { discordId }, select: { id: true } });
  for (const scope of scopes) await withGuildScope(database, scope.id, work);
}

/** Existing message buttons keep their owning guild even after /wow use changes. */
export async function entityGuildScope(database: PrismaClient, discordId: string, customId: string): Promise<GuildScope | null> {
  const [prefix, first, second, third] = customId.split(":");
  let row: { guildId: string } | null = null;
  if (prefix === "raidsignup" && first) row = await database.raid.findUnique({ where: { id: first }, select: { guildId: true } });
  if (prefix === "epaward" && second) row = await database.raid.findUnique({ where: { id: second }, select: { guildId: true } });
  if (prefix === "dgrp" && first) row = await database.dungeonGroup.findUnique({ where: { id: first }, select: { guildId: true } });
  if (prefix === "poll" && first) row = await database.poll.findUnique({ where: { id: first }, select: { guildId: true } });
  if (prefix === "craft" && first && !["new", "new-modal"].includes(first)) row = await database.craftRequest.findUnique({ where: { id: first }, select: { guildId: true } });
  if (prefix === "apply-form" && second && first !== "decide") row = await database.raidCore.findUnique({ where: { id: second }, select: { guildId: true } });
  if (prefix === "apply-form" && first === "decide" && third) row = await database.application.findUnique({ where: { id: third }, select: { guildId: true } });
  if (prefix === "webapply" && second) {
    const application = await database.recruitmentApplication.findUnique({ where: { id: second }, select: { listing: { select: { guildId: true } } } });
    row = application?.listing ?? null;
  }
  return row ? loadGuildScope(database, row.guildId, discordId) : null;
}

/** Channel binding takes precedence over a member's explicit default. */
export async function interactionGuildScope(database: PrismaClient, input: { discordId: string; userId: string; channelId?: string | null; parentId?: string | null }): Promise<GuildScope | null> {
  const channelIds = [input.channelId, input.parentId].filter((id): id is string => Boolean(id));
  for (const channelId of channelIds) {
    const binding = await database.wowGuildChannel.findUnique({ where: { discordId_channelId: { discordId: input.discordId, channelId } } });
    if (binding) return loadGuildScope(database, binding.scopeGuildId, input.discordId);
  }
  // Setup/core channels retain their guild even if a different member presses a button.
  const settingsFields = ["raidSignupChannelId", "logChannelId", "notifyChannelId", "weeklyReportChannelId", "answerChannelId", "dungeonChannelId", "dungeonLeaderboardChannelId", "dungeonSignupChannelId", "raidLogChannelId", "lootChannelId", "craftChannelId", "readinessChannelId", "coreChannelId", "applicationChannelId", "attendanceChannelId", "guideChannelId", "pugChannelId"] as const;
  if (channelIds.length) {
    const [settings, cores] = await Promise.all([
      database.guildSettings.findMany({ where: { guild: { discordId: input.discordId }, OR: settingsFields.map(field => ({ [field]: { in: channelIds } })) }, select: { guildId: true } }),
      database.raidCore.findMany({ where: { guild: { discordId: input.discordId }, OR: ["categoryId", "rosterChannelId", "signupChannelId", "lootChannelId", "raidLogChannelId", "chatChannelId", "voiceChannelId", "attendanceChannelId"].map(field => ({ [field]: { in: channelIds } })) }, select: { guildId: true } })
    ]);
    const owners = [...new Set([...settings, ...cores].map(row => row.guildId))];
    if (owners.length > 1) throw new Error("Several guilds use this channel. An officer must bind it with /wow channel.");
    if (owners[0]) return loadGuildScope(database, owners[0], input.discordId);
  }
  const choice = await database.wowGuildSelection.findUnique({ where: { discordId_userId: { discordId: input.discordId, userId: input.userId } } });
  if (choice) return loadGuildScope(database, choice.scopeGuildId, input.discordId);
  // Existing server workflows continue to use the default Forever space.
  return null;
}
