import { createHash } from "node:crypto";

// A companion long-polls GET /api/v1/standings every few seconds, and each poll ran the credential lookup plus a forced Discord member
// fetch. The answer to "who is this credential in this guild" is kept for a short time instead. Only that GET uses it: uploads and every
// other route still check in full. A revoked credential, a removed member or a demoted officer therefore keeps reading standings for at
// most `ttlMs` (30 s) after the change; an explicit sign-out (logout route) forgets the credential at once.

export interface StandingsAuthCacheOptions { ttlMs?: number; maxEntries?: number; now?: () => number }

export function createStandingsAuthCache<T>(options: StandingsAuthCacheOptions = {}) {
  const ttlMs = options.ttlMs ?? 30_000;
  const maxEntries = options.maxEntries ?? 500;
  const now = options.now ?? Date.now;
  const entries = new Map<string, { at: number; value: T }>();
  const key = (secret: string, scope: string) => `${createHash("sha256").update(secret).digest("hex")}:${scope}`;
  return {
    get(secret: string, scope: string): T | undefined {
      const k = key(secret, scope);
      const hit = entries.get(k);
      if (!hit) return undefined;
      if (now() - hit.at >= ttlMs) { entries.delete(k); return undefined; }
      entries.delete(k); entries.set(k, hit); // least recently used last
      return hit.value;
    },
    set(secret: string, scope: string, value: T): void {
      const k = key(secret, scope);
      entries.delete(k);
      entries.set(k, { at: now(), value });
      while (entries.size > maxEntries) { const oldest = entries.keys().next().value; if (oldest === undefined) break; entries.delete(oldest); }
    },
    /** Forgets every entry of one credential (sign-out). */
    forget(secret: string): void {
      const prefix = `${createHash("sha256").update(secret).digest("hex")}:`;
      for (const k of [...entries.keys()]) if (k.startsWith(prefix)) entries.delete(k);
    },
    size: () => entries.size,
    clear: () => entries.clear()
  };
}
