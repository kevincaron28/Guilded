import { foreverNameMatches } from "../../companion/character-identity.mjs";

export interface RosterLite { name: string; nameKey: string; inGuild: boolean; observedAt: Date }

/**
 * Pure: drops the characters the in-game roster says left the guild (16 Nov 2026: departed players stayed on the board because it read
 * linked and unlinked characters without ever asking the roster). A character stays unless a roster row with its name (or the single
 * matching first-name row, see foreverNameMatches) says inGuild=false and no in-guild row matches it; a character the roster has
 * never heard of is kept, since the roster may simply not name it yet. A rejoined member's row is inGuild=true again, so they return.
 */
export function withoutDeparted<T extends { key: string; name: string }>(chars: readonly T[], roster: readonly RosterLite[]): T[] {
  const gone = roster.filter(row => !row.inGuild);
  if (!gone.length) return [...chars];
  const present = roster.filter(row => row.inGuild);
  const presentKeys = new Set(present.map(row => row.nameKey)), goneKeys = new Set(gone.map(row => row.nameKey));
  return chars.filter(char => {
    if (presentKeys.has(char.key)) return true;
    if (goneKeys.has(char.key)) return false;
    if (foreverNameMatches(present, char.name).length) return true;
    return !foreverNameMatches(gone, char.name).length;
  });
}

/** Roster rows of one guild for withoutDeparted; an empty list (no roster ever uploaded) departs nobody. */
export async function loadRosterPresence(db: { guildRosterEntry: { findMany(args: { where: { guildId: string; gameEdition: string }; select: { name: true; nameKey: true; inGuild: true; observedAt: true }; take: number }): Promise<RosterLite[]> } }, guildId: string, edition: string): Promise<RosterLite[]> {
  return db.guildRosterEntry.findMany({ where: { guildId, gameEdition: edition }, select: { name: true, nameKey: true, inGuild: true, observedAt: true }, take: 10_000 });
}
