// The badge album: one card per achievement, from the member's own stored badges (GET /api/v1/companion/achievements).
// Nothing here is random or purchasable. A card is simply unlocked when the real achievement is earned.

export type CardTier = "bronze" | "silver" | "gold" | "platinum" | "epic" | "legendary";
export interface AlbumCard {
  id: string; name: string; description: string; tier: CardTier; tierLabel: string; tierColor: string;
  set: string; rank: number | null; threshold: number; earnedAt: string | null;
  /** The painted emblem's file name on the site (/badge-art/emblems/<emblem>-128.webp), or null for the plain medal. */
  emblem: string | null;
}
export interface Album { cards: AlbumCard[]; earned: number; total: number }
export interface AlbumSet { name: string; cards: AlbumCard[]; earned: number }

const TIERS: CardTier[] = ["bronze", "silver", "gold", "platinum", "epic", "legendary"];
const obj = (v: unknown): Record<string, unknown> | null => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
const text = (v: unknown): string | null => typeof v === "string" && v ? v : null;
const count = (v: unknown): number => typeof v === "number" && Number.isFinite(v) ? v : 0;

/** Defensive: a malformed card is dropped, an unknown tier counts as bronze, and an unreadable colour falls back to grey. */
export function parseAlbum(body: unknown): Album {
  const data = obj(body);
  if (!data || !Array.isArray(data.cards)) throw new Error("The album answer was not understood.");
  const cards = data.cards.flatMap((raw): AlbumCard[] => {
    const c = obj(raw);
    const id = text(c?.id), name = text(c?.name);
    if (!c || !id || !name) return [];
    const tier = TIERS.includes(c.tier as CardTier) ? c.tier as CardTier : "bronze";
    const color = text(c.tierColor);
    return [{
      id, name, description: text(c.description) ?? "", tier, tierLabel: text(c.tierLabel) ?? tier,
      tierColor: color && /^#[0-9a-f]{6}$/i.test(color) ? color : "#8a8a80",
      set: text(c.set) ?? "Guilded", rank: typeof c.rank === "number" ? c.rank : null, threshold: count(c.threshold), earnedAt: text(c.earnedAt),
      emblem: /^[a-z0-9-]{1,40}$/.test(text(c.emblem) ?? "") ? text(c.emblem) : null
    }];
  });
  return { cards, earned: cards.filter((card) => card.earnedAt).length, total: cards.length };
}

/** Cards grouped by set in catalogue order, earned first inside each set. */
export function groupSets(cards: AlbumCard[], onlyEarned = false): AlbumSet[] {
  const order: string[] = [];
  const by = new Map<string, AlbumCard[]>();
  for (const card of cards) {
    if (onlyEarned && !card.earnedAt) continue;
    if (!by.has(card.set)) { by.set(card.set, []); order.push(card.set); }
    by.get(card.set)!.push(card);
  }
  return order.map((name) => {
    const list = by.get(name)!;
    const sorted = [...list.filter((card) => card.earnedAt), ...list.filter((card) => !card.earnedAt)];
    return { name, cards: sorted, earned: list.filter((card) => card.earnedAt).length };
  });
}

/** A card earned in the last seven days wears a NEW tag. Derived from the date, so nothing is stored on the phone. */
export function isNew(card: AlbumCard, now: number): boolean {
  if (!card.earnedAt) return false;
  const at = Date.parse(card.earnedAt);
  return Number.isFinite(at) && now - at >= 0 && now - at < 7 * 24 * 3600 * 1000;
}
