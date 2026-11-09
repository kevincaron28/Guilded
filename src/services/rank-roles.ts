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

interface PlanOptions { now?: Date; links?: readonly RankRoleLink[]; ignoreEnabled?: boolean }

// What the sync would change for one Discord server. links/ignoreEnabled: a preview of a mapping or a
// switch the officer has not confirmed yet (previewRankRoles).
async function planGuildRankRoles(prisma: PrismaClient, guild: Guild, options: PlanOptions): Promise<{ changes: RankRoleChange[]; skipped: string | null; links: readonly RankRoleLink[] }> {
  const row = await prisma.guild.findUnique({ where: guildWhere(guild.id), select: { id: true, settings: { select: { rankRolesEnabled: true } } } });
  const none = (skipped: string) => ({ changes: [], skipped, links: [] });
  if (!row) return none("This server is not set up yet.");
  if (!options.ignoreEnabled && row.settings?.rankRolesEnabled === false) return none("Rank roles are turned off.");
  const links = options.links ?? await prisma.guildRankRole.findMany({ where: { guildId: row.id }, select: { rankIndex: true, discordRoleId: true } });
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
  return { changes: planRankRoles(links, members), skipped: null, links };
}

// Plans (and, unless dryRun, applies) the role changes for one Discord server.
export async function syncRankRoles(prisma: PrismaClient, guild: Guild, options: { dryRun?: boolean; now?: Date } = {}): Promise<RankRoleResult> {
  const { changes, skipped } = await planGuildRankRoles(prisma, guild, options.now ? { now: options.now } : {});
  if (skipped) return { changes: [], applied: 0, failed: 0, skipped };
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

export interface RankRolePreviewRole { discordRoleId: string; rankIndex: number; gain: string[] }
export interface RankRolePreview { skipped: string | null; roles: RankRolePreviewRole[]; lose: number; changes: number }

/**
 * Who would get each mapped role, before anything is saved (9.1, docs/JEEVES_COMPARISON.md idea 2):
 * /mod rankroles set and turning rank roles back on show this and wait for the officer's confirm.
 * `links` is the mapping as it would be; the on/off switch is ignored (it is what is being decided).
 */
export async function previewRankRoles(prisma: PrismaClient, guild: Guild, links: readonly RankRoleLink[], now?: Date): Promise<RankRolePreview> {
  const plan = await planGuildRankRoles(prisma, guild, { links, ignoreEnabled: true, ...(now ? { now } : {}) });
  if (plan.skipped) return { skipped: plan.skipped, roles: [], lose: 0, changes: 0 };
  const name = (id: string) => guild.members.cache.get(id)?.displayName ?? id;
  const roles = [...plan.links].sort((a, b) => a.rankIndex - b.rankIndex).map((link) => ({
    discordRoleId: link.discordRoleId, rankIndex: link.rankIndex,
    gain: plan.changes.filter((change) => change.add.includes(link.discordRoleId)).map((change) => name(change.discordUserId)).sort((a, b) => a.localeCompare(b))
  }));
  return { skipped: null, roles, lose: plan.changes.filter((change) => change.remove.length).length, changes: plan.changes.length };
}

/** The preview as Discord text (English, like the rest of /mod rankroles). `focus` = the rank being mapped. */
export function formatRankRolePreview(preview: RankRolePreview, focus?: number): string {
  if (preview.skipped) return preview.skipped;
  const sample = (names: string[]) => names.length ? ` (${names.slice(0, 5).map((n) => n.replace(/[*_~`|]/g, "").slice(0, 24)).join(", ")}${names.length > 5 ? `, +${names.length - 5}` : ""})` : "";
  const rows = preview.roles.filter((role) => focus === undefined || role.rankIndex === focus);
  const lines = rows.map((role) => `• Rank ${role.rankIndex} → <@&${role.discordRoleId}>: **${role.gain.length}** member(s) would get it${sample(role.gain)}`);
  if (preview.lose) lines.push(`• ${preview.lose} member(s) would lose a mapped rank role that no longer matches their rank.`);
  if (!preview.changes) lines.push("• Nobody would change: everyone with a fresh rank already has the right role.");
  lines.push("-# Only members whose rank an officer's upload saw in the last 2 weeks are counted; everyone else is left alone.");
  return lines.join("\n");
}

// The scheduled run: every server the bot is in, hourly.
export async function syncAllRankRoles(prisma: PrismaClient, guilds: Iterable<Guild>, report: (error: unknown) => void): Promise<void> {
  for (const guild of guilds) {
    await forEachGuildScope(prisma, guild.id, () => syncRankRoles(prisma, guild)).catch(report);
  }
}
