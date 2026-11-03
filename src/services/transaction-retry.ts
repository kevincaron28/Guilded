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
