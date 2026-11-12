import type { CraftRequestStatus, PrismaClient } from "../generated/prisma/client.js";
import { characterTrustMap } from "./character-trust.js";
import { normalizeProfessionName } from "./profession-names.js";
import { serializeByKey } from "./transaction-retry.js";

// Crafting orders in game (docs/plans/CRAFTING_ORDERS.md). Discord craft requests go to the addon's
// Orders page through the standings feed (craftOrders, shared), and crafters claim, finish or give
// them back in game. Their actions come back in uploads: the member's own (their pairing) and the
// ones a guildmate's addon heard on GUILD (relayed, by the sender's name). The same rules as the
// Discord buttons apply, and an action already reflected changes nothing.

export const ORDER_LIMITS = { open: 40, done: 10, doneWindowMs: 86_400_000 } as const;

const clean = (value: string | null | undefined, max: number) => (value ?? "").replace(/[|\p{Cc}]/gu, " ").replace(/\s+/g, " ").trim().slice(0, max);
const epoch = (date: Date | null | undefined) => date ? Math.floor(date.getTime() / 1000) : undefined;

export interface AddonOrder {
  id: string; ref?: string; key?: number; item: string; qty: number; prof?: string; status: CraftRequestStatus;
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
      // A request made in game: its addon id, so the in-game row becomes this order once the bot has created it.
      ...(row.gameRef ? { ref: clean(row.gameRef, 40) } : {}),
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

export type OrderAction = "claim" | "done" | "release" | "cancel";
export interface AddonOrderAction { order: string; action: OrderAction; character: string; at: number; name?: string }

const ACTIONS = new Set<OrderAction>(["claim", "done", "release", "cancel"]);
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
 * order; only its crafter finishes or gives it back; only its requester cancels it (an open or claimed request). "done" on an open order claims and finishes it
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
    if (!request) continue;
    const character = clean(row.character, 60);
    if (row.action === "cancel") {
      if (request.requesterId !== row.memberId || (request.status !== "OPEN" && request.status !== "CLAIMED")) continue;
      const cancelled = (await db.craftRequest.updateMany({ where: { id: request.id, requesterId: row.memberId, status: { in: ["OPEN", "CLAIMED"] } }, data: { status: "CANCELLED" } })).count === 1;
      if (cancelled) changes.push({ requestId: request.id, action: row.action, memberId: row.memberId, character });
      continue;
    }
    if (request.requesterId === row.memberId) continue;
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

// ---------------------------------------------------------------------------------------------
// Requests made in game
// ---------------------------------------------------------------------------------------------

/** At most this many open (open or claimed) requests per member, whoever carried them; rows older than `ageMs` are dropped. */
export const REQUEST_LIMITS = { open: 5, ageMs: 3 * 86_400_000, perUpload: 10 } as const;

export interface AddonOrderRequest {
  ref: string; item: string; qty: number; mats: boolean; character: string; at: number;
  key?: number; prof?: string; note?: string; asked?: string;
  /** Relayed rows only: the sender, as the game reported it. The requester is found from this name, never from an id. */
  name?: string;
}

const isKey = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value !== 0 && Math.abs(value) <= 9_999_999;

/** Rows from the addon (own, or heard on GUILD with the sender's `name`); malformed rows are dropped. Ids from the addon are never read. */
export function parseAddonOrderRequests(rows: readonly unknown[], relayed = false): AddonOrderRequest[] {
  return rows.flatMap((row): AddonOrderRequest[] => {
    if (!row || typeof row !== "object") return [];
    const { ref, item, key, prof, qty, note, mats, asked, character, at, name } = row as Record<string, unknown>;
    if (typeof ref !== "string" || !/^[A-Za-z0-9_-]{6,40}$/.test(ref)) return [];
    if (typeof item !== "string" || clean(item, 100).length < 2) return [];
    if (!isName(character) || !isEpoch(at) || (relayed && !isName(name))) return [];
    if (key !== undefined && !isKey(key)) return [];
    if (qty !== undefined && (typeof qty !== "number" || !Number.isInteger(qty) || qty < 1 || qty > 200)) return [];
    const profession = typeof prof === "string" && clean(prof, 40) ? normalizeProfessionName(clean(prof, 40)).slice(0, 40) : undefined;
    const askedName = isName(asked) ? asked.trim().slice(0, 60) : undefined;
    const text = typeof note === "string" ? clean(note, 300) : "";
    return [{
      ref, item: clean(item, 100), qty: (qty as number | undefined) ?? 1, mats: mats === true, character: character.trim(), at,
      ...(key !== undefined ? { key } : {}), ...(profession ? { prof: profession } : {}), ...(text ? { note: text } : {}),
      ...(askedName ? { asked: askedName } : {}), ...(relayed ? { name: (name as string).trim() } : {})
    }];
  }).slice(0, relayed ? 60 : 20);
}

type RequestDb = Pick<PrismaClient, "craftRequest" | "character" | "guildSettings" | "recipeKnown" | "characterVerifyClaim" | "guildRosterEntry">;
export interface CreatedOrderRequest { id: string; memberId: string; relayed: boolean }

/**
 * Creates the requests made in game. The requester is the owner of the requesting CHARACTER, found by name among the
 * server's active members and only when that link is confirmed (character-trust.ts: a reported-only character is refused);
 * a Discord or member id sent by the addon is never read. An own request needs a character of the uploader, a relayed one
 * (a guildmate's companion carried it) a character of someone else, and is marked with that uploader (`relayedById`).
 * Each `gameRef` creates one request per server, a member has at most REQUEST_LIMITS.open open ones, and the setting that
 * turns crafting orders in game off turns this off. Returns what was created, in order.
 */
export async function applyOrderRequests(db: RequestDb, guildId: string, uploaderMemberId: string, own: readonly AddonOrderRequest[], relayed: readonly AddonOrderRequest[], now = new Date()): Promise<CreatedOrderRequest[]> {
  if (!own.length && !relayed.length) return [];
  const settings = await db.guildSettings.findUnique({ where: { guildId }, select: { craftOrdersInGame: true } });
  if (settings?.craftOrdersInGame === false) return [];
  const fresh = (row: AddonOrderRequest) => row.at >= (now.getTime() - REQUEST_LIMITS.ageMs) / 1000 && row.at <= now.getTime() / 1000 + 3600;
  const work = [
    ...own.filter(fresh).map((row) => ({ row, who: row.character, relayed: false })),
    ...relayed.filter(fresh).map((row) => ({ row, who: row.name!, relayed: true }))
  ].sort((a, b) => a.row.at - b.row.at).slice(0, REQUEST_LIMITS.perUpload * 3);
  if (!work.length) return [];
  const wanted = new Set(work.map((entry) => entry.who.toLowerCase()));
  const candidates = (await db.character.findMany({
    where: { member: { guildId, status: "ACTIVE" } },
    select: { id: true, name: true, displayName: true, realm: true, gameEdition: true, memberId: true, confirmedAt: true, linkEvidence: true }
  })).filter((character) => [character.name, character.displayName].some((key) => key && wanted.has(key.toLowerCase())));
  const trust = await characterTrustMap(db, guildId, candidates);
  // name -> owner, for confirmed characters only; a name two members could claim is refused (null).
  const owners = new Map<string, string | null>();
  for (const character of candidates) {
    if (trust.get(character.id) !== "confirmed") continue;
    for (const key of [character.name, character.displayName]) {
      if (!key || !wanted.has(key.toLowerCase())) continue;
      const known = owners.get(key.toLowerCase());
      owners.set(key.toLowerCase(), known === undefined || known === character.memberId ? character.memberId : null);
    }
  }
  const created: CreatedOrderRequest[] = [];
  for (const { row, who, relayed: isRelayed } of work) {
    if (created.length >= REQUEST_LIMITS.perUpload) break;
    const memberId = owners.get(who.toLowerCase());
    if (!memberId) continue;
    if (isRelayed ? memberId === uploaderMemberId : memberId !== uploaderMemberId) continue;
    // Count-then-create runs one at a time per member, so parallel uploads cannot pass the limit together.
    const request = await serializeByKey(`craft-request:${guildId}:${memberId}`, async () => {
      // The ref is the requester's own: another member's identical ref never blocks it.
      if (await db.craftRequest.findFirst({ where: { guildId, requesterId: memberId, gameRef: row.ref }, select: { id: true } })) return null;
      const open = await db.craftRequest.count({ where: { guildId, requesterId: memberId, status: { in: ["OPEN", "CLAIMED"] } } });
      if (open >= REQUEST_LIMITS.open) return null;
      const itemKey = await trustedKey(db, guildId, row);
      try {
        return await db.craftRequest.create({
          data: {
            guildId, requesterId: memberId, item: row.item, quantity: row.qty, materialsProvided: row.mats,
            profession: row.prof ?? null, note: row.note ?? null, itemKey, askedCharacter: row.asked ?? null,
            gameRef: row.ref, relayedById: isRelayed ? uploaderMemberId : null
          },
          select: { id: true }
        });
      } catch (error) {
        if ((error as { code?: string }).code !== "P2002") throw error;   // the same ref twice at once: the other one won
        return null;
      }
    });
    if (request) created.push({ id: request.id, memberId, relayed: isRelayed });
  }
  return created;
}

/** The addon's key is used only when this server's recipes know that key under that exact name; otherwise it comes from the name, as for Discord requests. */
async function trustedKey(db: Pick<PrismaClient, "recipeKnown">, guildId: string, row: AddonOrderRequest): Promise<number | null> {
  if (row.key !== undefined) {
    const known = await db.recipeKnown.findFirst({ where: { guildId, itemKey: row.key, itemName: { equals: row.item, mode: "insensitive" } }, select: { itemKey: true } });
    if (known) return row.key;
  }
  return resolveItemKey(db, guildId, row.item);
}

/** Requests from game that were created but never reached Discord (no forum thread and no orders-channel line): the next upload posts them again. At most `take`, none older than a day. */
export async function unpostedGameRequests(db: Pick<PrismaClient, "craftRequest">, guildId: string, now = new Date(), take = 3): Promise<string[]> {
  const rows = await db.craftRequest.findMany({
    where: { guildId, gameRef: { not: null }, status: "OPEN", threadId: null, orderMessageId: null, createdAt: { gte: new Date(now.getTime() - 86_400_000) } },
    select: { id: true }, orderBy: { createdAt: "asc" }, take
  });
  return rows.map((row) => row.id);
}
