import type { CraftRequestStatus, PrismaClient } from "../generated/prisma/client.js";

// Crafting orders in game (docs/plans/CRAFTING_ORDERS.md). Discord craft requests go to the addon's
// Orders page through the standings feed (craftOrders, shared), and crafters claim, finish or give
// them back in game. Their actions come back in uploads: the member's own (their pairing) and the
// ones a guildmate's addon heard on GUILD (relayed, by the sender's name). The same rules as the
// Discord buttons apply, and an action already reflected changes nothing.

export const ORDER_LIMITS = { open: 40, done: 10, doneWindowMs: 86_400_000 } as const;

const clean = (value: string | null | undefined, max: number) => (value ?? "").replace(/[|\p{Cc}]/gu, " ").replace(/\s+/g, " ").trim().slice(0, max);
const epoch = (date: Date | null | undefined) => date ? Math.floor(date.getTime() / 1000) : undefined;

export interface AddonOrder {
  id: string; key?: number; item: string; qty: number; prof?: string; status: CraftRequestStatus;
  by: string; crafter?: string; character?: string; asked?: string; mats: boolean; note?: string;
  at: number; claimedAt?: number; doneAt?: number;
}

type FeedDb = Pick<PrismaClient, "craftRequest" | "guildSettings">;

/** The feed part: open and claimed requests (oldest first) and the ones done in the last day. */
export async function craftOrdersForAddon(db: FeedDb, guildId: string, now = new Date()): Promise<{ enabled: boolean; orders: AddonOrder[] }> {
  const settings = await db.guildSettings.findUnique({ where: { guildId }, select: { craftOrdersInGame: true } });
  if (settings?.craftOrdersInGame === false) return { enabled: false, orders: [] };
  const include = { requester: { select: { displayName: true } }, crafter: { select: { displayName: true } } } as const;
  const [open, done] = await Promise.all([
    db.craftRequest.findMany({ where: { guildId, status: { in: ["OPEN", "CLAIMED"] } }, include, orderBy: { createdAt: "asc" }, take: ORDER_LIMITS.open }),
    db.craftRequest.findMany({ where: { guildId, status: "DONE", doneAt: { gte: new Date(now.getTime() - ORDER_LIMITS.doneWindowMs) } }, include, orderBy: { doneAt: "desc" }, take: ORDER_LIMITS.done })
  ]);
  const orders = [...open, ...done].map((row): AddonOrder => {
    const note = clean(row.note, 200);
    return {
      id: row.id, item: clean(row.item, 100) || "?", qty: row.quantity, status: row.status, by: clean(row.requester.displayName, 60) || "?", mats: row.materialsProvided,
      at: epoch(row.createdAt) ?? 0,
      ...(row.itemKey !== null && row.itemKey !== 0 ? { key: row.itemKey } : {}),
      ...(row.profession ? { prof: row.profession } : {}),
      ...(row.crafter ? { crafter: clean(row.crafter.displayName, 60) } : {}),
      ...(row.crafterCharacter ? { character: clean(row.crafterCharacter, 60) } : {}),
      ...(row.askedCharacter ? { asked: clean(row.askedCharacter, 60) } : {}),
      ...(note ? { note } : {}),
      ...(row.claimedAt ? { claimedAt: epoch(row.claimedAt)! } : {}),
      ...(row.doneAt ? { doneAt: epoch(row.doneAt)! } : {})
    };
  });
  return { enabled: true, orders };
}

// ---------------------------------------------------------------------------------------------
// Actions from the game
// ---------------------------------------------------------------------------------------------

export type OrderAction = "claim" | "done" | "release";
export interface AddonOrderAction { order: string; action: OrderAction; character: string; at: number; name?: string }

const ACTIONS = new Set<OrderAction>(["claim", "done", "release"]);
const isEpoch = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 1_600_000_000 && value < 4_102_444_800;
const isName = (value: unknown): value is string => typeof value === "string" && value.trim().length > 1 && value.length <= 80 && !/[|\p{Cc}]/u.test(value);

/** Rows from db.craftOrders (own) or heard on GUILD (relayed, with the sender's `name`); bad rows are dropped. */
export function parseAddonOrderActions(rows: readonly unknown[], relayed = false): AddonOrderAction[] {
  return rows.flatMap((row): AddonOrderAction[] => {
    if (!row || typeof row !== "object") return [];
    const { order, action, character, at, name } = row as Record<string, unknown>;
    if (typeof order !== "string" || !/^[A-Za-z0-9_-]{6,40}$/.test(order) || typeof action !== "string" || !ACTIONS.has(action as OrderAction)) return [];
    if (!isName(character) || !isEpoch(at) || (relayed && !isName(name))) return [];
    return [{ order, action: action as OrderAction, character: character.trim(), at, ...(relayed ? { name: (name as string).trim() } : {}) }];
  }).slice(0, relayed ? 100 : 30);
}

export interface OrderChange { requestId: string; action: OrderAction; memberId: string; character: string }

type ApplyDb = Pick<PrismaClient, "craftRequest" | "character" | "guildSettings">;

/**
 * Applies the game's actions with the Discord buttons' rules: anyone but the requester claims an open
 * order; only its crafter finishes or gives it back. "done" on an open order claims and finishes it
 * (made without claiming first). Officer overrides stay in Discord. Returns what changed, in order.
 */
export async function applyOrderActions(db: ApplyDb, guildId: string, uploaderMemberId: string, own: readonly AddonOrderAction[], relayed: readonly AddonOrderAction[], now = new Date()): Promise<OrderChange[]> {
  if (!own.length && !relayed.length) return [];
  const settings = await db.guildSettings.findUnique({ where: { guildId }, select: { craftOrdersInGame: true } });
  if (settings?.craftOrdersInGame === false) return [];
  // A relayed action counts only for a character linked to an active member of this server (not the uploader).
  const names = [...new Set(relayed.map((row) => row.name!.toLowerCase()))];
  const owners = new Map<string, string>();
  if (names.length) {
    const characters = await db.character.findMany({ where: { member: { guildId, status: "ACTIVE" } }, select: { name: true, displayName: true, memberId: true } });
    for (const character of characters) for (const key of [character.name, character.displayName]) {
      if (key && names.includes(key.toLowerCase())) owners.set(key.toLowerCase(), character.memberId);
    }
  }
  const work = [
    ...own.map((row) => ({ ...row, memberId: uploaderMemberId })),
    ...relayed.flatMap((row) => { const memberId = owners.get(row.name!.toLowerCase()); return memberId && memberId !== uploaderMemberId ? [{ ...row, memberId }] : []; })
  ].sort((a, b) => a.at - b.at);
  const changes: OrderChange[] = [];
  for (const row of work) {
    const request = await db.craftRequest.findFirst({ where: { id: row.order, guildId }, select: { id: true, status: true, requesterId: true, crafterId: true } });
    if (!request || request.requesterId === row.memberId) continue;
    const character = clean(row.character, 60);
    const claimData = { status: "CLAIMED" as const, crafterId: row.memberId, claimedAt: now, crafterCharacter: character, claimSource: "game" };
    let changed = false;
    if (row.action === "claim" && request.status === "OPEN") {
      changed = (await db.craftRequest.updateMany({ where: { id: request.id, status: "OPEN" }, data: claimData })).count === 1;
    } else if (row.action === "done" && request.status === "OPEN") {
      changed = (await db.craftRequest.updateMany({ where: { id: request.id, status: "OPEN" }, data: { ...claimData, status: "DONE", doneAt: now } })).count === 1;
    } else if (row.action === "done" && request.status === "CLAIMED" && request.crafterId === row.memberId) {
      changed = (await db.craftRequest.updateMany({ where: { id: request.id, status: "CLAIMED", crafterId: row.memberId }, data: { status: "DONE", doneAt: now, crafterCharacter: character } })).count === 1;
    } else if (row.action === "release" && request.status === "CLAIMED" && request.crafterId === row.memberId) {
      changed = (await db.craftRequest.updateMany({ where: { id: request.id, status: "CLAIMED", crafterId: row.memberId }, data: { status: "OPEN", crafterId: null, claimedAt: null, crafterCharacter: null, claimSource: null } })).count === 1;
    }
    if (changed) changes.push({ requestId: request.id, action: row.action, memberId: row.memberId, character });
  }
  return changes;
}

// ---------------------------------------------------------------------------------------------
// The recipe behind a request typed in Discord
// ---------------------------------------------------------------------------------------------

/** The addon key of a typed item: a number (item id, or minus an enchant's spell id) or the one recorded recipe of that exact name. */
export async function resolveItemKey(db: Pick<PrismaClient, "recipeKnown">, guildId: string, item: string): Promise<number | null> {
  const text = item.trim();
  const id = /^-?\d{1,7}$/.exec(text)?.[0] ?? /item[=:](\d{1,7})/.exec(text)?.[1];
  if (id && Number(id) !== 0) return Number(id);
  if (text.length < 2) return null;
  const rows = await db.recipeKnown.findMany({ where: { guildId, itemName: { equals: text, mode: "insensitive" } }, select: { itemKey: true }, distinct: ["itemKey"], take: 2 });
  return rows.length === 1 ? rows[0]!.itemKey : null;
}
