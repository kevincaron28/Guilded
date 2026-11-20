import { CallSpacer } from "./blizzard-items.js";
import { armoryId } from "./guild-armory-id.js";

// Blizzard's Armory (Profile API) for WoW Forever, with the bot's own Battle.net app and a client-credentials token (no member
// account involved). As of 20 Nov 2026 the API answers for Forever with `namespace=profile-forever-us` and an EMPTY realm segment:
//   GET https://us.api.blizzard.com/data/wow/guild//<slug>/roster?namespace=profile-forever-us&locale=en_US
// The slug keeps its accent ("québec-gold"; "quebec-gold" is another guild). Without credentials, or when Blizzard answers
// 403/404, every call returns null after one log line; nothing here ever throws into a scheduler.

export type ArmoryFetch = (url: string, init?: RequestInit) => Promise<Response>;
export const ARMORY_NAMESPACE = "profile-forever-us";
const API = "https://us.api.blizzard.com";
const MAX_BODY = 2_000_000;

/** A guild's Armory slug: lower case, spaces to hyphens, apostrophes removed, accents kept. */
export function guildSlug(name: string): string {
  return name.normalize("NFC").toLowerCase().replace(/['’‘`]/g, "").replace(/[^\p{L}\p{N}\s-]/gu, " ").trim().replace(/[\s-]+/g, "-").replace(/^-|-$/g, "");
}
/** Guild names compared the way the Armory does: NFC, lower case, collapsed spaces (accents matter: Québec is not Quebec). */
export const armoryNameKey = (name: string) => name.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();

export const rosterUrl = (slug: string) => `${API}/data/wow/guild//${encodeURIComponent(slug)}/roster?namespace=${ARMORY_NAMESPACE}&locale=en_US`;
export const summaryUrl = (slug: string) => `${API}/data/wow/guild//${encodeURIComponent(slug)}?namespace=${ARMORY_NAMESPACE}&locale=en_US`;

export interface ArmoryMember { id: bigint; name: string; level: number | null; classId: number | null; raceId: number | null; rank: number | null }
export interface ArmoryGuildSummary { name: string; faction: string | null; memberCount: number | null; achievementPoints: number | null }
export interface ArmoryRoster { guild: { name: string | null; faction: string | null }; members: ArmoryMember[] }

const at = (value: unknown, ...path: string[]): unknown => {
  let current = value;
  for (const key of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
};
const int = (value: unknown, min: number, max: number) => typeof value === "number" && Number.isInteger(value) && value >= min && value <= max ? value : null;
const text = (value: unknown, max: number) => typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
const faction = (value: unknown) => { const type = text(at(value, "type"), 20) ?? text(value, 20); return type ? type.toUpperCase() : null; };

export function parseRoster(body: unknown): ArmoryRoster | null {
  const members = at(body, "members");
  if (!Array.isArray(members)) return null;
  const parsed: ArmoryMember[] = [];
  const seen = new Set<bigint>();
  for (const row of members.slice(0, 5000)) {
    const id = armoryId(at(row, "character", "id"));
    const name = text(at(row, "character", "name"), 40);
    if (id === null || !name || seen.has(id)) continue;
    seen.add(id);
    parsed.push({ id, name, level: int(at(row, "character", "level"), 1, 100), classId: int(at(row, "character", "playable_class", "id"), 1, 100),
      raceId: int(at(row, "character", "playable_race", "id"), 1, 100), rank: int(at(row, "rank"), 0, 19) });
  }
  return { guild: { name: text(at(body, "guild", "name"), 80), faction: faction(at(body, "guild", "faction")) }, members: parsed };
}

export function parseSummary(body: unknown): ArmoryGuildSummary | null {
  const name = text(at(body, "name"), 80);
  if (!name) return null;
  return { name, faction: faction(at(body, "faction")), memberCount: int(at(body, "member_count"), 0, 100_000), achievementPoints: int(at(body, "achievement_points"), 0, 10_000_000) };
}

export interface ArmoryClientOptions {
  clientId: string; clientSecret: string; fetch?: ArmoryFetch; now?: () => number; sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  /** Extra attempts after a 5xx or network error (default 2). */
  retries?: number;
  log?: (message: string) => void;
}
export interface ArmoryClient {
  fetchForeverGuildRoster(slug: string): Promise<ArmoryRoster | null>;
  fetchForeverGuildSummary(slug: string): Promise<ArmoryGuildSummary | null>;
  /** A character's picture links by Armory slug (full name, lower case, no realm), or null. Keys: avatar, avatar-sd, main-raw, main-sd-raw. */
  fetchForeverCharacterMedia(slug: string): Promise<ArmoryCharacterMedia | null>;
}
export interface ArmoryCharacterMedia { id: bigint | null; assets: Record<string, string> }

/** A character's Armory slug: the full name, lower case, spaces to hyphens (Forever has no realm segment). */
export const characterSlug = guildSlug;
export const characterMediaUrl = (slug: string) => `${API}/profile/wow/character/${encodeURIComponent(slug)}/character-media?namespace=${ARMORY_NAMESPACE}&locale=en_US`;
export function parseCharacterMedia(body: unknown): ArmoryCharacterMedia | null {
  const assets: Record<string, string> = {};
  const list = at(body, "assets");
  if (Array.isArray(list)) for (const a of list.slice(0, 20)) {
    const key = at(a, "key"), value = at(a, "value");
    if (typeof key === "string" && typeof value === "string" && value.length < 500) assets[key] = value;
  }
  const rawId = at(at(body, "character"), "id");
  const id = typeof rawId === "number" && Number.isSafeInteger(rawId) && rawId > 0 ? BigInt(rawId) : null;
  return Object.keys(assets).length || id ? { id, assets } : null;
}

export function createArmoryClient(options: ArmoryClientOptions): ArmoryClient {
  const fetcher = options.fetch ?? ((url, init) => fetch(url, init));
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const timeoutMs = options.timeoutMs ?? 10_000;
  const retries = options.retries ?? 2;
  const log = options.log ?? ((message: string) => console.warn(message));
  const spacer = new CallSpacer(now, sleep, 100, 5000);
  const warned = new Set<string>();
  const warnOnce = (key: string, message: string) => { if (!warned.has(key)) { warned.add(key); log(message); } };
  let token: { value: string; until: number } | null = null;

  async function getToken(): Promise<string | null> {
    if (token && now() < token.until) return token.value;
    try {
      const response = await fetcher("https://oauth.battle.net/token", { method: "POST", redirect: "error", signal: AbortSignal.timeout(timeoutMs),
        headers: { "content-type": "application/x-www-form-urlencoded", authorization: `Basic ${Buffer.from(`${options.clientId}:${options.clientSecret}`).toString("base64")}` },
        body: "grant_type=client_credentials" });
      if (!response.ok) { warnOnce("token", `Armory: Battle.net token refused (${response.status}); skipping.`); return null; }
      const body: unknown = await response.json();
      const access = at(body, "access_token");
      if (typeof access !== "string" || !access || access.length > 4096) return null;
      const seconds = int(at(body, "expires_in"), 60, 86_400) ?? 3600;
      token = { value: access, until: now() + Math.max(60, seconds - 300) * 1000 };
      warned.delete("token");
      return access;
    } catch { warnOnce("token-net", "Armory: could not reach Battle.net for a token."); return null; }
  }

  /** The JSON body, or null on 403/404/any failure after the retries (logged once per kind). */
  async function get(url: string, kind: string): Promise<unknown> {
    for (let attempt = 0; attempt <= retries; attempt++) {
      const access = await getToken();
      if (!access) return null;
      if (!await spacer.take()) return null;
      try {
        const response = await fetcher(url, { redirect: "error", signal: AbortSignal.timeout(timeoutMs), headers: { authorization: `Bearer ${access}` } });
        if (response.status === 401) { token = null; continue; }
        if (response.status === 403 || response.status === 404) { warnOnce(`${kind}:${response.status}`, `Armory: ${kind} answered ${response.status}; nothing to sync.`); return null; }
        if (response.status === 429 || response.status >= 500) { await sleep(1000 * (attempt + 1)); continue; }
        if (!response.ok) { warnOnce(`${kind}:${response.status}`, `Armory: ${kind} answered ${response.status}.`); return null; }
        const body = await response.text();
        if (body.length > MAX_BODY) return null;
        return JSON.parse(body) as unknown;
      } catch { await sleep(1000 * (attempt + 1)); }
    }
    warnOnce(`${kind}:failed`, `Armory: ${kind} kept failing; will try again on the next run.`);
    return null;
  }

  return {
    async fetchForeverGuildRoster(slug) { return parseRoster(await get(rosterUrl(slug), "guild roster")); },
    async fetchForeverGuildSummary(slug) { return parseSummary(await get(summaryUrl(slug), "guild summary")); },
    async fetchForeverCharacterMedia(slug) { return parseCharacterMedia(await get(characterMediaUrl(slug), "character media")); }
  };
}

export function armoryClientFromEnv(env: { BATTLENET_CLIENT_ID?: string | undefined; BATTLENET_CLIENT_SECRET?: string | undefined }, fetcher?: ArmoryFetch): ArmoryClient | null {
  if (!env.BATTLENET_CLIENT_ID || !env.BATTLENET_CLIENT_SECRET) return null;
  return createArmoryClient({ clientId: env.BATTLENET_CLIENT_ID, clientSecret: env.BATTLENET_CLIENT_SECRET, ...(fetcher ? { fetch: fetcher } : {}) });
}
