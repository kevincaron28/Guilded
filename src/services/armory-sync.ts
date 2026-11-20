import type { PrismaClient } from "../generated/prisma/client.js";
import { armoryNameKey, guildSlug, type ArmoryClient } from "./blizzard-armory.js";
import { ownGuildNames } from "./import-followup.js";
import { isHiddenPlayer, type HiddenIdentity } from "./profile-privacy.js";

// The Blizzard Armory roster of a guild, kept beside (never inside) the addon's roster (docs/ARMORY_SYNC.md).
//   * One snapshot per Discord server, replaced whole on every run; the addon's GuildRosterEntry rows are never written here.
//   * An Armory row is tied to a Guilded character ONLY through the Blizzard character id read from a player GUID the addon
//     uploaded (GuildRosterEntry.wowId). No name, level or class matching: rows without a known id stay
//     Armory-only (first name, level, class, rank), shown as such and never merged with a "First Last" character.

export const ARMORY_INTERVAL_MS = 6 * 3_600_000;
const SPACING_MS = 2_000;

type SyncDb = Pick<PrismaClient, "guild" | "wowGuild" | "companionDevice" | "armoryGuild" | "armoryRosterEntry" | "$transaction">;

export type ArmorySyncOutcome = "synced" | "no-guild-name" | "not-found" | "wrong-guild" | "empty" | "unavailable";

/** Fetches and stores one server's Armory snapshot. Never throws for an Armory problem. */
export async function syncArmoryGuild(db: Pick<PrismaClient, "armoryGuild" | "armoryRosterEntry" | "$transaction">, client: ArmoryClient, guildId: string, wowGuildName: string | null | undefined,
  now: Date = new Date(), log: (message: string) => void = () => {}): Promise<ArmorySyncOutcome> {
  const name = wowGuildName?.trim();
  if (!name) return "no-guild-name";
  const slug = guildSlug(name);
  if (!slug) return "no-guild-name";
  const roster = await client.fetchForeverGuildRoster(slug);
  if (!roster) return "not-found";
  // The slug is not the name: "quebec-gold" is another guild than "québec-gold". Only a guild answering to the very name is stored.
  if (!roster.guild.name || armoryNameKey(roster.guild.name) !== armoryNameKey(name)) { log(`Armory: ${slug} answered as "${roster.guild.name ?? "?"}", not "${name}"; skipped.`); return "wrong-guild"; }
  if (!roster.members.length) return "empty";
  const summary = await client.fetchForeverGuildSummary(slug);
  const guildRow = { wowGuildName: name, slug, faction: summary?.faction ?? roster.guild.faction, memberCount: summary?.memberCount ?? roster.members.length,
    achievementPoints: summary?.achievementPoints ?? null, fetchedAt: now };
  await db.$transaction([
    db.armoryRosterEntry.deleteMany({ where: { guildId } }),
    db.armoryRosterEntry.createMany({ data: roster.members.map((member) => ({ guildId, wowId: member.id, name: member.name, level: member.level, classId: member.classId, raceId: member.raceId, rank: member.rank, seenAt: now })) }),
    db.armoryGuild.upsert({ where: { guildId }, create: { guildId, ...guildRow }, update: guildRow })
  ]);
  return "synced";
}

/** One pass over every server whose in-game guild name Guilded knows, one guild at a time. */
export async function syncAllArmoryGuilds(db: SyncDb, client: ArmoryClient | null, options: { now?: () => Date; sleep?: (ms: number) => Promise<void>; log?: (message: string) => void } = {}): Promise<{ synced: number; skipped: number }> {
  const result = { synced: 0, skipped: 0 };
  if (!client) return result;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const guilds = await db.guild.findMany({ select: { id: true }, take: 5000 });
  for (const guild of guilds) {
    const names = await ownGuildNames(db, guild.id).catch(() => []);
    if (!names[0]) continue;
    const outcome = await syncArmoryGuild(db, client, guild.id, names[0].name, options.now?.() ?? new Date(), options.log).catch(() => "unavailable" as const);
    if (outcome === "synced") result.synced++; else result.skipped++;
    await sleep(SPACING_MS);
  }
  return result;
}

// WoW class ids (the same on every edition; Forever uses the first nine and Monk to Evoker simply never appear).
const CLASS_NAMES: Record<number, string> = { 1: "Warrior", 2: "Paladin", 3: "Hunter", 4: "Rogue", 5: "Priest", 6: "Death Knight", 7: "Shaman", 8: "Mage", 9: "Warlock", 10: "Monk", 11: "Druid", 12: "Demon Hunter", 13: "Evoker" };
export const armoryClassName = (id: number | null | undefined) => (id ? CLASS_NAMES[id] ?? null : null);

const fold = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim();
const firstWord = (name: string) => fold(name).split(/\s+/)[0] ?? "";
const titleClass = (value: string) => value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();

export interface ArmoryRosterRow {
  name: string; level: number | null; className: string | null; rank: number | null; rankLabel: string;
  /** "addon": tied by Blizzard character id to a character the addon reported (full name, addon's level/class/rank win). "armory": Armory only. */
  source: "addon" | "armory";
}
export interface ArmoryRosterView { fetchedAt: Date; memberCount: number | null; faction: string | null; achievementPoints: number | null; linked: number; rows: ArmoryRosterRow[] }

type ViewDb = Pick<PrismaClient, "armoryGuild" | "armoryRosterEntry" | "guildRosterEntry">;

/**
 * The website's roster: every Armory row, with the addon's full name, level, class and rank name where (and only where) the
 * Blizzard character id ties it to an addon row. Rows of members who hid their profile are left out, matched by name (first
 * name for Armory-only rows; when in doubt the name is not shown).
 */
export async function loadArmoryRosterView(db: ViewDb, guildId: string, hidden: HiddenIdentity): Promise<ArmoryRosterView | null> {
  const guild = await db.armoryGuild?.findUnique({ where: { guildId } }).catch(() => null);
  if (!guild) return null;
  const [entries, addon] = await Promise.all([
    db.armoryRosterEntry.findMany({ where: { guildId }, take: 5000 }),
    db.guildRosterEntry.findMany({ where: { guildId, gameEdition: "forever", inGuild: true }, select: { name: true, level: true, className: true, rankName: true, rankIndex: true, wowId: true }, take: 5000 })
  ]);
  if (!entries.length) return null;
  const rankNames = new Map<number, string>();
  for (const row of addon) if (row.rankIndex != null && row.rankName && !rankNames.has(row.rankIndex)) rankNames.set(row.rankIndex, row.rankName);
  // An id seen on two addon rows is ambiguous: neither is used.
  const byId = new Map<bigint, (typeof addon)[number] | null>();
  for (const row of addon) if (row.wowId != null) byId.set(row.wowId, byId.has(row.wowId) ? null : row);
  const rows: ArmoryRosterRow[] = [];
  let linked = 0;
  for (const entry of entries) {
    const mate = byId.get(entry.wowId) ?? null;
    // The id must agree with the first name: a wrong GUID conversion (never seen, but unverified for Forever) cannot attach a stranger.
    const tied = mate && firstWord(mate.name) === firstWord(entry.name) ? mate : null;
    const name = tied?.name ?? entry.name;
    if (isHiddenPlayer(hidden, entry.name, "") || isHiddenPlayer(hidden, name, "")) continue;
    const rank = tied?.rankIndex ?? entry.rank;
    const className = tied?.className && tied.className !== "UNKNOWN" ? titleClass(tied.className) : armoryClassName(entry.classId);
    if (tied) linked++;
    rows.push({ name, level: tied?.level ?? entry.level, className, rank, source: tied ? "addon" : "armory",
      rankLabel: rank == null ? "" : tied?.rankName ?? rankNames.get(rank) ?? `Rank ${rank}` });
  }
  rows.sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99) || (b.level ?? 0) - (a.level ?? 0) || a.name.localeCompare(b.name));
  return { fetchedAt: guild.fetchedAt, memberCount: guild.memberCount, faction: guild.faction, achievementPoints: guild.achievementPoints, linked, rows };
}

/**
 * A hint for the promotion plan (not used by it yet): the Armory rank index of a character, only through its Blizzard character
 * id. Null when the id is unknown or the Armory has no such member.
 */
export async function armoryRankHint(db: Pick<PrismaClient, "armoryRosterEntry">, guildId: string, wowId: bigint | null | undefined): Promise<number | null> {
  if (!wowId) return null;
  const row = await db.armoryRosterEntry.findUnique({ where: { guildId_wowId: { guildId, wowId } }, select: { rank: true } });
  return row?.rank ?? null;
}
