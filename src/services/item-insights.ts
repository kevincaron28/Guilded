import type { PrismaClient } from "@prisma/client";
import { itemKey } from "./wishlist.js";

// What the addon shows on an item's tooltip: who wishlisted it and what it usually costs in GP.
// Small on purpose (it travels to every player's game through the guild channel): the items
// most wanted first, a few names each. Keys are the wishlist's item keys.

export interface ItemInsight {
  key: string;
  // Up to WISHERS_SHOWN characters, most urgent first, and how many want it in all.
  wish: { name: string; priority: number }[];
  wishTotal: number;
  // Average GP paid over the last 180 days, and how many awards that is; null when never awarded.
  gp: number | null;
  awards: number;
}

export const MAX_ITEMS = 60;
export const WISHERS_SHOWN = 4;
const HISTORY_DAYS = 180;

// The separators of the addon's compact text format can never appear inside a name or key.
export const clean = (text: string) => text.replace(/[|;~:,\r\n\t]/g, " ").replace(/\s+/g, " ").trim();

export async function itemInsights(database: PrismaClient, guildId: string): Promise<ItemInsight[]> {
  const [wishes, awards] = await Promise.all([
    database.wishlistEntry.findMany({
      where: { character: { member: { guildId } } },
      select: { itemKey: true, priority: true, createdAt: true, character: { select: { name: true } } },
      orderBy: [{ priority: "asc" }, { createdAt: "asc" }]
    }),
    database.lootAward.findMany({
      where: { guildId, awardedAt: { gte: new Date(Date.now() - HISTORY_DAYS * 86_400_000) }, amount: { gt: 0 } },
      select: { itemName: true, amount: true }
    })
  ]);

  const rows = new Map<string, ItemInsight>();
  const row = (key: string) => {
    const existing = rows.get(key) ?? { key, wish: [], wishTotal: 0, gp: null, awards: 0 };
    rows.set(key, existing);
    return existing;
  };
  for (const wish of wishes) {
    const entry = row(wish.itemKey);
    entry.wishTotal++;
    if (entry.wish.length < WISHERS_SHOWN) entry.wish.push({ name: clean(wish.character.name), priority: wish.priority });
  }
  const totals = new Map<string, { sum: number; count: number }>();
  for (const award of awards) {
    const key = itemKey(award.itemName);
    const total = totals.get(key) ?? { sum: 0, count: 0 };
    total.sum += award.amount;
    total.count++;
    totals.set(key, total);
  }
  for (const [key, total] of totals) {
    // Only price items people also want, or that were awarded more than once, so the list stays short.
    if (rows.has(key) || total.count >= 2) {
      const entry = row(key);
      entry.gp = Math.round(total.sum / total.count);
      entry.awards = total.count;
    }
  }
  return [...rows.values()]
    .filter((entry) => entry.key.length > 0 && clean(entry.key).length > 0)
    .sort((a, b) => b.wishTotal - a.wishTotal || b.awards - a.awards || a.key.localeCompare(b.key))
    .slice(0, MAX_ITEMS)
    .map((entry) => ({ ...entry, key: clean(entry.key) }));
}
