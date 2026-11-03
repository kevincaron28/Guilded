import type { Guild } from "discord.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { forEachGuildScope, guildWhere } from "./guild-scope.js";

// WoW guild rank to Discord role. Officers map a rank (0 = guild master) to a role with /mod rankroles;
// the sync then gives each member the role of their main character's rank. On by default, but it does
// nothing for a guild until a rank is mapped. It only ever adds or removes the roles that are mapped,
// never any other role, and never changes a member whose rank is unknown, stale or not mapped.

export const RANK_MAX_AGE_MS = 14 * 24 * 3600_000;

export interface RankRoleLink { rankIndex: number; discordRoleId: string }
export interface RankedCharacter { isMain: boolean; guildRankIndex: number | null; guildRankAt: Date | null }
export interface RankRoleChange { discordUserId: string; add: string[]; remove: string[] }

// The member's rank: their main character's, else their highest-ranking (lowest index) character.
// Ranks not refreshed in two weeks are ignored: an old rank may be wrong after a demotion or a leave.
export function memberRank(characters: readonly RankedCharacter[], now = new Date()): number | null {
  const fresh = characters.filter((c) => c.guildRankIndex !== null && c.guildRankAt !== null && now.getTime() - c.guildRankAt.getTime() <= RANK_MAX_AGE_MS);
  const main = fresh.find((c) => c.isMain);
  if (main) return main.guildRankIndex;
  return fresh.length ? Math.min(...fresh.map((c) => c.guildRankIndex as number)) : null;
}

export function planRankRoles(links: readonly RankRoleLink[], members: readonly { discordUserId: string; rank: number | null; roleIds: ReadonlySet<string> }[]): RankRoleChange[] {
  const byRank = new Map(links.map((link) => [link.rankIndex, link.discordRoleId]));
  const managed = new Set(links.map((link) => link.discordRoleId));
  const changes: RankRoleChange[] = [];
  for (const member of members) {
    const target = member.rank === null ? undefined : byRank.get(member.rank);
    if (!target) continue;
    const add = member.roleIds.has(target) ? [] : [target];
    const remove = [...managed].filter((role) => role !== target && member.roleIds.has(role));
    if (add.length || remove.length) changes.push({ discordUserId: member.discordUserId, add, remove });
  }
  return changes;
}

export interface RankRoleResult { changes: RankRoleChange[]; applied: number; failed: number; skipped: string | null }

// Plans (and, unless dryRun, applies) the role changes for one Discord server.
export async function syncRankRoles(prisma: PrismaClient, guild: Guild, options: { dryRun?: boolean; now?: Date } = {}): Promise<RankRoleResult> {
  const row = await prisma.guild.findUnique({ where: guildWhere(guild.id), select: { id: true, settings: { select: { rankRolesEnabled: true } } } });
  const none = (skipped: string | null): RankRoleResult => ({ changes: [], applied: 0, failed: 0, skipped });
  if (!row) return none("This server is not set up yet.");
  if (row.settings?.rankRolesEnabled === false) return none("Rank roles are turned off.");
  const links = await prisma.guildRankRole.findMany({ where: { guildId: row.id }, select: { rankIndex: true, discordRoleId: true } });
  if (!links.length) return none("No rank is mapped to a role yet.");
  const roles = links.map((link) => guild.roles.cache.get(link.discordRoleId));
  if (roles.some((role) => !role)) return none("A mapped role no longer exists. Map that rank again.");
  const blocked = roles.find((role) => role && !role.editable);
  if (blocked) return none(`I cannot manage the role ${blocked.name}: move my role above it.`);

  const people = await prisma.member.findMany({
    where: { guildId: row.id, status: "ACTIVE", isTest: false, characters: { some: { guildRankIndex: { not: null } } } },
    select: { discordUserId: true, characters: { select: { isMain: true, guildRankIndex: true, guildRankAt: true } } }
  });
  const members = [];
  for (const person of people) {
    const rank = memberRank(person.characters, options.now);
    if (rank === null) continue;
    const member = guild.members.cache.get(person.discordUserId) ?? await guild.members.fetch(person.discordUserId).catch(() => null);
    if (member) members.push({ discordUserId: person.discordUserId, rank, roleIds: new Set(member.roles.cache.keys()) });
  }
  const changes = planRankRoles(links, members);
  if (options.dryRun) return { changes, applied: 0, failed: 0, skipped: null };
  let applied = 0, failed = 0;
  for (const change of changes) {
    const member = guild.members.cache.get(change.discordUserId);
    if (!member) { failed++; continue; }
    try {
      if (change.add.length) await member.roles.add(change.add, "Guilded rank roles");
      if (change.remove.length) await member.roles.remove(change.remove, "Guilded rank roles");
      applied++;
    } catch { failed++; }
  }
  return { changes, applied, failed, skipped: null };
}

// The scheduled run: every server the bot is in, hourly.
export async function syncAllRankRoles(prisma: PrismaClient, guilds: Iterable<Guild>, report: (error: unknown) => void): Promise<void> {
  for (const guild of guilds) {
    await forEachGuildScope(prisma, guild.id, () => syncRankRoles(prisma, guild)).catch(report);
  }
}
