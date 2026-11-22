import type { Guild } from "discord.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { characterKey } from "../../companion/character-identity.mjs";
import { forEachGuildScope, guildWhere } from "./guild-scope.js";
import type { OnlyMember } from "./nickname-sync.js";

// WoW guild rank to Discord role. Officers map a rank (0 = guild master) to a role with /mod rankroles;
// the sync then gives each member the role of their best rank. On by default, but it does nothing for a
// guild until a rank is mapped. It only ever adds or removes the roles that are mapped, never any other
// role, and never changes a member whose rank is unknown or stale.
//
// Rules (21 Nov 2026, owner: "if an officer is removed in game remove the role only; two officer characters must not break it"):
//   * A member's rank = the BEST (lowest index) fresh rank among all their linked characters, main or alt. Detached
//     (unlinked) characters never count, nor a character the roster says left the guild.
//   * Member's rank is mapped to role T: they get T, and lose the other mapped roles (one rank role at a time).
//   * Member's rank is not mapped: they lose a mapped role R only when their rank is BELOW every rank mapped to R
//     (index > top(R), the highest index mapped to R): a demoted officer loses @Officer and gets nothing else; a guild
//     master or co-GM above the officer rank keeps whatever they have and is given nothing.
//   * Every linked character left the guild (newest complete roster, within two weeks, after the last rank reading):
//     the member loses every mapped role.
//   * Removals are held for the whole run when the guild's rank data looks partial (fewer than half of the ranked
//     characters refreshed in the last 48 h), capped at MAX_REMOVALS_PER_RUN, and each one is written to the officer log.

export const RANK_MAX_AGE_MS = 14 * 24 * 3600_000;
/** The partial-roster guard's window: at least half of the fresh ranks must have been confirmed this recently. */
export const RANK_RECENT_MS = 48 * 3600_000;
/** At most this many members lose a rank role per run (hourly); the rest follow on the next runs. */
export const MAX_REMOVALS_PER_RUN = 5;

export interface RankRoleLink { rankIndex: number; discordRoleId: string }
export interface RankedCharacter {
  isMain?: boolean; guildRankIndex: number | null; guildRankAt: Date | null; guildRankName?: string | null;
  /** The roster says this character left the guild after its last rank reading: its rank no longer counts. */
  left?: boolean;
}
export interface BestRank { index: number; name: string | null }
export interface RankRoleChange {
  discordUserId: string; add: string[]; remove: string[];
  /** Why roles are removed (officer log): the member's best fresh rank, or `left` when every character left the guild. */
  best?: BestRank | null; left?: boolean;
}

const freshRank = (c: RankedCharacter, now: Date) => !c.left && c.guildRankIndex !== null && c.guildRankAt !== null && now.getTime() - c.guildRankAt.getTime() <= RANK_MAX_AGE_MS;

/** The member's best (lowest index) fresh rank among all their characters, with its name. Null without a fresh rank. */
export function bestRank(characters: readonly RankedCharacter[], now = new Date()): BestRank | null {
  let best: RankedCharacter | null = null;
  for (const c of characters) if (freshRank(c, now) && (!best || (c.guildRankIndex as number) < (best.guildRankIndex as number))) best = c;
  return best ? { index: best.guildRankIndex as number, name: best.guildRankName?.trim() || null } : null;
}

// Ranks not refreshed in two weeks are ignored: an old rank may be wrong after a demotion or a leave.
export function memberRank(characters: readonly RankedCharacter[], now = new Date()): number | null {
  return bestRank(characters, now)?.index ?? null;
}

/** Every linked character left the guild (none still listed or unknown). */
export function allCharactersLeft(characters: readonly RankedCharacter[]): boolean {
  return characters.length > 0 && characters.every((c) => c.left === true);
}

export interface RankRoleMember { discordUserId: string; rank: number | null; roleIds: ReadonlySet<string>; left?: boolean; best?: BestRank | null }

export function planRankRoles(links: readonly RankRoleLink[], members: readonly RankRoleMember[]): RankRoleChange[] {
  const byRank = new Map(links.map((link) => [link.rankIndex, link.discordRoleId]));
  const top = new Map<string, number>();
  for (const link of links) top.set(link.discordRoleId, Math.max(top.get(link.discordRoleId) ?? -1, link.rankIndex));
  const managed = [...top.keys()];
  const changes: RankRoleChange[] = [];
  for (const member of members) {
    const held = managed.filter((role) => member.roleIds.has(role));
    if (member.left) {
      if (held.length) changes.push({ discordUserId: member.discordUserId, add: [], remove: held, left: true, best: null });
      continue;
    }
    if (member.rank === null) continue;
    const rank = member.rank;
    const target = byRank.get(rank);
    const add = target && !member.roleIds.has(target) ? [target] : [];
    const remove = target ? held.filter((role) => role !== target) : held.filter((role) => rank > (top.get(role) as number));
    if (add.length || remove.length) changes.push({ discordUserId: member.discordUserId, add, remove, best: member.best ?? { index: rank, name: null } });
  }
  return changes;
}

/**
 * The safety rails on removals: none at all while `blocked` (a reason), else at most `cap` members per run.
 * Additions are never held. Returns the changes that may run now and how many removals wait.
 */
export function limitRemovals(changes: readonly RankRoleChange[], blocked: string | null, cap = MAX_REMOVALS_PER_RUN): { changes: RankRoleChange[]; held: number } {
  let allowed = 0, held = 0;
  const out: RankRoleChange[] = [];
  for (const change of changes) {
    if (change.remove.length && (blocked || allowed >= cap)) {
      held++;
      if (change.add.length) out.push({ ...change, remove: [] });
      continue;
    }
    if (change.remove.length) allowed++;
    out.push(change);
  }
  return { changes: out, held };
}

/** The officer-log line for one removed rank role (server language). Mentions are shown, never pinged. */
export function rankRoleRemovalLine(lang: "en" | "fr", discordUserId: string, roleId: string, why: { left: true } | { rankName: string; bestName: string }): string {
  if ("left" in why) {
    return lang === "fr" ? `<@${discordUserId}> a perdu <@&${roleId}> : tous ses personnages ont quitté la guilde.`
      : `<@${discordUserId}> lost <@&${roleId}>: all their characters left the guild.`;
  }
  return lang === "fr" ? `<@${discordUserId}> a perdu <@&${roleId}> : plus aucun personnage au rang ${why.rankName} (meilleur : ${why.bestName}).`
    : `<@${discordUserId}> lost <@&${roleId}>: no character at rank ${why.rankName} anymore (best: ${why.bestName}).`;
}

export interface RankRoleResult {
  changes: RankRoleChange[]; applied: number; failed: number; skipped: string | null;
  /** Removals not made this run (partial roster or the per-run cap), and why. */
  held?: number; heldReason?: string | null;
}

interface PlanOptions { now?: Date; links?: readonly RankRoleLink[]; ignoreEnabled?: boolean; only?: OnlyMember }
interface GuildPlan {
  changes: RankRoleChange[]; skipped: string | null; links: readonly RankRoleLink[]; held: number; heldReason: string | null;
  /** Rank index to its in-game name, from the freshest reading (officer-log wording). */
  rankNames: Map<number, string>; lang: "en" | "fr"; logChannelId: string | null;
}

export const PARTIAL_ROSTER_REASON = "fewer than half of the guild's ranked characters were refreshed by an officer's roster in the last 48 h (partial roster?), so nobody loses a role this run";
const capReason = (cap: number) => `at most ${cap} members lose a rank role per run; the rest follow on the next hourly runs`;

// What the sync would change for one Discord server. links/ignoreEnabled: a preview of a mapping or a
// switch the officer has not confirmed yet (previewRankRoles).
async function planGuildRankRoles(prisma: PrismaClient, guild: Guild, options: PlanOptions): Promise<GuildPlan> {
  const row = await prisma.guild.findUnique({ where: guildWhere(guild.id), select: { id: true, settings: { select: { rankRolesEnabled: true, language: true, logChannelId: true } } } });
  const lang = row?.settings?.language === "fr" ? "fr" : "en";
  const none = (skipped: string): GuildPlan => ({ changes: [], skipped, links: [], held: 0, heldReason: null, rankNames: new Map(), lang, logChannelId: null });
  if (!row) return none("This server is not set up yet.");
  if (!options.ignoreEnabled && row.settings?.rankRolesEnabled === false) return none("Rank roles are turned off.");
  const links = options.links ?? await prisma.guildRankRole.findMany({ where: { guildId: row.id }, select: { rankIndex: true, discordRoleId: true } });
  if (!links.length) return none("No rank is mapped to a role yet.");
  const roles = links.map((link) => guild.roles.cache.get(link.discordRoleId));
  if (roles.some((role) => !role)) return none("A mapped role no longer exists. Map that rank again.");
  const blocked = roles.find((role) => role && !role.editable);
  if (blocked) return none(`I cannot manage the role ${blocked.name}: move my role above it.`);
  const now = options.now ?? new Date();

  // Only members with a linked (not detached) character that has a rank: Discord-only officers and members without
  // a character are never in this list, so they are never touched.
  const people = await prisma.member.findMany({
    where: { guildId: row.id, ...(!options.only ? {} : "memberId" in options.only ? { id: options.only.memberId } : { discordUserId: options.only.discordUserId }), status: "ACTIVE", isTest: false,
      characters: { some: { detachedAt: null, guildRankIndex: { not: null } } } },
    select: { discordUserId: true, characters: { where: { detachedAt: null }, select: { isMain: true, name: true, wowId: true, gameEdition: true, guildRankIndex: true, guildRankName: true, guildRankAt: true } } }
  });
  const plan: GuildPlan = { changes: [], skipped: null, links, held: 0, heldReason: null, rankNames: new Map(), lang, logChannelId: row.settings?.logChannelId ?? null };
  if (!people.length) return plan;

  // "Left the guild": the roster row is marked gone only by the newest COMPLETE roster (guild-data.ts). It counts when that
  // reading is within two weeks and newer than the character's last rank reading (a later roster that saw them would have
  // put them back in the guild).
  const departures = await prisma.guildRosterEntry.findMany({ where: { guildId: row.id, inGuild: false, observedAt: { gte: new Date(now.getTime() - RANK_MAX_AGE_MS) } },
    select: { nameKey: true, wowId: true, gameEdition: true, observedAt: true } });
  const goneByName = new Map(departures.map((d) => [`${d.gameEdition}|${d.nameKey}`, d]));
  const goneById = new Map(departures.filter((d) => d.wowId !== null).map((d) => [`${d.gameEdition}|${String(d.wowId)}`, d]));
  const departed = (c: { name: string; wowId: bigint | null; gameEdition: string; guildRankAt: Date | null }) => {
    const byId = c.wowId !== null ? goneById.get(`${c.gameEdition}|${String(c.wowId)}`) : undefined;
    const byName = goneByName.get(`${c.gameEdition}|${String(characterKey(c.name, "", c.gameEdition))}`);
    const entry = byId ?? (byName && (byName.wowId === null || c.wowId === null || byName.wowId === c.wowId) ? byName : undefined);
    return !!entry && (!c.guildRankAt || entry.observedAt >= c.guildRankAt);
  };

  const namesAt = new Map<number, number>();
  const members: RankRoleMember[] = [];
  for (const person of people) {
    const characters = person.characters.map((c) => ({ ...c, left: departed(c) }));
    for (const c of characters) {
      const name = c.guildRankName?.trim();
      if (c.guildRankIndex === null || !name || !c.guildRankAt) continue;
      if ((namesAt.get(c.guildRankIndex) ?? -1) < c.guildRankAt.getTime()) { namesAt.set(c.guildRankIndex, c.guildRankAt.getTime()); plan.rankNames.set(c.guildRankIndex, name); }
    }
    const left = allCharactersLeft(characters);
    const best = bestRank(characters, now);
    if (!left && !best) continue;   // nothing fresh: never act on stale data
    const member = guild.members.cache.get(person.discordUserId) ?? await guild.members.fetch(person.discordUserId).catch(() => null);
    if (member) members.push({ discordUserId: person.discordUserId, rank: best?.index ?? null, best, left, roleIds: new Set(member.roles.cache.keys()) });
  }
  const changes = planRankRoles(links, members);
  if (!changes.some((change) => change.remove.length)) { plan.changes = changes; return plan; }

  // Partial-roster guard (only read when something would be removed). The stored roster keeps no "complete" flag, so the
  // signal is the ranks themselves: an officer's full roster confirms every listed character's rank (guildRankAt), so when
  // fewer than half of the guild's fresh ranks were confirmed in the last 48 h, the latest readings are partial or old.
  const ranked = await prisma.character.findMany({
    where: { detachedAt: null, guildRankIndex: { not: null }, guildRankAt: { gte: new Date(now.getTime() - RANK_MAX_AGE_MS) }, member: { guildId: row.id, status: "ACTIVE", isTest: false } },
    select: { guildRankAt: true }
  });
  const recent = ranked.filter((c) => c.guildRankAt && now.getTime() - c.guildRankAt.getTime() <= RANK_RECENT_MS).length;
  const partial = !ranked.length || recent * 2 < ranked.length;
  // The in-game names of the mapped ranks for the officer log, from the roster table (everyone in the guild), when no
  // linked character at that rank told us already (a demoted guild's only officer).
  const unnamed = [...new Set(links.map((link) => link.rankIndex))].filter((index) => !plan.rankNames.has(index));
  if (unnamed.length) {
    const named = await prisma.guildRosterEntry.findMany({ where: { guildId: row.id, inGuild: true, rankIndex: { in: unnamed }, rankName: { not: null } },
      orderBy: { observedAt: "desc" }, distinct: ["rankIndex"], select: { rankIndex: true, rankName: true } });
    for (const entry of named) if (entry.rankIndex !== null && entry.rankName?.trim()) plan.rankNames.set(entry.rankIndex, entry.rankName.trim());
  }
  const limited = limitRemovals(changes, partial ? PARTIAL_ROSTER_REASON : null);
  plan.changes = limited.changes;
  plan.held = limited.held;
  plan.heldReason = !limited.held ? null : partial ? PARTIAL_ROSTER_REASON : capReason(MAX_REMOVALS_PER_RUN);
  return plan;
}

function removalLines(plan: GuildPlan, change: RankRoleChange): string[] {
  const top = new Map<string, number>();
  for (const link of plan.links) top.set(link.discordRoleId, Math.max(top.get(link.discordRoleId) ?? -1, link.rankIndex));
  // Unknown name: the number ("no character at rank 2 anymore").
  const rankName = (index: number | undefined) => index === undefined ? "?" : plan.rankNames.get(index) ?? String(index);
  return change.remove.map((roleId) => change.left ? rankRoleRemovalLine(plan.lang, change.discordUserId, roleId, { left: true })
    : rankRoleRemovalLine(plan.lang, change.discordUserId, roleId, { rankName: rankName(top.get(roleId)), bestName: change.best?.name ?? rankName(change.best?.index) }));
}

/** One officer-log message for the removals a run made. Never throws (logging must not break the sync). */
async function logRemovals(guild: Guild, channelId: string | null, lines: string[]): Promise<void> {
  if (!channelId || !lines.length) return;
  try {
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased() || !("send" in channel)) return;
    await channel.send({ content: lines.join("\n").slice(0, 1990), allowedMentions: { parse: [] } });
  } catch (error) {
    console.error("Rank role removal log failed", error);
  }
}

// Plans (and, unless dryRun, applies) the role changes for one Discord server.
export async function syncRankRoles(prisma: PrismaClient, guild: Guild, options: { dryRun?: boolean; now?: Date; only?: OnlyMember } = {}): Promise<RankRoleResult> {
  const plan = await planGuildRankRoles(prisma, guild, { ...(options.now ? { now: options.now } : {}), ...(options.only ? { only: options.only } : {}) });
  const { changes, skipped, held, heldReason } = plan;
  if (skipped) return { changes: [], applied: 0, failed: 0, skipped, held: 0, heldReason: null };
  if (options.dryRun) return { changes, applied: 0, failed: 0, skipped: null, held, heldReason };
  let applied = 0, failed = 0;
  const lines: string[] = [];
  for (const change of changes) {
    const member = guild.members.cache.get(change.discordUserId);
    if (!member) { failed++; continue; }
    try {
      if (change.add.length) await member.roles.add(change.add, "Guilded rank roles");
      if (change.remove.length) {
        await member.roles.remove(change.remove, "Guilded rank roles");
        lines.push(...removalLines(plan, change));
      }
      applied++;
    } catch { failed++; }
  }
  await logRemovals(guild, plan.logChannelId, lines);
  return { changes, applied, failed, skipped: null, held, heldReason };
}

/** One member's rank role, right now (event-driven refresh): the same plan as the full pass, limited to this member. */
export function syncMemberRankRole(prisma: PrismaClient, guild: Guild, who: string | { memberId: string }): Promise<RankRoleResult> {
  return syncRankRoles(prisma, guild, { only: typeof who === "string" ? { discordUserId: who } : who });
}

export interface RankRolePreviewRole { discordRoleId: string; rankIndex: number; gain: string[] }
export interface RankRolePreviewLoss { discordRoleId: string; names: string[] }
export interface RankRolePreview {
  skipped: string | null; roles: RankRolePreviewRole[]; lose: number; changes: number;
  /** Who would lose which mapped role this run, and the removals held back (partial roster, per-run cap). */
  losses?: RankRolePreviewLoss[]; held?: number; heldReason?: string | null;
}

/**
 * Who would get each mapped role, before anything is saved (9.1, docs/JEEVES_COMPARISON.md idea 2):
 * /mod rankroles set and turning rank roles back on show this and wait for the officer's confirm.
 * `links` is the mapping as it would be; the on/off switch is ignored (it is what is being decided).
 */
export async function previewRankRoles(prisma: PrismaClient, guild: Guild, links: readonly RankRoleLink[], now?: Date): Promise<RankRolePreview> {
  const plan = await planGuildRankRoles(prisma, guild, { links, ignoreEnabled: true, ...(now ? { now } : {}) });
  if (plan.skipped) return { skipped: plan.skipped, roles: [], lose: 0, changes: 0, losses: [], held: 0, heldReason: null };
  const name = (id: string) => guild.members.cache.get(id)?.displayName ?? id;
  const byName = (a: string, b: string) => a.localeCompare(b);
  const roles = [...plan.links].sort((a, b) => a.rankIndex - b.rankIndex).map((link) => ({
    discordRoleId: link.discordRoleId, rankIndex: link.rankIndex,
    gain: plan.changes.filter((change) => change.add.includes(link.discordRoleId)).map((change) => name(change.discordUserId)).sort(byName)
  }));
  const losses = [...new Set(plan.links.map((link) => link.discordRoleId))].map((roleId) => ({
    discordRoleId: roleId, names: plan.changes.filter((change) => change.remove.includes(roleId)).map((change) => name(change.discordUserId)).sort(byName)
  })).filter((loss) => loss.names.length);
  return { skipped: null, roles, lose: plan.changes.filter((change) => change.remove.length).length, changes: plan.changes.length, losses, held: plan.held, heldReason: plan.heldReason };
}

const sampleNames = (names: string[]) => names.length ? ` (${names.slice(0, 5).map((n) => n.replace(/[*_~`|]/g, "").slice(0, 24)).join(", ")}${names.length > 5 ? `, +${names.length - 5}` : ""})` : "";

/** The held-removals note under a preview or a sync (English, like the rest of /mod rankroles). Empty when nothing is held. */
export function formatHeldRemovals(held: number | undefined, reason: string | null | undefined): string {
  return held ? `-# ${held} member(s) keep a rank role for now: ${reason ?? "held"}.` : "";
}

/** The preview as Discord text (English, like the rest of /mod rankroles). `focus` = the rank being mapped. */
export function formatRankRolePreview(preview: RankRolePreview, focus?: number): string {
  if (preview.skipped) return preview.skipped;
  const rows = preview.roles.filter((role) => focus === undefined || role.rankIndex === focus);
  const lines = rows.map((role) => `• Rank ${role.rankIndex} → <@&${role.discordRoleId}>: **${role.gain.length}** member(s) would get it${sampleNames(role.gain)}`);
  // Removals are listed for every mapped role, not only the focused rank: officers see them before confirming.
  for (const loss of preview.losses ?? []) lines.push(`• <@&${loss.discordRoleId}>: **${loss.names.length}** member(s) would lose it (rank below the role's ranks, or left the guild)${sampleNames(loss.names)}`);
  if (!preview.losses && preview.lose) lines.push(`• ${preview.lose} member(s) would lose a mapped rank role that no longer matches their rank.`);
  const held = formatHeldRemovals(preview.held, preview.heldReason);
  if (held) lines.push(held);
  if (!preview.changes && !preview.held) lines.push("• Nobody would change: everyone with a fresh rank already has the right role.");
  lines.push("-# Only members whose rank an officer's upload saw in the last 2 weeks are counted; everyone else is left alone. Members ranked above a role's ranks keep it.");
  return lines.join("\n");
}

// The scheduled run: every server the bot is in, hourly.
export async function syncAllRankRoles(prisma: PrismaClient, guilds: Iterable<Guild>, report: (error: unknown) => void): Promise<void> {
  for (const guild of guilds) {
    await forEachGuildScope(prisma, guild.id, () => syncRankRoles(prisma, guild)).catch(report);
  }
}
