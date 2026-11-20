// Exact character matching by ID (docs/plans/CHARACTER_ID_MATCHING_2026-11-20.md, section 3).
//
// `wowId` is the low part of the in-game GUID ("Player-<realm>-<hexLow>"), the same number as the Armory's
// character id. IDs are resolved once, at ingest; every table keeps its name column, now guaranteed to be
// that row's canonical name. Name-only (old) clients keep working: see rule step 3.

const MAX_WOW_ID = (1n << 63n) - 1n;

/**
 * Parses an id sent by an addon or companion: lowercase hex ("1a2b3c4d"), or a safe-integer number. Returns null
 * for anything else, so an unknown or malformed `id` is ignored, never rejected. Strings are always hex on the
 * wire; the Armory's decimal id goes through parseWowIdDecimal.
 */
export function parseWowId(value: unknown): bigint | null {
  if (typeof value === "bigint") return value > 0n && value <= MAX_WOW_ID ? value : null;
  if (typeof value === "number") return Number.isSafeInteger(value) && value > 0 ? BigInt(value) : null;
  if (typeof value !== "string") return null;
  const text = value.trim().toLowerCase();
  if (!/^[0-9a-f]{1,16}$/.test(text)) return null;
  const id = BigInt(`0x${text}`);
  return id > 0n && id <= MAX_WOW_ID ? id : null;
}

/** The Armory's decimal `character.id` (string or number). */
export function parseWowIdDecimal(value: unknown): bigint | null {
  if (typeof value === "number") return parseWowId(value);
  if (typeof value !== "string" || !/^[0-9]{1,19}$/.test(value.trim())) return null;
  return parseWowId(BigInt(value.trim()));
}

/** Lowercase, single-spaced full name: the exact-match key. */
export const refNameKey = (name: string) => String(name ?? "").normalize("NFC").trim().replace(/\s+/g, " ").toLowerCase();

export interface RefRow { wowId: bigint | null; name: string }
export interface CharacterRef { id?: bigint | null; name: string }

export type Resolution<T extends RefRow> =
  /** The row this reference is. `renamed`: matched by id with another name (the caller rewrites the name). `adopt`: the row had no id yet (the caller sets it). */
  | { kind: "match"; row: T; renamed: boolean; adopt: boolean }
  /** An id with no row: create one. `nameTaken` is a row that already holds this exact name under a different id; the name unique index forbids a second row, so the caller skips it rather than merging. */
  | { kind: "new"; nameTaken?: T }
  /** A name-only report matching zero or several rows (several = ambiguous): nothing is touched. */
  | { kind: "none"; ambiguous: boolean };

/** Rows indexed by id and by exact name, so a 1000-row roster costs O(1) per lookup. Callers keep it current after writes with `addToIndex`. */
export interface CharacterIndex<T extends RefRow> { byId: Map<bigint, T>; byName: Map<string, T[]> }
export function indexCharacters<T extends RefRow>(rows: readonly T[]): CharacterIndex<T> {
  const index: CharacterIndex<T> = { byId: new Map(), byName: new Map() };
  for (const row of rows) addToIndex(index, row);
  return index;
}
export function addToIndex<T extends RefRow>(index: CharacterIndex<T>, row: T): void {
  if ((row.wowId ?? null) !== null) index.byId.set(row.wowId!, row);
  const key = refNameKey(row.name);
  const list = index.byName.get(key);
  if (list) { if (!list.includes(row)) list.push(row); } else index.byName.set(key, [row]);
}

/**
 * The one matching rule:
 *  1. id given and a row has it -> that row (a name difference is a rename).
 *  2. id given, no row has it -> the single row with wowId NULL and exactly that full name adopts it;
 *     otherwise a new row. Two different ids never merge, and an id-bearing row never takes another id.
 *  3. no id given -> the single row with exactly that name; zero or several -> none.
 * First-name-only (loose) matching is not part of this rule; callers keep theirs until the sunset flag.
 */
export function resolveCharacter<T extends RefRow>(source: readonly T[] | CharacterIndex<T>, ref: CharacterRef): Resolution<T> {
  const index = Array.isArray(source) ? indexCharacters(source as readonly T[]) : source as CharacterIndex<T>;
  const key = refNameKey(ref.name);
  const id = ref.id ?? null;
  const sameName = index.byName.get(key) ?? [];
  if (id !== null) {
    const byId = index.byId.get(id);
    if (byId) return { kind: "match", row: byId, renamed: refNameKey(byId.name) !== key, adopt: false };
    if (sameName.length === 1 && (sameName[0]!.wowId ?? null) === null) return { kind: "match", row: sameName[0]!, renamed: false, adopt: true };
    const taken = sameName.find((row) => (row.wowId ?? null) !== null);
    return taken ? { kind: "new", nameTaken: taken } : { kind: "new" };
  }
  if (sameName.length === 1) return { kind: "match", row: sameName[0]!, renamed: false, adopt: false };
  return { kind: "none", ambiguous: sameName.length > 1 };
}

/**
 * Pairwise form (run trust, merging two reports of one player): the same character when both ids are known
 * and equal; different when both are known and differ; with an id missing on either side only an exactly
 * equal full name counts.
 */
export function sameCharacterRef(a: CharacterRef, b: CharacterRef): boolean {
  const x = a.id ?? null, y = b.id ?? null;
  if (x !== null && y !== null) return x === y;
  const key = refNameKey(a.name);
  return key !== "" && key === refNameKey(b.name);
}
