import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

// What the companion's GET /api/v1/standings answers, without rebuilding it every time.
//
// - Each (guild, member) answer is cached. It is rebuilt when the guild changed (a write
//   called markGuildChanged) or when it is older than `ttlMs`, so a change made somewhere
//   that does not report itself still arrives within that time.
// - The answer carries an ETag. A companion that already has it gets 304 and writes nothing.
// - `updatedAt` is the moment the guild's shared data (standings, prices, cores, raids) last
//   changed, not the moment of the request. Two officers' companions therefore write the
//   same stamp for the same data, and their addons do not rebroadcast it to each other.
// - A request may wait (long poll) for the next change instead of asking again later.

export interface FeedParts {
  // The same for every member of the guild: hashed for the shared `updatedAt`.
  shared: Record<string, unknown>;
  // Specific to the requesting member (their accepted ledger refs, Discord events they can see).
  personal: Record<string, unknown>;
  // Shared data that counts for the stamp without being sent on its own.
  stampOnly?: Record<string, unknown>;
}

export interface FeedAnswer { status: 200 | 304; etag: string; body?: string }

interface Cached { at: number; generation: number; etag: string; body: string }
export interface Stamp { hash: string; at: number }

export interface StandingsFeedOptions {
  ttlMs?: number;
  maxWaitMs?: number;
  // A burst of writes (an import creates many rows) wakes waiting companions once.
  wakeDelayMs?: number;
  maxEntries?: number;
  now?: () => number;
  // Called when a guild's shared stamp moves, so it can be kept across restarts.
  onStamp?: (guildId: string, stamp: Stamp) => void;
}

export function contentHash(value: unknown): string {
  return createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
}

export function createStandingsFeed(options: StandingsFeedOptions = {}) {
  const ttlMs = options.ttlMs ?? 120_000;
  const maxWaitMs = options.maxWaitMs ?? 25_000;
  const wakeDelayMs = options.wakeDelayMs ?? 1_500;
  const maxEntries = options.maxEntries ?? 500;
  const now = options.now ?? Date.now;
  const cache = new Map<string, Cached>();
  const inflight = new Map<string, Promise<Cached>>();
  const generations = new Map<string, number>();
  const stamps = new Map<string, Stamp>();
  const waiters = new Map<string, Set<() => void>>();
  const wakeTimers = new Map<string, ReturnType<typeof setTimeout>>();

  const generation = (guildId: string) => generations.get(guildId) ?? 0;

  // The stamp only moves when the shared content changes, and always forward.
  function sharedStamp(guildId: string, hash: string): string {
    const last = stamps.get(guildId);
    if (last && last.hash === hash) return new Date(last.at).toISOString();
    const at = Math.max(now(), last ? last.at + 1 : 0);
    const stamp = { hash, at };
    stamps.set(guildId, stamp);
    try { stampListener?.(guildId, stamp); } catch { /* keeping the stamp is best effort */ }
    return new Date(at).toISOString();
  }
  let stampListener = options.onStamp;

  function remember(key: string, entry: Cached) {
    cache.delete(key);
    cache.set(key, entry);
    while (cache.size > maxEntries) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
    }
  }

  async function build(key: string, guildId: string, compose: () => Promise<FeedParts>, header: Record<string, unknown>): Promise<Cached> {
    const running = inflight.get(key);
    if (running) return running;
    const promise = (async () => {
      for (let attempt = 0; attempt < 3; attempt++) {
        const started = generation(guildId);
        const parts = await compose();
        // A write during the read invalidates this snapshot. Never stamp old data as newer
        // than another member's response; the addon trusts that timestamp when syncing.
        if (started !== generation(guildId)) continue;
        const updatedAt = sharedStamp(guildId, contentHash({ shared: parts.shared, stampOnly: parts.stampOnly ?? null }));
        const body = JSON.stringify({ ...header, updatedAt, ...parts.shared, ...parts.personal });
        const entry = { at: now(), generation: started, etag: `"${contentHash(body).slice(0, 32)}"`, body };
        remember(key, entry);
        return entry;
      }
      throw new Error("Standings changed during refresh; retry shortly.");
    })();
    inflight.set(key, promise);
    try { return await promise; } finally { inflight.delete(key); }
  }

  function wait(guildId: string, ms: number): Promise<void> {
    return new Promise((resolve) => {
      const set = waiters.get(guildId) ?? new Set();
      waiters.set(guildId, set);
      const done = () => { clearTimeout(timer); set.delete(done); if (set.size === 0) waiters.delete(guildId); resolve(); };
      const timer = setTimeout(done, ms);
      set.add(done);
    });
  }

  return {
    async get(input: {
      guildId: string; memberKey: string; ifNoneMatch?: string | null; waitMs?: number;
      header: Record<string, unknown>; compose: () => Promise<FeedParts>;
    }): Promise<FeedAnswer> {
      const key = `${input.guildId}:${input.memberKey}`;
      const deadline = now() + Math.max(0, Math.min(maxWaitMs, input.waitMs ?? 0));
      for (;;) {
        const cached = cache.get(key);
        const fresh = cached && cached.generation === generation(input.guildId) && now() - cached.at < ttlMs;
        const entry = fresh ? cached : await build(key, input.guildId, input.compose, input.header);
        if (!input.ifNoneMatch || input.ifNoneMatch !== entry.etag) return { status: 200, etag: entry.etag, body: entry.body };
        const left = deadline - now();
        if (left <= 0) return { status: 304, etag: entry.etag };
        // Nothing new yet: sleep until the guild changes, the wait ends, or the cache expires.
        await wait(input.guildId, Math.min(left, Math.max(1, entry.at + ttlMs - now())));
      }
    },

    // Something this guild's companions read has changed (EP/GP, an import, a core edit).
    markChanged(guildId: string) {
      generations.set(guildId, generation(guildId) + 1);
      if (wakeTimers.has(guildId)) return;
      const timer = setTimeout(() => {
        wakeTimers.delete(guildId);
        for (const wake of [...(waiters.get(guildId) ?? [])]) wake();
      }, wakeDelayMs);
      timer.unref?.();
      wakeTimers.set(guildId, timer);
    },

    waiting(guildId: string) { return waiters.get(guildId)?.size ?? 0; },

    // Stamps saved before a restart. Identical shared data then keeps its old stamp, so the
    // first answer after a restart does not make every in-game client rebroadcast it. Only
    // fills guilds this process has not stamped yet, and refuses stamps from the future.
    restoreStamps(saved: Record<string, Stamp>) {
      for (const [guildId, stamp] of Object.entries(saved)) {
        if (stamps.has(guildId) || typeof stamp?.hash !== "string" || !/^[0-9a-f]{64}$/.test(stamp.hash)) continue;
        if (!Number.isFinite(stamp.at) || stamp.at <= 0 || stamp.at > now() + 60_000) continue;
        stamps.set(guildId, { hash: stamp.hash, at: stamp.at });
      }
    },
    stamps(): Record<string, Stamp> { return Object.fromEntries(stamps); },
    onStamp(listener: ((guildId: string, stamp: Stamp) => void) | undefined) { stampListener = listener; },

    clear() {
      cache.clear(); inflight.clear(); generations.clear(); stamps.clear();
      for (const timer of wakeTimers.values()) clearTimeout(timer);
      wakeTimers.clear();
      for (const set of waiters.values()) for (const wake of [...set]) wake();
    }
  };
}

export type StandingsFeed = ReturnType<typeof createStandingsFeed>;

// The bot's one feed. Writers call markGuildChanged so waiting companions hear at once.
export const standingsFeed = createStandingsFeed();
export function markGuildChanged(guildId: string): void {
  standingsFeed.markChanged(guildId);
}

// Keeps the feed's shared stamps in a small private file (like backups/pilot-requests.json),
// so a restart does not wake Postgres or trigger an in-game rebroadcast of unchanged data.
// Losing the file is harmless: the next answer simply gets a new stamp, as before.
export async function keepStampsOnDisk(feed: StandingsFeed, path = "backups/standings-stamps.json", delayMs = 5_000) {
  try {
    const saved = JSON.parse(await readFile(path, "utf8")) as unknown;
    if (saved && typeof saved === "object" && !Array.isArray(saved)) feed.restoreStamps(saved as Record<string, Stamp>);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") console.warn(`Standings stamps not restored (${(error as Error).message}); they start fresh.`);
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  let writing = Promise.resolve();
  const write = () => {
    timer = undefined;
    writing = writing.then(async () => {
      const temp = `${path}.${randomUUID()}.tmp`;
      try {
        await mkdir(dirname(path), { recursive: true, mode: 0o700 });
        await writeFile(temp, JSON.stringify(feed.stamps()), { flag: "wx", mode: 0o600 });
        await rename(temp, path);
      } catch (error) {
        console.warn(`Standings stamps not saved (${(error as Error).message}).`);
      } finally { await rm(temp, { force: true }).catch(() => undefined); }
    });
  };
  feed.onStamp(() => {
    if (timer) return;
    timer = setTimeout(write, delayMs);
    timer.unref?.();
  });
  return {
    // Writes a pending change now (shutdown, tests).
    async flush() { if (timer) { clearTimeout(timer); write(); } await writing; }
  };
}

// What this bot can do for a companion, so a newer companion only uses what is there.
export const COMPANION_FEATURES = ["gzip-upload", "ledger-delta", "loot-delta", "etag", "long-poll"] as const;
