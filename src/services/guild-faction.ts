import type { PrismaClient } from "../generated/prisma/client.js";
import { factionOfRace, majorityFaction } from "../../companion/race-faction.mjs";

// One place that decides a faction (ALLIANCE or HORDE, never guessed): of a character, and of an in-game guild.
// A stored fact wins (a recruitment listing's faction; the faction a client reported for a player in a public run);
// otherwise it is read from the known races of the characters (a Guilded member's, a companion device's) and the guild's
// faction is the clear majority of its known players, with a minimum sample (MIN_KNOWN) so two players never decide it.

export type Faction = "ALLIANCE" | "HORDE";
export const MIN_KNOWN = 3;

type FactionDatabase = Partial<Pick<PrismaClient, "character" | "deviceCharacter" | "publicRunPlayer" | "guildRosterEntry" | "recruitmentListing">>;

const asFaction = (value: string | null | undefined): Faction | null => value === "ALLIANCE" || value === "HORDE" ? value : null;

/** Faction of each character name (lower case), from stored races first and the factions clients reported in public runs second. Best effort: a missing table only means unknown. */
export async function factionsByName(database: FactionDatabase, names: string[]): Promise<Map<string, Faction>> {
  const out = new Map<string, Faction>();
  const unique = [...new Set(names.map((name) => name.trim()).filter(Boolean))];
  for (let at = 0; at < unique.length; at += 1_000) {
    const chunk = unique.slice(at, at + 1_000);
    const keys = chunk.map((name) => name.toLowerCase());
    try {
      const [members, devices, runs] = await Promise.all([
        database.character?.findMany({ where: { name: { in: chunk, mode: "insensitive" }, race: { not: null } }, select: { name: true, race: true }, take: 5_000 }) ?? [],
        database.deviceCharacter?.findMany({ where: { nameKey: { in: keys }, race: { not: null } }, select: { nameKey: true, race: true }, take: 5_000 }) ?? [],
        database.publicRunPlayer?.findMany({ where: { character: { in: chunk, mode: "insensitive" }, faction: { not: null } }, select: { character: true, faction: true }, take: 5_000 }) ?? []
      ]);
      for (const row of members) { const faction = factionOfRace(row.race); if (faction && !out.has(row.name.toLowerCase())) out.set(row.name.toLowerCase(), faction); }
      for (const row of devices) { const faction = factionOfRace(row.race); if (faction && !out.has(row.nameKey)) out.set(row.nameKey, faction); }
      for (const row of runs) { const faction = asFaction(row.faction); if (faction && !out.has(row.character.toLowerCase())) out.set(row.character.toLowerCase(), faction); }
    } catch { /* unknown stays unknown */ }
  }
  return out;
}

/** The faction of one character by name, or null when nothing the bot holds says. */
export async function characterFaction(database: FactionDatabase, name: string): Promise<Faction | null> {
  return (await factionsByName(database, [name])).get(name.trim().toLowerCase()) ?? null;
}

/**
 * Factions of in-game guilds (a bot Guild id each): a recruitment listing's faction, else the clear majority of the known
 * factions of the guild's roster and linked characters (at least MIN_KNOWN known players). Unknown guilds are absent.
 */
export async function guildFactions(database: FactionDatabase, guildIds: string[]): Promise<Map<string, Faction>> {
  const out = new Map<string, Faction>();
  if (!guildIds.length) return out;
  try {
    const listings = await database.recruitmentListing?.findMany({ where: { guildId: { in: guildIds }, faction: { not: null } }, select: { guildId: true, faction: true }, orderBy: { updatedAt: "desc" }, take: 5_000 }) ?? [];
    for (const row of listings) { const faction = asFaction(row.faction); if (faction && !out.has(row.guildId)) out.set(row.guildId, faction); }
  } catch { /* derived below */ }
  const open = guildIds.filter((id) => !out.has(id));
  if (!open.length) return out;
  try {
    const [roster, linked] = await Promise.all([
      database.guildRosterEntry?.findMany({ where: { guildId: { in: open }, inGuild: true }, select: { guildId: true, name: true }, take: 50_000 }) ?? [],
      database.character?.findMany({ where: { member: { guildId: { in: open } }, race: { not: null } }, select: { name: true, race: true, member: { select: { guildId: true } } }, take: 50_000 }) ?? []
    ]);
    const byGuild = new Map<string, Map<string, Faction | null>>();
    const slot = (guildId: string) => byGuild.get(guildId) ?? byGuild.set(guildId, new Map()).get(guildId)!;
    for (const row of linked) slot(row.member.guildId).set(row.name.toLowerCase(), factionOfRace(row.race));
    for (const row of roster) { const own = slot(row.guildId); if (!own.has(row.name.toLowerCase())) own.set(row.name.toLowerCase(), null); }
    const need = [...new Set([...byGuild.values()].flatMap((own) => [...own.entries()].filter(([, faction]) => !faction).map(([name]) => name)))];
    const known = need.length ? await factionsByName(database, need) : new Map<string, Faction>();
    for (const [guildId, own] of byGuild) {
      const faction = majorityFaction([...own.entries()].map(([name, value]) => value ?? known.get(name) ?? null), { min: MIN_KNOWN });
      if (faction) out.set(guildId, faction);
    }
  } catch { /* unknown stays unknown */ }
  return out;
}

export async function guildFaction(database: FactionDatabase, guildId: string): Promise<Faction | null> {
  return (await guildFactions(database, [guildId])).get(guildId) ?? null;
}

const COLOUR: Record<Faction, string> = { ALLIANCE: "#6fa8ff", HORDE: "#ff6b5e" };
const LABEL: Record<Faction, { en: string; fr: string }> = { ALLIANCE: { en: "Alliance", fr: "Alliance" }, HORDE: { en: "Horde", fr: "Horde" } };

/** "Horde" / "Alliance" in the faction colour, for a table cell or a name line; empty when unknown. Self-contained (inline colour) so any page can use it. */
export function factionTag(faction: string | null | undefined, lang: "en" | "fr"): string {
  const key = asFaction(faction);
  return key ? `<span class="fac-${key.toLowerCase()}" style="color:${COLOUR[key]};font-weight:600" title="${LABEL[key][lang]}">${LABEL[key][lang]}</span>` : "";
}
