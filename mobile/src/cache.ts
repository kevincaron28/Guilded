import AsyncStorage from "@react-native-async-storage/async-storage";

// Offline snapshots (0.4.0): the last good answer of each screen is kept on the phone so the next launch (or no signal)
// shows it at once with a "last updated" line, while a fresh copy loads in the background. This is public data and the
// member's own guild views, never a credential: the sign-in stays in SecureStore (storage.ts). Guild snapshots are
// removed on sign-out and on "Delete my data".

const PREFIX = "guilded.cache.";
const GUILD_PREFIX = `${PREFIX}guild.`;
const VERSION = 1;
/** A snapshot older than this is not shown (a month-old board is more confusing than a spinner). */
export const MAX_SNAPSHOT_AGE_MS = 30 * 86_400_000;

export interface Envelope<T> { v: number; savedAt: number; data: T }

export const cacheKey = (...parts: string[]): string => `${PREFIX}${parts.join(".")}`;
export const guildCacheKey = (guildDiscordId: string, view: string): string => `${GUILD_PREFIX}${guildDiscordId}.${view}`;

export function toEnvelope<T>(data: T, now: number): string {
  return JSON.stringify({ v: VERSION, savedAt: now, data } satisfies Envelope<T>);
}

/** The stored snapshot, or null when it is missing, damaged, from another format or too old. */
export function fromEnvelope<T>(raw: string | null, now: number, accept: (data: unknown) => data is T = (data): data is T => data !== undefined): Envelope<T> | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<Envelope<unknown>> | null;
    if (!value || value.v !== VERSION || typeof value.savedAt !== "number" || !Number.isFinite(value.savedAt)) return null;
    if (value.savedAt > now + 86_400_000 || now - value.savedAt > MAX_SNAPSHOT_AGE_MS) return null;
    return accept(value.data) ? { v: VERSION, savedAt: value.savedAt, data: value.data } : null;
  } catch { return null; }
}

export async function readCache<T>(key: string, accept?: (data: unknown) => data is T, now = Date.now()): Promise<Envelope<T> | null> {
  try { return fromEnvelope<T>(await AsyncStorage.getItem(key), now, accept); } catch { return null; }
}

export async function writeCache<T>(key: string, data: T, now = Date.now()): Promise<void> {
  try { await AsyncStorage.setItem(key, toEnvelope(data, now)); } catch { /* the next launch just loads fresh */ }
}

/** Forget every signed-in snapshot (hub, manage, standings of any guild). Public boards and news stay. */
export async function clearGuildCaches(): Promise<void> {
  try {
    const keys = (await AsyncStorage.getAllKeys()).filter((key) => key.startsWith(GUILD_PREFIX));
    if (keys.length) await AsyncStorage.multiRemove(keys);
  } catch { /* nothing more to clear */ }
}

/** "just now", "5 min ago", "3 h ago", "2 d ago" (and the French forms) for a "last updated" line. */
export function updatedAgo(savedAt: number, now: number, lang: "en" | "fr"): string {
  const minutes = Math.max(0, Math.floor((now - savedAt) / 60_000));
  if (minutes < 1) return lang === "fr" ? "à l'instant" : "just now";
  const [n, unit] = minutes < 60 ? [minutes, "min"] : minutes < 1440 ? [Math.floor(minutes / 60), "h"] : [Math.floor(minutes / 1440), lang === "fr" ? "j" : "d"];
  return lang === "fr" ? `il y a ${n} ${unit}` : `${n} ${unit} ago`;
}
