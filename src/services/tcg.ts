import { randomInt } from "node:crypto";
import { CARD_BY_KEY, CARDS, cardsOfRarity, type CardDef, type Rarity } from "./tcg-catalogue.js";

// Guilded Collection rules (docs/plans/APP_TCG.md option 2). Everything here is pure and deterministic given an rng,
// so odds, pity, dust and the daily limit are all unit-tested. The server is the only place a pack is rolled; the phone
// never supplies randomness and never decides a pack's contents.

export const PACK_SIZE = 5;
export const MAX_BANKED = 3;
export const ACCRUAL_MS = 20 * 3_600_000;
/** An Epic or better is guaranteed in the Rare-or-better slot at least every 10 packs, a Legendary every 40. */
export const EPIC_PITY = 10;
export const LEGENDARY_PITY = 40;

/** Weights (out of the totals) shown to members on the odds screen. The four ordinary slots, then the one Rare-or-better slot. */
export const SLOT_WEIGHTS = {
  ordinary: { common: 600, uncommon: 250 },
  rarePlus: { rare: 110, epic: 35, legendary: 5 }
} as const;
/** Dust a duplicate turns into, and what crafting a missing card costs (Epic and Legendary cannot be crafted). */
export const DUPLICATE_DUST: Record<Rarity, number> = { common: 5, uncommon: 10, rare: 25, epic: 100, legendary: 400 };
export const CRAFT_COST: Partial<Record<Rarity, number>> = { common: 30, uncommon: 60, rare: 150 };

/** Odds as percentages, for the app's odds screen. */
export function oddsTable() {
  const pct = (weights: Record<string, number>) => { const total = Object.values(weights).reduce((a, b) => a + b, 0); return Object.fromEntries(Object.entries(weights).map(([k, v]) => [k, Math.round((v / total) * 1000) / 10])); };
  return { ordinarySlots: pct(SLOT_WEIGHTS.ordinary), rarePlusSlot: pct(SLOT_WEIGHTS.rarePlus), packSize: PACK_SIZE, epicPity: EPIC_PITY, legendaryPity: LEGENDARY_PITY };
}

export interface Rng { int(maxExclusive: number): number }
export const cryptoRng: Rng = { int: max => randomInt(max) };
/** A seeded generator for tests (mulberry32). */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return { int: max => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * max); } };
}

// ---- the daily pack ----

export interface PackClock { banked: number; accruedAt: Date }
/** One pack accrues every 20 hours, up to 3 banked. At the cap the clock stays at "now" so the next pack's timer starts when one is opened. */
export function accrue(state: PackClock, now: Date): PackClock {
  if (state.banked >= MAX_BANKED) return { banked: MAX_BANKED, accruedAt: now };
  const gained = Math.floor((now.getTime() - state.accruedAt.getTime()) / ACCRUAL_MS);
  if (gained <= 0) return { banked: state.banked, accruedAt: state.accruedAt };
  const banked = Math.min(MAX_BANKED, state.banked + gained);
  return { banked, accruedAt: banked >= MAX_BANKED ? now : new Date(state.accruedAt.getTime() + gained * ACCRUAL_MS) };
}
/** When the next pack arrives; null at the cap. */
export const nextPackAt = (clock: PackClock): Date | null => clock.banked >= MAX_BANKED ? null : new Date(clock.accruedAt.getTime() + ACCRUAL_MS);

// ---- rolling a pack ----

export interface PulledCard { key: string; rarity: Rarity; isNew: boolean; dust: number }
export interface PackRoll { cards: PulledCard[]; pityEpic: number; pityLegendary: number; dust: number }

function weighted<T extends string>(weights: Record<T, number>, rng: Rng): T {
  const entries = Object.entries(weights) as [T, number][];
  let pick = rng.int(entries.reduce((sum, [, w]) => sum + w, 0));
  for (const [key, w] of entries) { if (pick < w) return key; pick -= w; }
  return entries[0]![0];
}

/** Picks a card of a rarity, preferring one the member does not have (and that is not already in this pack). */
function pickCard(rarity: Rarity, owned: ReadonlySet<string>, inPack: ReadonlySet<string>, rng: Rng): CardDef | null {
  const pool = cardsOfRarity(rarity);
  if (!pool.length) return null;
  const fresh = pool.filter(card => !owned.has(card.key) && !inPack.has(card.key));
  const choices = fresh.length ? fresh : pool.filter(card => !inPack.has(card.key));
  const from = choices.length ? choices : pool;
  return from[rng.int(from.length)]!;
}

/**
 * Rolls one 5-card pack. Four ordinary slots (Common or Uncommon) and one Rare-or-better slot. Pity: a Legendary every
 * 40 packs and an Epic (or better) every 10, counted in packs without one. Packs prefer cards the member lacks until a
 * rarity is complete; duplicates become dust at once. A rarity with no cards (no Legendary badge exists yet) falls back
 * one step down and never triggers its pity.
 */
export function rollPack(input: { owned: ReadonlySet<string>; pityEpic: number; pityLegendary: number; rng: Rng }): PackRoll {
  const owned = new Set(input.owned);
  const inPack = new Set<string>();
  const cards: PulledCard[] = [];
  let dust = 0;
  const pull = (wanted: Rarity): void => {
    let rarity = wanted;
    let card = pickCard(rarity, owned, inPack, input.rng);
    if (!card && rarity === "legendary") { rarity = "epic"; card = pickCard(rarity, owned, inPack, input.rng); }
    if (!card) { rarity = "common"; card = pickCard(rarity, owned, inPack, input.rng); }
    if (!card) throw new Error("The card catalogue is empty.");
    const isNew = !owned.has(card.key);
    const gain = isNew ? 0 : DUPLICATE_DUST[card.rarity];
    owned.add(card.key); inPack.add(card.key); dust += gain;
    cards.push({ key: card.key, rarity: card.rarity, isNew, dust: gain });
  };
  for (let i = 0; i < PACK_SIZE - 1; i++) pull(weighted(SLOT_WEIGHTS.ordinary, input.rng));
  let slot: Rarity = weighted(SLOT_WEIGHTS.rarePlus, input.rng);
  const legendaryExists = cardsOfRarity("legendary").length > 0;
  if (legendaryExists && input.pityLegendary + 1 >= LEGENDARY_PITY) slot = "legendary";
  else if (input.pityEpic + 1 >= EPIC_PITY && slot === "rare") slot = "epic";
  if (!legendaryExists && slot === "legendary") slot = "epic";
  pull(slot);
  const top = cards[cards.length - 1]!.rarity;
  return {
    cards,
    pityEpic: top === "epic" || top === "legendary" ? 0 : input.pityEpic + 1,
    pityLegendary: top === "legendary" ? 0 : input.pityLegendary + 1,
    dust
  };
}

/** Packs until the next guaranteed Epic and Legendary, for the app's progress line. */
export const pityRemaining = (pityEpic: number, pityLegendary: number) => ({ epicIn: Math.max(1, EPIC_PITY - pityEpic), legendaryIn: Math.max(1, LEGENDARY_PITY - pityLegendary) });

// ---- crafting ----

export type CraftError = "unknown" | "owned" | "not-craftable" | "dust";
/** What crafting a card would cost, or why it cannot be done. Legendary and Epic cards cannot be crafted, only dropped or earned. */
export function craftCheck(cardKey: string, owned: ReadonlySet<string>, dust: number): { cost: number } | { error: CraftError } {
  const card = CARD_BY_KEY.get(cardKey);
  if (!card) return { error: "unknown" };
  if (owned.has(cardKey)) return { error: "owned" };
  const cost = CRAFT_COST[card.rarity];
  if (cost === undefined) return { error: "not-craftable" };
  if (dust < cost) return { error: "dust" };
  return { cost };
}
export const TOTAL_CARDS = CARDS.length;
