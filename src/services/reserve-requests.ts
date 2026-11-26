import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import type { AddonReserves } from "../integrations/addon.js";
import { addonName } from "./addon-name.js";
import { markGuildChanged } from "./standings-feed.js";

// Reserves asked for outside the game (Discord, phone). The list itself lives in the loot keeper's
// addon (reserves.ts), so a request waits here: the companion hands it to the keeper's game, which
// applies it at the next login or /reload, and the keeper's next upload settles it.

export const REQUEST_TTL_MS = 7 * 86_400_000;
export const MAX_PENDING_PER_MEMBER = 20;
const MAX_FED_REQUESTS = 200;

export const NO_LIST = "No soft-reserve list is open. An officer opens one in game with /guilded reserve open; it appears here when the companion uploads.";

type Db = Pick<PrismaClient, "reserveList" | "itemReserve" | "reserveRequest" | "recipeKnown">;

const lower = (text: string) => text.trim().toLowerCase();
const placeholder = (itemId: number) => `Item ${itemId}`;

export interface ParsedItem { itemId: number | null; name: string }

/** An item link, a Wowhead address, an item number or a name. */
export function parseReserveItem(text: string): ParsedItem {
  const clean = text.replace(/\p{Cc}/gu, " ").trim().slice(0, 300);
  const linked = /item[=:](\d{1,7})(?!\d)/i.exec(clean);
  const bare = /^\d{1,7}$/.exec(clean);
  const id = Number(linked?.[1] ?? bare?.[0] ?? 0);
  let name = /\[([^\]]+)\]/.exec(clean)?.[1] ?? "";
  if (!name && linked) {
    // wowhead.com/.../item=19364/ashkandi-greatsword-of-the-brotherhood
    const slug = /item=\d+\/([a-z0-9-]+)/i.exec(clean)?.[1];
    if (slug) name = slug.split("-").filter(Boolean).map((word) => word[0]!.toUpperCase() + word.slice(1)).join(" ");
  }
  if (!name && !linked && !bare) name = clean;
  name = name.replace(/[|[\]]/g, "").replace(/\s+/g, " ").trim().slice(0, 100);
  return { itemId: id > 0 ? id : null, name };
}

/** Adds the item number or the name from what the guild has already seen. */
export async function resolveReserveItem(database: Db, guildId: string, text: string): Promise<{ itemId: number | null; itemName: string }> {
  const parsed = parseReserveItem(text);
  if (parsed.itemId) {
    const known = await database.itemReserve.findFirst({ where: { guildId, itemId: parsed.itemId } })
      ?? await database.recipeKnown.findFirst({ where: { guildId, itemKey: parsed.itemId } });
    const knownName = known && known.itemName !== placeholder(parsed.itemId) ? known.itemName : "";
    return { itemId: parsed.itemId, itemName: knownName || parsed.name || placeholder(parsed.itemId) };
  }
  if (parsed.name.length < 2) throw new Error("Give the item's name, link or number.");
  const where = { guildId, itemName: { equals: parsed.name, mode: "insensitive" as const } };
  const reserved = await database.itemReserve.findFirst({ where });
  if (reserved) return { itemId: reserved.itemId, itemName: reserved.itemName };
  const crafted = await database.recipeKnown.findFirst({ where: { ...where, itemKey: { gt: 0 } } });
  if (crafted) return { itemId: crafted.itemKey, itemName: crafted.itemName };
  return { itemId: null, itemName: parsed.name };
}

type Wanted = { itemId: number | null; itemName: string };
const sameItem = (a: Wanted, b: Wanted) => a.itemId && b.itemId ? a.itemId === b.itemId : lower(a.itemName) === lower(b.itemName);

export interface ReserveRequester { guildId: string; memberId: string; character: string; realm: string; item: string }
export type ReserveOutcome = { kind: "requested" | "removal" | "cancelled" | "kept"; itemName: string; itemId: number | null; replaced?: boolean };

async function openList(database: Db, guildId: string) {
  const list = await database.reserveList.findUnique({ where: { guildId } });
  if (!list?.active || !list.open) throw new Error(NO_LIST);
  return list;
}

async function holdings(database: Db, input: ReserveRequester, now: Date) {
  const character = { equals: input.character, mode: "insensitive" as const };
  const [listed, pending] = await Promise.all([
    database.itemReserve.findMany({ where: { guildId: input.guildId, character } }),
    database.reserveRequest.findMany({ where: { guildId: input.guildId, character, createdAt: { gte: new Date(now.getTime() - REQUEST_TTL_MS) } }, orderBy: { createdAt: "asc" } })
  ]);
  return { listed, adds: pending.filter((row) => !row.remove), removals: pending.filter((row) => row.remove) };
}

function request(input: ReserveRequester, item: Wanted, remove: boolean, now: Date) {
  return { guildId: input.guildId, memberId: input.memberId, character: input.character, realm: input.realm, itemId: item.itemId, itemName: item.itemName, remove, createdAt: now };
}

export async function placeReserve(database: Db, input: ReserveRequester, now = new Date()): Promise<ReserveOutcome> {
  const list = await openList(database, input.guildId);
  const item = await resolveReserveItem(database, input.guildId, input.item);
  const { listed, adds, removals } = await holdings(database, input, now);
  // Taking back a removal that has not reached the game yet.
  const undone = removals.filter((row) => sameItem(row, item));
  if (undone.length) await database.reserveRequest.deleteMany({ where: { id: { in: undone.map((row) => row.id) } } });
  const leaving = removals.filter((row) => !undone.includes(row));
  const held: Wanted[] = [...listed.filter((row) => !leaving.some((gone) => sameItem(gone, row))), ...adds];
  if (held.some((row) => sameItem(row, item))) {
    if (undone.length) { markGuildChanged(input.guildId); return { kind: "kept", ...item }; }
    throw new Error("That item is already reserved for this character.");
  }
  let replaced = false;
  if (held.length >= list.perPlayer) {
    // With one reserve each, a new one replaces the old one, as in game.
    if (list.perPlayer !== 1) throw new Error(`You already have ${list.perPlayer} reserves. Remove one first.`);
    replaced = true;
    if (adds.length) await database.reserveRequest.deleteMany({ where: { id: { in: adds.map((row) => row.id) } } });
  }
  const mine = await database.reserveRequest.count({ where: { guildId: input.guildId, memberId: input.memberId, createdAt: { gte: new Date(now.getTime() - REQUEST_TTL_MS) } } });
  if (mine >= MAX_PENDING_PER_MEMBER) throw new Error("Too many reserve changes are waiting. Ask the loot keeper to /reload first.");
  await database.reserveRequest.create({ data: request(input, item, false, now) });
  markGuildChanged(input.guildId);
  return { kind: "requested", ...item, replaced };
}

export async function removeReserve(database: Db, input: ReserveRequester, now = new Date()): Promise<ReserveOutcome> {
  await openList(database, input.guildId);
  const item = await resolveReserveItem(database, input.guildId, input.item);
  const { listed, adds, removals } = await holdings(database, input, now);
  const waiting = adds.filter((row) => sameItem(row, item));
  if (waiting.length) await database.reserveRequest.deleteMany({ where: { id: { in: waiting.map((row) => row.id) } } });
  const onList = listed.find((row) => sameItem(row, item));
  if (!onList) {
    if (!waiting.length) throw new Error("This character has no reserve for that item.");
    markGuildChanged(input.guildId);
    return { kind: "cancelled", ...item };
  }
  const wanted = { itemId: onList.itemId, itemName: onList.itemName };
  if (!removals.some((row) => sameItem(row, wanted))) await database.reserveRequest.create({ data: request(input, wanted, true, now) });
  markGuildChanged(input.guildId);
  return { kind: "removal", ...wanted };
}

/** After a newer list arrived from the game: drops what it shows as done, what can no longer be applied and what is too old. */
export async function settleReserveRequests(database: Pick<PrismaClient, "reserveRequest"> | Prisma.TransactionClient, guildId: string, reserves: AddonReserves, now = new Date()): Promise<number> {
  const rows = await database.reserveRequest.findMany({ where: { guildId } });
  const done = rows.filter((row) => {
    if (now.getTime() - row.createdAt.getTime() > REQUEST_TTL_MS) return true;
    if ((!reserves.active || !reserves.open) && row.createdAt <= reserves.at) return true;
    const listed = reserves.active && reserves.entries.some((entry) => lower(entry.character) === lower(row.character) && sameItem(row, entry));
    return row.remove ? !listed && row.createdAt <= reserves.at : listed;
  });
  if (done.length) await database.reserveRequest.deleteMany({ where: { id: { in: done.map((row) => row.id) } } });
  return done.length;
}

/** Requests still waiting, oldest first; none once the list is locked or cleared. */
export async function pendingReserveRequests(database: Pick<PrismaClient, "reserveList" | "reserveRequest">, guildId: string, now = new Date()) {
  const list = await database.reserveList.findUnique({ where: { guildId } });
  if (!list?.active || !list.open) return [];
  return database.reserveRequest.findMany({ where: { guildId, createdAt: { gte: new Date(now.getTime() - REQUEST_TTL_MS) } }, orderBy: { createdAt: "asc" }, take: MAX_FED_REQUESTS });
}

export interface AddonReserveRequest { id: string; name: string; op: "ADD" | "DEL"; item?: number; itemName: string; at: number }

/** The officer part of the standings answer (companion/standings-format.mjs writes it for the addon). */
export async function reserveRequestsForAddon(database: Pick<PrismaClient, "reserveList" | "reserveRequest">, guildId: string, now = new Date()): Promise<AddonReserveRequest[]> {
  const rows = await pendingReserveRequests(database, guildId, now);
  return rows.flatMap((row) => {
    let name: string;
    try { name = addonName(row.character, row.realm); } catch { return []; }
    return [{ id: row.id, name, op: row.remove ? "DEL" as const : "ADD" as const, ...(row.itemId ? { item: row.itemId } : {}),
      itemName: row.itemId && row.itemName === placeholder(row.itemId) ? "" : row.itemName, at: Math.floor(row.createdAt.getTime() / 1000) }];
  });
}

/** Item names to pick from: on the list, wanted, won before. A member removing sees their own first. */
export async function reserveItemSuggestions(database: Pick<PrismaClient, "itemReserve" | "reserveRequest" | "wishlistEntry" | "lootAward" | "character">, guildId: string, query: string, memberId: string, removing = false): Promise<string[]> {
  const needle = query.trim();
  const contains = { contains: needle, mode: "insensitive" as const };
  if (removing) {
    const names = (await database.character.findMany({ where: { memberId }, select: { name: true }, take: 50 })).map((row) => row.name);
    const [listed, waiting] = await Promise.all([
      database.itemReserve.findMany({ where: { guildId, itemName: contains, character: { in: names, mode: "insensitive" } }, orderBy: { itemName: "asc" }, take: 25 }),
      database.reserveRequest.findMany({ where: { guildId, memberId, remove: false, itemName: contains }, take: 25 })
    ]);
    return [...new Set([...waiting, ...listed].map((row) => row.itemName))].slice(0, 25);
  }
  const [reserved, wished, won] = await Promise.all([
    database.itemReserve.findMany({ where: { guildId, itemName: contains }, distinct: ["itemName"], select: { itemName: true }, take: 15 }),
    database.wishlistEntry.findMany({ where: { character: { memberId }, itemName: contains }, distinct: ["itemName"], select: { itemName: true }, take: 15 }),
    database.lootAward.findMany({ where: { guildId, itemName: contains }, distinct: ["itemName"], select: { itemName: true }, orderBy: { awardedAt: "desc" }, take: 15 })
  ]);
  return [...new Set([...wished, ...reserved, ...won].map((row) => row.itemName))].slice(0, 25);
}
