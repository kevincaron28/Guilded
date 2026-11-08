import type { PrismaClient } from "../generated/prisma/client.js";
import type { AlbumLang } from "./companion-album.js";
import { CARD_BY_KEY, RARITY_LABEL, type Rarity } from "./tcg-catalogue.js";
import { TcgError } from "./tcg-store.js";

// Guilded Clash stage D: guild-only card trading (docs/plans/APP_TCG_GAME.md section 6). No gold, EP/GP or money: cards only.
//
// A trade is an offer between two members of the same Discord server. Either side may edit the offer; any change resets both
// confirmations and locks confirming for 10 seconds, and an offer expires after 24 hours. When both have confirmed, the trade
// is revalidated from scratch (ownership, locks, limits, eligibility, value) and the cards move in one transaction, guarded by
// a compare-and-set on the offer's version so a double confirm can never pay twice. Every offer and every step is kept
// (`TcgTrade`, `TcgTradeEvent`) as the audit log.
//
// Today every owned card is a single copy (extras become dust), so a trade moves the card itself and the receiver must not own it.

export const TRADE_VALUE: Record<Rarity, number> = { common: 1, uncommon: 3, rare: 10, epic: 40, legendary: 120 };
export const MAX_CARDS_PER_SIDE = 5;
export const TRADES_PER_DAY = 5;
export const GIFTS_PER_DAY = 3;
/** One trade that moves a Legendary (given or received) per account per week. */
export const LEGENDARY_TRADES_PER_WEEK = 1;
export const RECEIVED_LOCK_MS = 24 * 3_600_000;
export const OFFER_TTL_MS = 24 * 3_600_000;
export const CONFIRM_LOCK_MS = 10_000;
export const MIN_ACCOUNT_AGE_MS = 7 * 86_400_000;
export const MIN_PLAYED_MATCHES = 5;
export const MAX_OPEN_OFFERS = 10;
/** Value above which a member's net inflow over 7 days is flagged for officers. */
export const NET_INFLOW_FLAG = 100;
export const YOUNG_ACCOUNT_FLAG_MS = 14 * 86_400_000;

type Tx = Pick<PrismaClient, "tcgCard" | "tcgLog" | "tcgAccount" | "tcgPlayer" | "tcgTrade" | "tcgTradeEvent" | "member" | "character" | "guildSettings">;
export type TradeDb = Tx & { $transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> };

// ---- pure rules ----

export type CardProblem = "unknown" | "bound" | "locked" | "missing";

/** Why a card cannot be traded, or null. Achievement cards (badges) and anything not in the catalogue are bound to the account. */
export function cardProblem(key: string, row: { firstSeenAt: Date } | undefined, now: Date): CardProblem | null {
  const def = CARD_BY_KEY.get(key);
  if (!def) return "unknown";
  if (def.family === "badge") return "bound";
  if (!row) return "missing";
  if (row.firstSeenAt.getTime() + RECEIVED_LOCK_MS > now.getTime()) return "locked";
  return null;
}

export const valueOf = (keys: readonly string[]): number => keys.reduce((sum, key) => sum + (CARD_BY_KEY.has(key) ? TRADE_VALUE[CARD_BY_KEY.get(key)!.rarity] : 0), 0);
export const hasLegendary = (keys: readonly string[]): boolean => keys.some(key => CARD_BY_KEY.get(key)?.rarity === "legendary");

/** The two sides of a swap must be within 25% or 5 points of each other, whichever is larger. */
export function valueWindowOk(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(5, Math.max(a, b) * 0.25);
}

const dayStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

const MESSAGES: Record<CardProblem, string> = {
  unknown: "One of those cards does not exist.", bound: "Achievement and Standard cards are bound to the account and cannot be traded.",
  locked: "A card you got in the last 24 hours (from a pack, a craft or a trade) cannot be traded yet.", missing: "A card in this offer is not owned."
};

// ---- shapes ----

interface TradeRow {
  id: string; guildId: string; fromUser: string; toUser: string; kind: string; fromCards: unknown; toCards: unknown; fromValue: number; toValue: number; legendary: boolean;
  status: string; fromConfirmed: boolean; toConfirmed: boolean; lockedUntil: Date; expiresAt: Date; version: number; flags: unknown; createdAt: Date; completedAt: Date | null;
}
const keysOf = (value: unknown): string[] => Array.isArray(value) ? value.filter((x): x is string => typeof x === "string") : [];

export interface TradeCardView { key: string; name: string; rarity: Rarity; rarityLabel: string; value: number }
export interface TradeView {
  id: string; status: "open" | "done" | "cancelled" | "expired"; kind: "swap" | "gift";
  /** "from" if you made the offer, "to" if you received it. */
  you: "from" | "to";
  partner: { discordUserId: string; name: string | null };
  /** What you give and what you get. */
  give: TradeCardView[]; get: TradeCardView[]; giveValue: number; getValue: number;
  youConfirmed: boolean; partnerConfirmed: boolean;
  lockedUntil: string; lockSecondsLeft: number; expiresAt: string; createdAt: string; completedAt: string | null;
}

function cardView(key: string, lang: AlbumLang): TradeCardView {
  const def = CARD_BY_KEY.get(key)!;
  return { key, name: def[lang].name, rarity: def.rarity, rarityLabel: RARITY_LABEL[def.rarity][lang], value: TRADE_VALUE[def.rarity] };
}

async function viewOf(db: Pick<Tx, "member">, row: TradeRow, userId: string, lang: AlbumLang, now: Date): Promise<TradeView> {
  const mine = row.fromUser === userId;
  const partnerId = mine ? row.toUser : row.fromUser;
  const partner = await db.member.findFirst({ where: { guildId: row.guildId, discordUserId: partnerId }, select: { displayName: true } });
  const from = keysOf(row.fromCards).filter(k => CARD_BY_KEY.has(k)).map(k => cardView(k, lang));
  const to = keysOf(row.toCards).filter(k => CARD_BY_KEY.has(k)).map(k => cardView(k, lang));
  return {
    id: row.id, status: row.status as TradeView["status"], kind: row.kind as TradeView["kind"], you: mine ? "from" : "to", partner: { discordUserId: partnerId, name: partner?.displayName ?? null },
    give: mine ? from : to, get: mine ? to : from, giveValue: mine ? row.fromValue : row.toValue, getValue: mine ? row.toValue : row.fromValue,
    youConfirmed: mine ? row.fromConfirmed : row.toConfirmed, partnerConfirmed: mine ? row.toConfirmed : row.fromConfirmed,
    lockedUntil: row.lockedUntil.toISOString(), lockSecondsLeft: Math.max(0, Math.ceil((row.lockedUntil.getTime() - now.getTime()) / 1000)),
    expiresAt: row.expiresAt.toISOString(), createdAt: row.createdAt.toISOString(), completedAt: row.completedAt?.toISOString() ?? null
  };
}

const event = (tx: Pick<Tx, "tcgTradeEvent">, tradeId: string, actor: string, kind: string, detail: Record<string, unknown> = {}) =>
  tx.tcgTradeEvent.create({ data: { tradeId, actor, kind, detail: detail as never } });

// ---- eligibility and the shared server ----

/** Why a member cannot trade at all, or null. Needs a collection that is 7 days old and 5 played matches; trading must be on for them. */
export async function personalProblem(tx: Pick<Tx, "tcgAccount" | "tcgPlayer">, userId: string, now: Date): Promise<string | null> {
  const [account, player] = await Promise.all([tx.tcgAccount.findUnique({ where: { discordUserId: userId } }), tx.tcgPlayer.findUnique({ where: { discordUserId: userId } })]);
  if (player?.tradeBanned) return "Trading is removed for this account.";
  if (player?.tradingOff) return "Trading is switched off for this account.";
  if (!account || account.createdAt.getTime() + MIN_ACCOUNT_AGE_MS > now.getTime()) return "Trading opens once your collection is 7 days old.";
  if ((player?.playedCounted ?? 0) < MIN_PLAYED_MATCHES) return `Trading opens after ${MIN_PLAYED_MATCHES} played matches.`;
  return null;
}

/** The server two members share where the card game and trading are on and both have a linked character. Null when there is none. */
export async function sharedGuild(tx: Pick<Tx, "member" | "character" | "guildSettings">, a: string, b: string, allows: (discordGuildId: string) => boolean): Promise<string | null> {
  if (a === b) return null;
  const rows = await tx.member.findMany({ where: { discordUserId: { in: [a, b] }, status: "ACTIVE", isTest: false }, select: { id: true, guildId: true, discordUserId: true, guild: { select: { discordId: true } } }, take: 100 });
  const byGuild = new Map<string, Map<string, string>>();
  for (const row of rows) if (allows(row.guild.discordId)) byGuild.set(row.guildId, (byGuild.get(row.guildId) ?? new Map()).set(row.discordUserId, row.id));
  for (const [guildId, people] of byGuild) {
    if (!people.has(a) || !people.has(b)) continue;
    const off = await tx.guildSettings.findFirst({ where: { guildId, OR: [{ tcgEnabled: false }, { tcgTradingEnabled: false }] }, select: { guildId: true } });
    if (off) continue;
    const linked = await Promise.all([people.get(a)!, people.get(b)!].map(memberId => tx.character.count({ where: { memberId } })));
    if (linked.every(count => count > 0)) return guildId;
  }
  return null;
}

// ---- validating an offer ----

interface Sides { from: string; to: string; fromCards: string[]; toCards: string[] }

function cleanKeys(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MAX_CARDS_PER_SIDE) throw new TcgError(`At most ${MAX_CARDS_PER_SIDE} cards a side.`, 400);
  const keys = value.map(v => { if (typeof v !== "string" || v.length > 80) throw new TcgError("Cards are listed by key.", 400); return v; });
  if (new Set(keys).size !== keys.length) throw new TcgError("A card can only be listed once.", 400);
  return keys;
}

/** Checks the cards, the value window and the gift rule against what the two members own right now. Throws TcgError. */
async function checkSides(tx: Pick<Tx, "tcgCard">, sides: Sides, now: Date): Promise<{ kind: "swap" | "gift"; fromValue: number; toValue: number }> {
  const { from, to, fromCards, toCards } = sides;
  if (!fromCards.length) throw new TcgError("Offer at least one card of your own.", 400);
  const kind = toCards.length ? "swap" : "gift";
  const owned = async (user: string, keys: string[]) => keys.length ? new Map((await tx.tcgCard.findMany({ where: { discordUserId: user, cardKey: { in: keys } }, select: { cardKey: true, firstSeenAt: true }, take: 100 })).map(r => [r.cardKey, r])) : new Map<string, { cardKey: string; firstSeenAt: Date }>();
  const [fromOwned, toOwned, fromTargetOwned, toTargetOwned] = await Promise.all([owned(from, fromCards), owned(to, toCards), owned(to, fromCards), owned(from, toCards)]);
  for (const key of fromCards) { const problem = cardProblem(key, fromOwned.get(key), now); if (problem) throw new TcgError(MESSAGES[problem], problem === "unknown" ? 404 : 409); }
  for (const key of toCards) { const problem = cardProblem(key, toOwned.get(key), now); if (problem) throw new TcgError(MESSAGES[problem], problem === "unknown" ? 404 : 409); }
  if (fromCards.some(key => fromTargetOwned.has(key)) || toCards.some(key => toTargetOwned.has(key))) throw new TcgError("A card in this offer is already in the other collection.", 409);
  const fromValue = valueOf(fromCards), toValue = valueOf(toCards);
  if (kind === "gift") {
    if (fromCards.some(key => { const r = CARD_BY_KEY.get(key)!.rarity; return r !== "common" && r !== "uncommon"; })) throw new TcgError("Only Common and Uncommon cards can be gifted. Ask for a card in return for anything better.", 409);
  } else if (!valueWindowOk(fromValue, toValue)) throw new TcgError("The two sides are too far apart in value (within 25% or 5 points).", 409);
  return { kind, fromValue, toValue };
}

const loadTrade = async (tx: Pick<Tx, "tcgTrade">, id: string, userId: string): Promise<TradeRow> => {
  const row = await tx.tcgTrade.findFirst({ where: { id, OR: [{ fromUser: userId }, { toUser: userId }] } }) as TradeRow | null;
  if (!row) throw new TcgError("That trade does not exist.", 404);
  return row;
};

/** Marks an open offer past its time as expired. Returns the row as it now stands. */
async function expireIfDue(tx: Pick<Tx, "tcgTrade" | "tcgTradeEvent">, row: TradeRow, now: Date): Promise<TradeRow> {
  if (row.status !== "open" || row.expiresAt.getTime() > now.getTime()) return row;
  const done = await tx.tcgTrade.updateMany({ where: { id: row.id, version: row.version, status: "open" }, data: { status: "expired", version: row.version + 1 } });
  if (done.count === 1) { await event(tx, row.id, "system", "expired"); return { ...row, status: "expired", version: row.version + 1 }; }
  return row;
}

// ---- the store ----

export interface OfferInput { to: string; give: unknown; want: unknown }

export async function offerTrade(db: TradeDb, userId: string, input: OfferInput, lang: AlbumLang, allows: (id: string) => boolean, now = new Date()): Promise<TradeView> {
  const fromCards = cleanKeys(input.give), toCards = cleanKeys(input.want);
  return db.$transaction(async tx => {
    for (const user of [userId, input.to]) { const problem = await personalProblem(tx, user, now); if (problem) throw new TcgError(user === userId ? problem : "That member cannot trade yet.", 409); }
    const guildId = await sharedGuild(tx, userId, input.to, allows);
    if (!guildId) throw new TcgError("You can only trade with a guildmate who has Guilded, a linked character and trading switched on.", 403);
    const open = await tx.tcgTrade.count({ where: { fromUser: userId, status: "open" } });
    if (open >= MAX_OPEN_OFFERS) throw new TcgError(`You already have ${MAX_OPEN_OFFERS} open offers. Cancel one first.`, 409);
    const checked = await checkSides(tx, { from: userId, to: input.to, fromCards, toCards }, now);
    const row = await tx.tcgTrade.create({ data: {
      guildId, fromUser: userId, toUser: input.to, kind: checked.kind, fromCards: fromCards as never, toCards: toCards as never, fromValue: checked.fromValue, toValue: checked.toValue,
      legendary: hasLegendary([...fromCards, ...toCards]), lockedUntil: new Date(now.getTime() + CONFIRM_LOCK_MS), expiresAt: new Date(now.getTime() + OFFER_TTL_MS)
    } }) as TradeRow;
    await event(tx, row.id, userId, "offered", { fromCards, toCards, kind: checked.kind });
    return viewOf(tx, row, userId, lang, now);
  });
}

/** Either side replaces both lists (an offer found overdue is expired and returned as such). Both confirmations reset and the 10 second lock starts again. */
export async function editTrade(db: TradeDb, userId: string, id: string, input: { give: unknown; want: unknown }, lang: AlbumLang, now = new Date()): Promise<TradeView> {
  const mineGive = cleanKeys(input.give), mineWant = cleanKeys(input.want);
  return db.$transaction(async tx => {
    let row = await loadTrade(tx, id, userId);
    row = await expireIfDue(tx, row, now);
    if (row.status === "expired") return viewOf(tx, row, userId, lang, now);
    if (row.status !== "open") throw new TcgError(`That trade is ${row.status}.`, 409);
    const proposer = row.fromUser === userId;
    const fromCards = proposer ? mineGive : mineWant, toCards = proposer ? mineWant : mineGive;
    const checked = await checkSides(tx, { from: row.fromUser, to: row.toUser, fromCards, toCards }, now);
    const lockedUntil = new Date(now.getTime() + CONFIRM_LOCK_MS);
    const saved = await tx.tcgTrade.updateMany({ where: { id, version: row.version, status: "open" }, data: {
      kind: checked.kind, fromCards: fromCards as never, toCards: toCards as never, fromValue: checked.fromValue, toValue: checked.toValue, legendary: hasLegendary([...fromCards, ...toCards]),
      fromConfirmed: false, toConfirmed: false, lockedUntil, version: row.version + 1
    } });
    if (saved.count !== 1) throw new TcgError("That trade just changed. Refresh and try again.", 409);
    await event(tx, id, userId, "edited", { fromCards, toCards, kind: checked.kind });
    return viewOf(tx, { ...row, kind: checked.kind, fromCards, toCards, fromValue: checked.fromValue, toValue: checked.toValue, fromConfirmed: false, toConfirmed: false, lockedUntil, version: row.version + 1 }, userId, lang, now);
  });
}

async function limitProblem(tx: Pick<Tx, "tcgTrade">, row: TradeRow, now: Date): Promise<string | null> {
  const today = dayStart(now), week = new Date(now.getTime() - 7 * 86_400_000);
  for (const user of [row.fromUser, row.toUser]) {
    const who = user === row.fromUser ? "You have" : "The other member has";
    const youOrThem = (text: string) => text.replace("%", who);
    const involved = { OR: [{ fromUser: user }, { toUser: user }] };
    if (row.kind === "swap") {
      const swaps = await tx.tcgTrade.count({ where: { status: "done", kind: "swap", completedAt: { gte: today }, ...involved } });
      if (swaps >= TRADES_PER_DAY) return youOrThem(`% reached ${TRADES_PER_DAY} trades today.`);
    } else {
      const gifts = await tx.tcgTrade.count({ where: { status: "done", kind: "gift", completedAt: { gte: today }, ...involved } });
      if (gifts >= GIFTS_PER_DAY) return youOrThem(`% reached ${GIFTS_PER_DAY} gifts today.`);
    }
    if (row.legendary) {
      const legendary = await tx.tcgTrade.count({ where: { status: "done", legendary: true, completedAt: { gte: week }, ...involved } });
      if (legendary >= LEGENDARY_TRADES_PER_WEEK) return youOrThem("% already traded a Legendary this week.");
    }
  }
  return null;
}

/** Net value each member received over the last 7 days, this trade included. Large inflows are flagged for officers. */
async function flagsFor(tx: Pick<Tx, "tcgTrade" | "tcgAccount">, row: TradeRow, now: Date): Promise<string[]> {
  const flags: string[] = [];
  const week = new Date(now.getTime() - 7 * 86_400_000);
  for (const user of [row.fromUser, row.toUser]) {
    const past = await tx.tcgTrade.findMany({ where: { status: "done", completedAt: { gte: week }, OR: [{ fromUser: user }, { toUser: user }] }, select: { fromUser: true, fromValue: true, toValue: true }, take: 500 });
    let net = user === row.fromUser ? row.toValue - row.fromValue : row.fromValue - row.toValue;
    for (const trade of past) net += trade.fromUser === user ? trade.toValue - trade.fromValue : trade.fromValue - trade.toValue;
    if (net > NET_INFLOW_FLAG) flags.push(`inflow:${user}:${net}`);
    const account = await tx.tcgAccount.findUnique({ where: { discordUserId: user }, select: { createdAt: true } });
    if (account && account.createdAt.getTime() + YOUNG_ACCOUNT_FLAG_MS > now.getTime()) flags.push(`young:${user}`);
  }
  return flags;
}

/** Confirms the offer for the caller. When both sides have confirmed the trade is revalidated and executed in the same transaction. */
export async function confirmTrade(db: TradeDb, userId: string, id: string, lang: AlbumLang, allows: (id: string) => boolean, now = new Date()): Promise<TradeView> {
  return db.$transaction(async tx => {
    let row = await loadTrade(tx, id, userId);
    row = await expireIfDue(tx, row, now);
    const mine = row.fromUser === userId;
    // A repeated confirm (a double tap, or the second phone) is harmless.
    if (row.status === "done" || (row.status === "open" && (mine ? row.fromConfirmed : row.toConfirmed))) return viewOf(tx, row, userId, lang, now);
    if (row.status === "expired") return viewOf(tx, row, userId, lang, now);
    if (row.status !== "open") throw new TcgError(`That trade is ${row.status}.`, 409);
    if (row.lockedUntil.getTime() > now.getTime()) throw new TcgError(`Look over the cards first: you can confirm in ${Math.ceil((row.lockedUntil.getTime() - now.getTime()) / 1000)} seconds.`, 409);
    const fromConfirmed = row.fromConfirmed || mine, toConfirmed = row.toConfirmed || !mine;
    if (!(fromConfirmed && toConfirmed)) {
      const saved = await tx.tcgTrade.updateMany({ where: { id, version: row.version, status: "open" }, data: mine ? { fromConfirmed: true, version: row.version + 1 } : { toConfirmed: true, version: row.version + 1 } });
      if (saved.count !== 1) throw new TcgError("That trade just changed. Refresh and try again.", 409);
      await event(tx, id, userId, "confirmed");
      return viewOf(tx, { ...row, fromConfirmed, toConfirmed, version: row.version + 1 }, userId, lang, now);
    }
    // Both confirmed: check everything again as it stands now.
    for (const user of [row.fromUser, row.toUser]) { const problem = await personalProblem(tx, user, now); if (problem) throw new TcgError(user === userId ? problem : "The other member can no longer trade.", 409); }
    if (await sharedGuild(tx, row.fromUser, row.toUser, allows) !== row.guildId) throw new TcgError("Trading is no longer available between you two.", 403);
    const fromCards = keysOf(row.fromCards), toCards = keysOf(row.toCards);
    const checked = await checkSides(tx, { from: row.fromUser, to: row.toUser, fromCards, toCards }, now);
    const limit = await limitProblem(tx, row, now);
    if (limit) throw new TcgError(limit, 409);
    const flags = await flagsFor(tx, { ...row, fromValue: checked.fromValue, toValue: checked.toValue }, now);
    const saved = await tx.tcgTrade.updateMany({ where: { id, version: row.version, status: "open" }, data: { fromConfirmed, toConfirmed, status: "done", completedAt: now, flags: flags as never, version: row.version + 1 } });
    if (saved.count !== 1) throw new TcgError("That trade just changed. Refresh and try again.", 409);
    // The cards move. Each deletion must find the card it expects, so a card pledged in two trades can never leave twice.
    const move = async (keys: string[], giver: string, receiver: string) => {
      for (const key of keys) {
        const removed = await tx.tcgCard.deleteMany({ where: { discordUserId: giver, cardKey: key } });
        if (removed.count !== 1) throw new TcgError("A card in this trade is no longer there.", 409);
        await tx.tcgCard.create({ data: { discordUserId: receiver, cardKey: key, count: 1, firstSeenAt: now } });
      }
    };
    await move(fromCards, row.fromUser, row.toUser);
    await move(toCards, row.toUser, row.fromUser);
    await tx.tcgLog.create({ data: { discordUserId: row.fromUser, kind: "trade", cards: { id, gave: fromCards, got: toCards } as never, dustDelta: 0 } });
    await tx.tcgLog.create({ data: { discordUserId: row.toUser, kind: "trade", cards: { id, gave: toCards, got: fromCards } as never, dustDelta: 0 } });
    await event(tx, id, userId, "completed", { fromCards, toCards, fromValue: checked.fromValue, toValue: checked.toValue, flags });
    return viewOf(tx, { ...row, fromConfirmed, toConfirmed, status: "done", completedAt: now, version: row.version + 1 }, userId, lang, now);
  });
}

/** Either side withdraws an open offer. Nothing moves. */
export async function cancelTrade(db: TradeDb, userId: string, id: string, lang: AlbumLang, now = new Date()): Promise<TradeView> {
  return db.$transaction(async tx => {
    let row = await loadTrade(tx, id, userId);
    row = await expireIfDue(tx, row, now);
    if (row.status === "expired") return viewOf(tx, row, userId, lang, now);
    if (row.status !== "open") throw new TcgError(`That trade is ${row.status}.`, 409);
    const saved = await tx.tcgTrade.updateMany({ where: { id, version: row.version, status: "open" }, data: { status: "cancelled", version: row.version + 1 } });
    if (saved.count !== 1) throw new TcgError("That trade just changed. Refresh and try again.", 409);
    await event(tx, id, userId, "cancelled");
    return viewOf(tx, { ...row, status: "cancelled", version: row.version + 1 }, userId, lang, now);
  });
}

export async function getTrade(db: TradeDb, userId: string, id: string, lang: AlbumLang, now = new Date()): Promise<TradeView> {
  return db.$transaction(async tx => viewOf(tx, await expireIfDue(tx, await loadTrade(tx, id, userId), now), userId, lang, now));
}

/** The member's trades, newest first. Overdue open offers are expired on the way. */
export async function listTrades(db: TradeDb, userId: string, lang: AlbumLang, now = new Date(), limit = 40): Promise<{ trades: TradeView[] }> {
  return db.$transaction(async tx => {
    const rows = await tx.tcgTrade.findMany({ where: { OR: [{ fromUser: userId }, { toUser: userId }] }, orderBy: { createdAt: "desc" }, take: Math.min(limit, 100) }) as TradeRow[];
    const out: TradeView[] = [];
    for (const row of rows) out.push(await viewOf(tx, await expireIfDue(tx, row, now), userId, lang, now));
    return { trades: out };
  });
}

export interface TradableCard extends TradeCardView { tradable: boolean; reason: CardProblem | null; tradableAt: string | null }

/** The member's cards with what blocks each one from trading. */
export async function tradableCards(db: Pick<Tx, "tcgCard" | "tcgAccount" | "tcgPlayer">, userId: string, lang: AlbumLang, now = new Date()): Promise<{ eligible: boolean; reason: string | null; cards: TradableCard[] }> {
  const rows = await db.tcgCard.findMany({ where: { discordUserId: userId }, select: { cardKey: true, firstSeenAt: true }, take: 1000 });
  const reason = await personalProblem(db, userId, now);
  const cards = rows.filter(r => CARD_BY_KEY.has(r.cardKey)).map((r): TradableCard => {
    const problem = cardProblem(r.cardKey, r, now);
    return { ...cardView(r.cardKey, lang), tradable: problem === null, reason: problem, tradableAt: problem === "locked" ? new Date(r.firstSeenAt.getTime() + RECEIVED_LOCK_MS).toISOString() : null };
  });
  return { eligible: reason === null, reason, cards };
}

/** Guildmates the member could trade with right now: same server, trading on, linked character, eligible. */
export async function tradePartners(db: TradeDb, userId: string, allows: (id: string) => boolean, now = new Date()): Promise<{ partners: { discordUserId: string; name: string }[] }> {
  return db.$transaction(async tx => {
    const mine = await tx.member.findMany({ where: { discordUserId: userId, status: "ACTIVE", isTest: false }, select: { guildId: true, guild: { select: { discordId: true } } }, take: 25 });
    const guilds = mine.filter(m => allows(m.guild.discordId)).map(m => m.guildId);
    if (!guilds.length) return { partners: [] };
    const others = await tx.member.findMany({ where: { guildId: { in: guilds }, discordUserId: { not: userId }, status: "ACTIVE", isTest: false }, select: { discordUserId: true, displayName: true }, take: 300 });
    const seen = new Set<string>(), partners: { discordUserId: string; name: string }[] = [];
    for (const other of others) {
      if (seen.has(other.discordUserId)) continue;
      seen.add(other.discordUserId);
      if (await personalProblem(tx, other.discordUserId, now)) continue;
      if (await sharedGuild(tx, userId, other.discordUserId, allows)) partners.push({ discordUserId: other.discordUserId, name: other.displayName });
    }
    return { partners: partners.sort((a, b) => a.name.localeCompare(b.name)).slice(0, 100) };
  });
}

/** The member's own switch. Turning it off also cancels their open offers. */
export async function setTradingOff(db: TradeDb, userId: string, off: boolean, now = new Date()): Promise<{ tradingOff: boolean }> {
  return db.$transaction(async tx => {
    await tx.tcgPlayer.upsert({ where: { discordUserId: userId }, create: { discordUserId: userId, tradingOff: off }, update: { tradingOff: off } });
    if (off) {
      const open = await tx.tcgTrade.findMany({ where: { status: "open", OR: [{ fromUser: userId }, { toUser: userId }] }, take: 100 }) as TradeRow[];
      for (const row of open) {
        const done = await tx.tcgTrade.updateMany({ where: { id: row.id, version: row.version, status: "open" }, data: { status: "cancelled", version: row.version + 1 } });
        if (done.count === 1) await event(tx, row.id, userId, "cancelled", { reason: "trading switched off", at: now.toISOString() });
      }
    }
    return { tradingOff: off };
  });
}
