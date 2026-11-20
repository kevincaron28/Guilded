// The key between the addon's roster and the Blizzard Armory (docs/ARMORY_SYNC.md).
//
// A WoW player GUID reads "Player-<realmId>-<hex>", for example "Player-4408-0A1B2C3D". Blizzard's Game Data and Profile
// APIs name the same character by a plain number `character.id`: the hexadecimal low part of the GUID read as decimal
// ("0A1B2C3D" -> 169 552 957). That is how the community tools (Raider.IO, Warcraft Logs, addon libraries) tie a roster
// to the API. The conversion is documented by community sources for retail and Classic; for WoW Forever it is not yet
// confirmed against a real upload, so armory-sync.ts also refuses an id match whose first names differ.

const GUID = /^Player-(\d+)-([0-9A-Fa-f]{1,16})$/;
// Up to 8 hex digits in practice (4 294 967 295), which overflows a 32-bit INTEGER: the column is BigInt (`wowId`).
const MAX_ID = 9_223_372_036_854_775_807n;

export interface ParsedGuid { realmId: number; characterId: bigint }

/** The realm id and Blizzard character id inside a player GUID; null for anything else (pets, creatures, odd text). */
export function parsePlayerGuid(guid: unknown): ParsedGuid | null {
  if (typeof guid !== "string" || guid.length > 40) return null;
  const match = GUID.exec(guid);
  if (!match) return null;
  const realmId = Number(match[1]);
  const characterId = BigInt(`0x${match[2]}`);
  if (!Number.isSafeInteger(realmId) || characterId < 1n || characterId > MAX_ID) return null;
  return { realmId, characterId };
}

/** Just the Blizzard character id, or null. */
export const characterIdFromGuid = (guid: unknown): bigint | null => parsePlayerGuid(guid)?.characterId ?? null;

/** An Armory `character.id` (a JSON number) as a stored key, or null. */
export const armoryId = (id: unknown): bigint | null => {
  if (typeof id === "bigint") return id > 0n && id <= MAX_ID ? id : null;
  return typeof id === "number" && Number.isSafeInteger(id) && id > 0 ? BigInt(id) : null;
};
