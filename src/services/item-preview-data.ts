import type { ParsedItem } from "./item-links.js";

// Item data provider seam. No item database exists in this repository and none may be scraped, so the
// default provider knows nothing; previews then show only what the link itself said, labelled unverified.
export interface ItemDetails {
  name: string;
  quality?: number;
  iconUrl?: string;
  /** Verified one-line summary (slot/type/level), only from an authoritative source. */
  summary?: string;
  url?: string;
}
export interface ItemDataProvider {
  lookup(item: ParsedItem): Promise<ItemDetails | null>;
}
export const nullItemDataProvider: ItemDataProvider = { lookup: async () => null };

/** Small TTL cache in front of a provider (misses are cached too, so a slow source is not hammered). */
export class CachedItemProvider implements ItemDataProvider {
  private readonly entries = new Map<string, { at: number; value: ItemDetails | null }>();
  constructor(private readonly inner: ItemDataProvider, private readonly now: () => number = Date.now,
    private readonly ttlMs = 3_600_000, private readonly maxEntries = 500) {}
  async lookup(item: ParsedItem): Promise<ItemDetails | null> {
    if (!item.verified) return null; // never look an item up by name alone
    const key = `${item.itemId}:${item.suffixId ?? 0}`;
    const hit = this.entries.get(key);
    if (hit && this.now() - hit.at < this.ttlMs) return hit.value;
    const value = await this.inner.lookup(item);
    if (this.entries.size >= this.maxEntries) this.entries.delete(this.entries.keys().next().value!);
    this.entries.set(key, { at: this.now(), value });
    return value;
  }
}

/** Per-channel limiter plus duplicate window. */
export class PreviewGate {
  private readonly posts = new Map<string, number[]>();
  private readonly recent = new Map<string, number>();
  constructor(private readonly now: () => number = Date.now,
    private readonly maxPerMinute = 6, private readonly dedupeMs = 120_000) {}

  /** True when this item may be posted in this channel now; records it when so. */
  allow(channelId: string, key: string): boolean {
    const t = this.now();
    for (const [k, at] of this.recent) if (t - at >= this.dedupeMs) this.recent.delete(k);
    const dupKey = `${channelId}|${key}`;
    if (this.recent.has(dupKey)) return false;
    const window = (this.posts.get(channelId) ?? []).filter(at => t - at < 60_000);
    if (window.length >= this.maxPerMinute) { this.posts.set(channelId, window); return false; }
    window.push(t);
    this.posts.set(channelId, window);
    this.recent.set(dupKey, t);
    return true;
  }
}

export const itemKey = (item: ParsedItem) => item.verified ? `id:${item.itemId}:${item.suffixId ?? 0}:${item.enchantId ?? 0}` : `name:${item.name.toLowerCase()}`;
