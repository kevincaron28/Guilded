import type { PrismaClient } from "../generated/prisma/client.js";
import { albumFor, type AlbumLang } from "./companion-album.js";
import { CARD_BY_KEY, CARDS, RARITY_LABEL, type CardDef } from "./tcg-catalogue.js";
import { accrue, craftCheck, cryptoRng, nextPackAt, oddsTable, pityRemaining, rollPack, MAX_BANKED, type CraftError, type PulledCard, type Rng } from "./tcg.js";

// Guilded Collection persistence and the three phone actions (stage 1, server side): read the collection, open a pack,
// craft a card. Signed-in member only; the caller resolves the credential to a Discord user id. Each write runs in one
// transaction guarded by a compare-and-set on the account row, so a double tap or two phones can never spend a pack twice.

type Tx = Pick<PrismaClient, "tcgAccount" | "tcgCard" | "tcgLog">;
type Db = Tx & Pick<PrismaClient, "member" | "guildSettings" | "memberAchievement"> & { $transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> };

export class TcgError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
const MESSAGES: Record<CraftError, string> = {
  unknown: "That card does not exist.", owned: "You already have that card.", "not-craftable": "Epic and Legendary cards cannot be crafted; they drop from packs or come from achievements.", dust: "Not enough dust for that card."
};

/** True when the person belongs to at least one served server where the collection is on (it is on unless an officer turned it off). */
export async function tcgAllowed(db: Pick<PrismaClient, "member" | "guildSettings">, discordUserId: string, allows: (discordGuildId: string) => boolean): Promise<boolean> {
  const rows = await db.member.findMany({ where: { discordUserId, status: "ACTIVE", isTest: false }, select: { guildId: true, guild: { select: { discordId: true } } }, take: 25 });
  const served = rows.filter(row => allows(row.guild.discordId));
  if (!served.length) return false;
  const off = await db.guildSettings.findMany({ where: { guildId: { in: served.map(row => row.guildId) }, tcgEnabled: false }, select: { guildId: true } });
  return off.length < served.length;
}

async function loadAccount(tx: Tx, discordUserId: string, now: Date) {
  const existing = await tx.tcgAccount.findUnique({ where: { discordUserId } });
  if (existing) return existing;
  // A new collector starts with one pack ready, so the first visit has something to open.
  return tx.tcgAccount.create({ data: { discordUserId, banked: 1, accruedAt: now } });
}

/** Achievement cards: each earned achievement guarantees its matching badge card (the card is the reward). Idempotent. */
async function grantAchievementCards(db: Db, discordUserId: string, allows: (id: string) => boolean): Promise<void> {
  const album = await albumFor(db, discordUserId, "en", allows);
  const earned = album.cards.filter(card => card.earnedAt);
  if (!earned.length) return;
  const have = new Set((await db.tcgCard.findMany({ where: { discordUserId, cardKey: { startsWith: "badge:" } }, select: { cardKey: true } })).map(row => row.cardKey));
  const missing = earned.filter(card => CARD_BY_KEY.has(`badge:${card.id}`) && !have.has(`badge:${card.id}`));
  for (const card of missing) await db.tcgCard.upsert({ where: { discordUserId_cardKey: { discordUserId, cardKey: `badge:${card.id}` } }, update: {}, create: { discordUserId, cardKey: `badge:${card.id}`, count: 1, firstSeenAt: new Date(card.earnedAt!) } });
}

export interface CollectionCard {
  key: string; family: CardDef["family"]; rarity: CardDef["rarity"]; rarityLabel: string; set: CardDef["set"]; name: string; flavour: string | null;
  owned: boolean; count: number; firstSeenAt: string | null; craftCost: number | null;
}
export interface Collection {
  cards: CollectionCard[]; owned: number; total: number; dust: number;
  packs: { ready: number; max: number; nextAt: string | null };
  pity: { epicIn: number; legendaryIn: number };
  odds: ReturnType<typeof oddsTable>;
}

const costOf = (key: string): number | null => { const check = craftCheck(key, new Set(), Number.MAX_SAFE_INTEGER); return "cost" in check ? check.cost : null; };

function collectionView(account: { banked: number; accruedAt: Date; pityEpic: number; pityLegendary: number; dust: number }, rows: { cardKey: string; count: number; firstSeenAt: Date }[], lang: AlbumLang, now: Date): Collection {
  const clock = accrue(account, now);
  const byKey = new Map(rows.map(row => [row.cardKey, row]));
  const cards = CARDS.map((card): CollectionCard => {
    const row = byKey.get(card.key);
    return { key: card.key, family: card.family, rarity: card.rarity, rarityLabel: RARITY_LABEL[card.rarity][lang], set: card.set, name: card[lang].name, flavour: card[lang].flavour ?? null,
      owned: !!row, count: row?.count ?? 0, firstSeenAt: row?.firstSeenAt.toISOString() ?? null,
      craftCost: row ? null : costOf(card.key) };
  });
  return { cards, owned: rows.filter(row => CARD_BY_KEY.has(row.cardKey)).length, total: cards.length, dust: account.dust,
    packs: { ready: clock.banked, max: MAX_BANKED, nextAt: nextPackAt(clock)?.toISOString() ?? null }, pity: pityRemaining(account.pityEpic, account.pityLegendary), odds: oddsTable() };
}

/** The signed-in person's collection (and the achievement cards they have earned since last time). */
export async function collectionFor(db: Db, discordUserId: string, lang: AlbumLang, allows: (id: string) => boolean, now = new Date()): Promise<Collection> {
  await grantAchievementCards(db, discordUserId, allows);
  const account = await db.$transaction(tx => loadAccount(tx, discordUserId, now));
  const rows = await db.tcgCard.findMany({ where: { discordUserId }, select: { cardKey: true, count: true, firstSeenAt: true }, take: 1000 });
  return collectionView(account, rows, lang, now);
}

export interface OpenedPack { cards: (PulledCard & { name: string; rarityLabel: string })[]; dustGained: number; collection: Collection }

/** Opens one banked pack. Throws TcgError(409) when none is ready or another open raced this one. */
export async function openPack(db: Db, discordUserId: string, lang: AlbumLang, allows: (id: string) => boolean, now = new Date(), rng: Rng = cryptoRng): Promise<OpenedPack> {
  await grantAchievementCards(db, discordUserId, allows);
  const result = await db.$transaction(async tx => {
    const account = await loadAccount(tx, discordUserId, now);
    const clock = accrue(account, now);
    if (clock.banked < 1) throw new TcgError("No pack is ready yet. A new one arrives every 20 hours (up to 3 are kept).", 409);
    const owned = new Set((await tx.tcgCard.findMany({ where: { discordUserId }, select: { cardKey: true }, take: 1000 })).map(row => row.cardKey));
    const roll = rollPack({ owned, pityEpic: account.pityEpic, pityLegendary: account.pityLegendary, rng });
    // The compare-and-set: only the request that still sees the counters it read may spend the pack.
    const spent = await tx.tcgAccount.updateMany({ where: { discordUserId, packsOpened: account.packsOpened, banked: account.banked, dust: account.dust },
      data: { banked: clock.banked - 1, accruedAt: clock.accruedAt, pityEpic: roll.pityEpic, pityLegendary: roll.pityLegendary, dust: account.dust + roll.dust, packsOpened: account.packsOpened + 1 } });
    if (spent.count !== 1) throw new TcgError("That pack was just opened somewhere else. Refresh and try again.", 409);
    for (const card of roll.cards) await tx.tcgCard.upsert({ where: { discordUserId_cardKey: { discordUserId, cardKey: card.key } }, update: { count: { increment: 1 } }, create: { discordUserId, cardKey: card.key, count: 1, firstSeenAt: now } });
    await tx.tcgLog.create({ data: { discordUserId, kind: "pack", cards: roll.cards.map(card => ({ key: card.key, rarity: card.rarity, isNew: card.isNew, dust: card.dust })), dustDelta: roll.dust } });
    return roll;
  });
  return { cards: result.cards.map(card => ({ ...card, name: CARD_BY_KEY.get(card.key)![lang].name, rarityLabel: RARITY_LABEL[card.rarity][lang] })), dustGained: result.dust, collection: await collectionFor(db, discordUserId, lang, allows, now) };
}

/** Crafts one missing Common, Uncommon or Rare card with dust. */
export async function craftCard(db: Db, discordUserId: string, cardKey: string, lang: AlbumLang, allows: (id: string) => boolean, now = new Date()): Promise<Collection> {
  await grantAchievementCards(db, discordUserId, allows);
  await db.$transaction(async tx => {
    const account = await loadAccount(tx, discordUserId, now);
    const owned = new Set((await tx.tcgCard.findMany({ where: { discordUserId }, select: { cardKey: true }, take: 1000 })).map(row => row.cardKey));
    const check = craftCheck(cardKey, owned, account.dust);
    if ("error" in check) throw new TcgError(MESSAGES[check.error], check.error === "unknown" ? 404 : 409);
    const spent = await tx.tcgAccount.updateMany({ where: { discordUserId, dust: account.dust, packsOpened: account.packsOpened }, data: { dust: account.dust - check.cost } });
    if (spent.count !== 1) throw new TcgError("Your dust changed while crafting. Refresh and try again.", 409);
    await tx.tcgCard.create({ data: { discordUserId, cardKey, count: 1, firstSeenAt: now } });
    await tx.tcgLog.create({ data: { discordUserId, kind: "craft", cards: [{ key: cardKey }], dustDelta: -check.cost } });
  });
  return collectionFor(db, discordUserId, lang, allows, now);
}
