import type { Client } from "discord.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { hasPermission } from "../permissions.js";
import { loadGuildScope, runInGuildScope } from "./guild-scope.js";
import { gameEditionOf } from "./game-edition.js";
import type { RosterGuild } from "./roster-dashboard-store.js";

// Shared by the private, read-only guild pages. Matches /officer export.
export function guildDashboardAccess(database: PrismaClient, client: Client | undefined, allows: (discordId: string) => boolean) {
  async function authorize(userId: string, guildId: string): Promise<RosterGuild | null> {
    if (!client?.isReady()) return null;
    const member = await database.member.findFirst({ where: { guildId, discordUserId: userId, status: "ACTIVE", isTest: false }, select: { id: true } });
    if (!member) return null;
    const scope = await loadGuildScope(database, guildId);
    if (!allows(scope.guild.discordId)) return null;
    const discordGuild = await client.guilds.fetch(scope.guild.discordId).catch(() => null);
    const discordMember = await discordGuild?.members.fetch({ user: userId, force: true }).catch(() => null);
    if (!discordMember) return null;
    if (scope.memberRoleId && !discordMember.permissions.has("Administrator") && !discordMember.roles.cache.has(scope.memberRoleId)) return null;
    if (!runInGuildScope(scope, () => hasPermission(discordMember, "officer"))) return null;
    return { id: scope.guild.id, name: scope.guild.name, edition: gameEditionOf(scope.guild) };
  }
  async function guilds(userId: string) {
    const memberships = await database.member.findMany({ where: { discordUserId: userId, status: "ACTIVE", isTest: false }, select: { guildId: true }, orderBy: { guildId: "asc" }, take: 100 });
    const result: RosterGuild[] = [];
    for (const membership of memberships) {
      const guild = await authorize(userId, membership.guildId);
      if (guild) result.push(guild);
    }
    return result;
  }
  return { authorize, guilds };
}
export type GuildDashboardAccess = ReturnType<typeof guildDashboardAccess>;
