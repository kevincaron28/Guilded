/**
 * A guild or server name reduced to its letters and digits: no case, accents or decoration. "Québec Gold", "Quebec Gold" and the
 * Discord server "✤Quebec Gold✤" all become "quebecgold". A realm name gets the same treatment ("CAMWOW US2 Realm 2 PvP").
 * Shared by the unsigned device path and the signed upload's wrong-server check (wow-guilds.ts).
 */
export function looseKey(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}
