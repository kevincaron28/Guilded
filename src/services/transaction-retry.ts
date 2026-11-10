// Aiven allows 20 connections and reserves 3. Production sets connection_limit=5,
// so a handful of interactive transactions can fill the pool. Prisma reports that
// as P2028 "Unable to start a transaction in the given time" once maxWait expires.
// maxWait only covers acquiring a connection. The connection stays checked out
// for the whole callback, including advisory-lock waits, so Discord HTTP does not
// belong inside it. 8s is long enough for the 3s busy-pool check in
// scripts/verify-game-events-postgres.ts and short enough to fail into a retry
// instead of sitting on the 30s pool timeout.
export const SHORT_TRANSACTION = { maxWait: 8_000, timeout: 15_000 } as const;

const START_FAILURE = /Unable to start a transaction in the given time|Timed out fetching a new connection/i;

export function isTransientTransactionStart(error: unknown): boolean {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  const message = error instanceof Error ? error.message
    : error && typeof error === "object" && "message" in error && typeof error.message === "string" ? error.message
    : "";
  // P2028 is also used once a transaction has started and then expired. Only the
  // start/pool messages are safe to retry; the work was never begun.
  return code === "P2024" || START_FAILURE.test(message);
}

const sleep = (ms: number) => new Promise<void>(resolve => { setTimeout(resolve, ms); });

/** P2034: a write conflict or serialization failure; Prisma documents retrying the transaction. */
export function isWriteConflict(error: unknown): boolean {
  const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
  const message = error instanceof Error ? error.message : "";
  return code === "P2034" || /could not serialize access|deadlock detected|write conflict/i.test(message);
}

/**
 * Retries a transaction that lost a write conflict (two uploads touching the same rows, 9 Nov 2026) a few
 * times with short jittered backoff, giving up once `budgetMs` has passed so an upload stays well under the
 * website Worker's 20 s limit. Pool-start failures (P2024) are retried too. Other errors throw at once.
 */
export async function retryWriteConflict<T>(run: () => Promise<T>, options?: {
  attempts?: number;
  budgetMs?: number;
  baseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  random?: () => number;
}): Promise<T> {
  const attempts = Math.min(6, Math.max(1, options?.attempts ?? 4));
  const budget = options?.budgetMs ?? 8_000;
  const base = options?.baseDelayMs ?? 150;
  const wait = options?.sleep ?? sleep;
  const now = options?.now ?? Date.now;
  const random = options?.random ?? Math.random;
  const startedAt = now();
  for (let attempt = 1; ; attempt++) {
    try {
      return await run();
    } catch (error) {
      if (attempt >= attempts || !(isWriteConflict(error) || isTransientTransactionStart(error))) throw error;
      const delay = Math.round(base * 2 ** (attempt - 1) * (0.5 + random()));
      if (now() - startedAt + delay > budget) throw error;
      await wait(delay);
    }
  }
}

const chains = new Map<string, Promise<unknown>>();

/**
 * Runs work for one key (a guild) one at a time inside this process, so two uploads of the same roster apply
 * one after the other instead of colliding on the same rows. Failures do not block the next in line.
 */
export function serializeByKey<T>(key: string, work: () => Promise<T>): Promise<T> {
  const previous = chains.get(key) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(work);
  const tail = next.catch(() => undefined);
  chains.set(key, tail);
  void tail.then(() => { if (chains.get(key) === tail) chains.delete(key); });
  return next;
}

/** Try a transaction a few times when the pool cannot hand one out yet. */
export async function retryTransientTransaction<T>(run: () => Promise<T>, options?: {
  attempts?: number;
  baseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<T> {
  const attempts = Math.min(5, Math.max(1, options?.attempts ?? 3));
  const base = options?.baseDelayMs ?? 250;
  const wait = options?.sleep ?? sleep;
  let last: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await run();
    } catch (error) {
      last = error;
      if (attempt === attempts || !isTransientTransactionStart(error)) throw error;
      await wait(base * 2 ** (attempt - 1));
    }
  }
  throw last;
}
