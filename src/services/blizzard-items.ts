import type { ParsedItem } from "./item-links.js";
import { nullItemDataProvider, type ItemDataProvider, type ItemDetails } from "./item-preview-data.js";

// Item data from Blizzard's own Game Data API (docs/ITEM_PREVIEWS.md), using the bot's Battle.net app with a
// client-credentials token (no member account involved). WoW Forever's static namespace answers first; an id that
// Forever does not know falls back to Classic Era (`static-classic1x-*`) and is marked as such, since a changed
// Forever item would then show its old stats. Lookups by name use the item search and accept only one exact match:
// several items with the same name means "unknown", never a guess.
// Without credentials (tests, local dev) the provider is the null one, so nothing changes.

export type ItemFetch = (url: string, init?: RequestInit) => Promise<Response>;
export type ItemRegion = "us" | "eu" | "kr" | "tw";

export interface BlizzardItemOptions {
  clientId: string;
  clientSecret: string;
  region?: ItemRegion;
  fetch?: ItemFetch;
  now?: () => number;
  /** How long a found item stays cached (default 24 h). */
  ttlMs?: number;
  /** How long "not found" stays cached (default 1 h); errors are retried sooner (5 min). */
  missTtlMs?: number;
  maxEntries?: number;
  /** Minimum spacing between API calls (default 50 ms, i.e. 20 per second; Blizzard allows 100). */
  minIntervalMs?: number;
  /** Calls allowed per rolling hour (default 20 000; Blizzard allows 36 000). Over it, lookups answer null. */
  maxPerHour?: number;
  /** Per-request timeout (default 8 s). */
  timeoutMs?: number;
  /** Optional sleep, injected by tests. */
  sleep?: (ms: number) => Promise<void>;
}

const QUALITY_BY_TYPE: Record<string, number> = { POOR: 0, COMMON: 1, UNCOMMON: 2, RARE: 3, EPIC: 4, LEGENDARY: 5 };
const ERROR_TTL_MS = 300_000;
const MAX_BODY = 1_000_000;

type Locale = "en_US" | "fr_FR";
/** Reads a nested field of untrusted JSON; undefined when any step is missing. */
const at = (value: unknown, ...path: string[]): unknown => {
  let current = value;
  for (const key of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
};
/** A localized Blizzard text: a plain string (one locale asked) or a { en_US, fr_FR, ... } object (no locale asked). */
const loc = (value: unknown, locale: Locale): string | undefined => {
  const text = typeof value === "string" ? value : at(value, locale) ?? (locale === "en_US" ? undefined : at(value, "en_US"));
  return typeof text === "string" && text.trim() ? text.trim() : undefined;
};
const display = (value: unknown, locale: Locale) => loc(at(value, "display_string") ?? at(value, "display", "display_string"), locale);
const positive = (value: unknown) => typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;

/** The one-line summary: type, slot, item level, required level and the main stats, in one language. */
export function itemSummary(item: unknown, locale: Locale): string | undefined {
  const parts: string[] = [];
  const subclass = loc(at(item, "item_subclass", "name"), locale);
  const slot = loc(at(item, "inventory_type", "name"), locale);
  if (slot && at(item, "inventory_type", "type") !== "NON_EQUIP") parts.push(slot);
  if (subclass && subclass !== slot) parts.push(subclass);
  const armor = display(at(item, "preview_item", "armor"), locale);
  if (armor) parts.push(armor);
  const damage = display(at(item, "preview_item", "weapon", "damage"), locale);
  if (damage) parts.push(damage);
  const stats = at(item, "preview_item", "stats");
  if (Array.isArray(stats)) parts.push(...stats.map(stat => display(stat, locale)).filter((text): text is string => !!text).slice(0, 6));
  const level = positive(at(item, "level"));
  if (level) parts.push(locale === "fr_FR" ? `niveau d'objet ${level}` : `item level ${level}`);
  const required = positive(at(item, "required_level"));
  if (required && required > 1) parts.push(locale === "fr_FR" ? `niveau ${required} requis` : `requires level ${required}`);
  const text = parts.join(" · ");
  return text ? text.slice(0, 200) : undefined;
}

/** Turns one Game Data item document into ItemDetails; null when it is not a usable item. */
export function parseBlizzardItem(item: unknown, source: "forever" | "classic1x"): ItemDetails | null {
  const id = positive(at(item, "id"));
  const name = loc(at(item, "name"), "en_US");
  if (!id || !name) return null;
  const details: ItemDetails = { name: name.slice(0, 100), itemId: id, source, url: `https://www.wowhead.com/classic/item=${id}` };
  const quality = QUALITY_BY_TYPE[String(at(item, "quality", "type") ?? "")];
  if (quality !== undefined) details.quality = quality;
  const summary = itemSummary(item, "en_US");
  if (summary) details.summary = summary;
  const frName = typeof at(item, "name") === "object" ? loc(at(item, "name", "fr_FR"), "fr_FR") : undefined;
  if (frName) {
    details.fr = { name: frName.slice(0, 100) };
    const frSummary = itemSummary(item, "fr_FR");
    if (frSummary) details.fr.summary = frSummary;
  }
  return details;
}

/** An https icon from a media document (render.worldofwarcraft.com), or undefined. */
export function parseIcon(media: unknown): string | undefined {
  const assets = at(media, "assets");
  if (!Array.isArray(assets)) return undefined;
  const icon = at(assets.find(asset => at(asset, "key") === "icon"), "value");
  if (typeof icon !== "string") return undefined;
  try { return new URL(icon).protocol === "https:" ? icon : undefined; } catch { return undefined; }
}

class HttpStatus extends Error { constructor(readonly status: number) { super(`HTTP ${status}`); } }

/** Spaces calls and caps them per hour; answers false when the hourly budget is spent. */
export class CallSpacer {
  private next = 0;
  private readonly calls: number[] = [];
  constructor(private readonly now: () => number, private readonly sleep: (ms: number) => Promise<void>,
    private readonly minIntervalMs: number, private readonly maxPerHour: number) {}
  async take(): Promise<boolean> {
    const t = this.now();
    while (this.calls.length && t - this.calls[0]! >= 3_600_000) this.calls.shift();
    if (this.calls.length >= this.maxPerHour) return false;
    const at = Math.max(t, this.next);
    this.next = at + this.minIntervalMs;
    this.calls.push(at);
    if (at > t) await this.sleep(at - t);
    return true;
  }
}

export interface BlizzardItemProvider extends ItemDataProvider {
  byId(id: number): Promise<ItemDetails | null>;
  byName(name: string): Promise<ItemDetails | null>;
}

export function createBlizzardItemProvider(options: BlizzardItemOptions): BlizzardItemProvider {
  const region = options.region ?? "us";
  const fetcher: ItemFetch = options.fetch ?? ((url, init) => fetch(url, init));
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? 86_400_000;
  const missTtlMs = options.missTtlMs ?? 3_600_000;
  const maxEntries = options.maxEntries ?? 2_000;
  const timeoutMs = options.timeoutMs ?? 8_000;
  const spacer = new CallSpacer(now, options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms))), options.minIntervalMs ?? 50, options.maxPerHour ?? 20_000);
  const api = `https://${region}.api.blizzard.com`;
  const namespaces = { forever: `static-forever-${region}`, classic1x: `static-classic1x-${region}` } as const;

  let token: { value: string; until: number } | null = null;
  let tokenPending: Promise<string | null> | null = null;
  let tokenBackoffUntil = 0;
  const cache = new Map<string, { until: number; value: ItemDetails | null }>();
  const inflight = new Map<string, Promise<ItemDetails | null>>();

  async function getToken(): Promise<string | null> {
    if (token && now() < token.until) return token.value;
    if (now() < tokenBackoffUntil) return null;
    tokenPending ??= (async () => {
      try {
        if (!await spacer.take()) return null;
        const response = await fetcher("https://oauth.battle.net/token", {
          method: "POST", redirect: "error", signal: AbortSignal.timeout(timeoutMs),
          headers: { "content-type": "application/x-www-form-urlencoded", authorization: `Basic ${Buffer.from(`${options.clientId}:${options.clientSecret}`).toString("base64")}` },
          body: "grant_type=client_credentials"
        });
        if (!response.ok) throw new HttpStatus(response.status);
        const body: unknown = await response.json();
        const access = at(body, "access_token");
        const value = typeof access === "string" && access.length > 0 && access.length <= 4096 ? access : null;
        if (!value) throw new Error("no token");
        const seconds = positive(at(body, "expires_in")) ?? 3600;
        token = { value, until: now() + Math.max(60, seconds - 300) * 1000 };
        return value;
      } catch {
        token = null;
        tokenBackoffUntil = now() + ERROR_TTL_MS; // a wrong secret must not be retried on every chat line
        return null;
      } finally { tokenPending = null; }
    })();
    return tokenPending;
  }

  /** One API GET; null on 404, throws on anything else that is not ok. Retries once with a fresh token on 401. */
  async function get(path: string, params: Record<string, string>): Promise<unknown> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const access = await getToken();
      if (!access) throw new Error("no token");
      if (!await spacer.take()) throw new Error("hourly budget spent");
      const url = new URL(path, api);
      url.search = new URLSearchParams(params).toString();
      const response = await fetcher(url.href, { redirect: "error", signal: AbortSignal.timeout(timeoutMs), headers: { authorization: `Bearer ${access}` } });
      if (response.status === 401 && attempt === 0) { token = null; continue; }
      if (response.status === 404) return null;
      if (!response.ok) throw new HttpStatus(response.status);
      const text = await response.text();
      if (text.length > MAX_BODY) throw new Error("too large");
      return JSON.parse(text) as unknown;
    }
    throw new HttpStatus(401);
  }

  async function fetchItem(id: number): Promise<ItemDetails | null> {
    for (const source of ["forever", "classic1x"] as const) {
      // No locale parameter: the answer then carries every locale, so English and French come in one call.
      const raw = await get(`/data/wow/item/${id}`, { namespace: namespaces[source] });
      if (raw === null) continue;
      const details = parseBlizzardItem(raw, source);
      if (!details) return null;
      const icon = parseIcon(await get(`/data/wow/media/item/${id}`, { namespace: namespaces[source] }).catch(() => null));
      if (icon) details.iconUrl = icon;
      return details;
    }
    return null;
  }

  async function searchName(name: string): Promise<ItemDetails | null> {
    const wanted = name.trim().toLocaleLowerCase();
    for (const source of ["forever", "classic1x"] as const) {
      const ids = new Set<number>();
      for (const locale of ["en_US", "fr_FR"] as const) {
        const results = at(await get("/data/wow/search/item", { namespace: namespaces[source], [`name.${locale}`]: name.trim(), orderby: "id", _pageSize: "100" }), "results");
        for (const result of Array.isArray(results) ? results : []) {
          const id = positive(at(result, "data", "id"));
          const names = at(result, "data", "name");
          const all = names && typeof names === "object" ? Object.values(names) : [names];
          if (id && all.some(value => typeof value === "string" && value.trim().toLocaleLowerCase() === wanted)) ids.add(id);
        }
        if (ids.size) break; // the English search found it; the French one is for French chat
      }
      if (ids.size > 1) return null; // several items share this name: never guess
      if (ids.size === 1) {
        const details = await byId([...ids][0]!);
        return details && details.source === source ? { ...details, matchedBy: "name" } : null;
      }
    }
    return null;
  }

  function cached(key: string, load: () => Promise<ItemDetails | null>): Promise<ItemDetails | null> {
    const hit = cache.get(key);
    if (hit && now() < hit.until) return Promise.resolve(hit.value);
    const running = inflight.get(key);
    if (running) return running;
    const promise = (async () => {
      let value: ItemDetails | null = null;
      let until = now() + missTtlMs;
      try {
        value = await load();
        if (value) until = now() + ttlMs;
      } catch { until = now() + ERROR_TTL_MS; }
      if (cache.size >= maxEntries) cache.delete(cache.keys().next().value!);
      cache.set(key, { until, value });
      return value;
    })().finally(() => inflight.delete(key));
    inflight.set(key, promise);
    return promise;
  }

  const byId = (id: number) => Number.isInteger(id) && id > 0 && id < 10_000_000 ? cached(`id:${id}`, () => fetchItem(id)) : Promise.resolve(null);
  const byName = (name: string) => {
    const clean = name.trim();
    return clean.length >= 2 && clean.length <= 60 ? cached(`name:${clean.toLocaleLowerCase()}`, () => searchName(clean)) : Promise.resolve(null);
  };
  return {
    byId, byName,
    lookup: (item: ParsedItem) => item.verified && item.itemId ? byId(item.itemId).then(found => found ? { ...found, matchedBy: "id" } : null) : byName(item.name)
  };
}

/** The live provider when the bot's Battle.net app is configured; the null provider otherwise. */
export function itemProviderFromEnv(env: { BATTLENET_CLIENT_ID?: string | undefined; BATTLENET_CLIENT_SECRET?: string | undefined }, fetcher?: ItemFetch): ItemDataProvider {
  if (!env.BATTLENET_CLIENT_ID || !env.BATTLENET_CLIENT_SECRET) return nullItemDataProvider;
  return createBlizzardItemProvider({ clientId: env.BATTLENET_CLIENT_ID, clientSecret: env.BATTLENET_CLIENT_SECRET, ...(fetcher ? { fetch: fetcher } : {}) });
}

/** Gives a slow lookup at most `ms`; the lookup keeps running and fills the cache for next time. */
export function withDeadline(provider: ItemDataProvider, ms: number): ItemDataProvider {
  return {
    lookup: (item) => new Promise(resolve => {
      const timer = setTimeout(() => resolve(null), ms);
      provider.lookup(item).then(value => resolve(value), () => resolve(null)).finally(() => clearTimeout(timer));
    })
  };
}
