import type { PrismaClient } from "../generated/prisma/client.js";

// Phone app 0.6.0: the guild activity feed. One list, newest first, from what the bot already stores:
// the in-game guild log the addon reads (joins, departures, rank changes: GuildEventEntry), guild bank gifts
// (deposits: GuildBankTransaction, the same lines the donor cards thank) and raid boss kills (RaidKill).
// Members of that guild only (credential -> Discord user -> active member of the server); never public.

type Db = Pick<PrismaClient, "member" | "guildEventEntry" | "guildBankTransaction" | "raidKill">;

export type FeedKind = "join" | "leave" | "removed" | "promote" | "demote" | "donation" | "raidKill";
export interface FeedItem {
  kind: FeedKind;
  at: string;
  /** Who did it: the character that joined, left, deposited, or the officer who promoted, demoted or removed. */
  actor: string;
  /** The character promoted, demoted or removed. */
  target?: string;
  /** The new rank of a promotion or demotion. */
  rank?: string;
  /** A deposited item (with its count) or gold (copper). */
  item?: string; count?: number; copper?: number;
  /** A raid kill. */
  boss?: string; instance?: string;
}

export const FEED_DAYS = 14;
export const FEED_MAX = 80;
const GUILD_ID = /^\d{5,30}$/;
const LOG_KINDS: Record<string, FeedKind> = { join: "join", quit: "leave", remove: "removed", promote: "promote", demote: "demote" };

/** The feed of one Discord server's guild, for one of its active members; empty for anyone else. */
export async function guildFeedFor(database: Db, discordUserId: string, guildDiscordId: unknown, allows: (id: string) => boolean = () => true, now = new Date()): Promise<{ days: number; items: FeedItem[] }> {
  if (typeof guildDiscordId !== "string" || !GUILD_ID.test(guildDiscordId) || !allows(guildDiscordId)) return { days: FEED_DAYS, items: [] };
  const member = await database.member.findFirst({ where: { discordUserId, status: "ACTIVE", isTest: false, guild: { discordId: guildDiscordId } }, select: { guildId: true } });
  if (!member) return { days: FEED_DAYS, items: [] };
  const since = new Date(now.getTime() - FEED_DAYS * 86_400_000);
  const [log, bank, kills] = await Promise.all([
    database.guildEventEntry.findMany({ where: { guildId: member.guildId, at: { gte: since, lte: now }, kind: { in: Object.keys(LOG_KINDS) } }, orderBy: { at: "desc" }, take: FEED_MAX,
      select: { kind: true, actor: true, target: true, rank: true, at: true } }),
    database.guildBankTransaction.findMany({ where: { guildId: member.guildId, at: { gte: since, lte: now }, type: { equals: "deposit", mode: "insensitive" }, kind: { in: ["item", "money"] } }, orderBy: { at: "desc" }, take: FEED_MAX,
      select: { kind: true, actor: true, itemName: true, count: true, amount: true, at: true } }),
    database.raidKill.findMany({ where: { guildId: member.guildId, killedAt: { gte: since, lte: now } }, orderBy: { killedAt: "desc" }, take: 40,
      select: { bossName: true, instanceName: true, killedAt: true } })
  ]);
  const items: FeedItem[] = [
    ...log.map((row): FeedItem => ({ kind: LOG_KINDS[row.kind]!, at: row.at.toISOString(), actor: row.actor, ...(row.target ? { target: row.target } : {}), ...(row.rank ? { rank: row.rank } : {}) })),
    ...bank.flatMap((row): FeedItem[] => row.kind === "money"
      ? (row.amount && row.amount > 0n ? [{ kind: "donation", at: row.at.toISOString(), actor: row.actor, copper: Number(row.amount) }] : [])
      : (row.itemName ? [{ kind: "donation", at: row.at.toISOString(), actor: row.actor, item: row.itemName, count: row.count ?? 1 }] : [])),
    ...kills.map((row): FeedItem => ({ kind: "raidKill", at: row.killedAt.toISOString(), actor: row.bossName, boss: row.bossName, instance: row.instanceName }))
  ];
  items.sort((a, b) => b.at.localeCompare(a.at));
  return { days: FEED_DAYS, items: items.slice(0, FEED_MAX) };
}
