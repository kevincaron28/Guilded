import { useCallback, useEffect, useRef, useState } from "react";
import { readCache, writeCache } from "./cache";

export interface CachedResource<T> {
  data: T | null;
  /** When `data` was fetched (or saved last), epoch ms; null before anything is known. */
  savedAt: number | null;
  /** The newest answer could not be fetched. `data` may still hold the saved one. */
  failed: boolean;
  /** The data on screen is the saved copy and the refresh has not (yet) succeeded. */
  stale: boolean;
  /** A fresh copy is being fetched. */
  refreshing: boolean;
  retry: () => void;
  /** Pull to refresh: fetch again without clearing what is on screen (no layout jump); the promise settles when done. */
  reload: () => Promise<void>;
}

/**
 * Show the saved copy of `key` at once, then fetch a fresh one in the background and save it.
 * A failed refresh keeps showing the saved copy (stale) instead of an error; only with nothing saved does `failed` mean "show retry".
 * `load` is read at the moment it runs, so it may close over props; the effect restarts when `key` or `attempt` change.
 */
export function useCachedResource<T>(key: string, load: () => Promise<T>, accept?: (data: unknown) => data is T): CachedResource<T> {
  const [data, setData] = useState<T | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [stale, setStale] = useState(false);
  const [refreshing, setRefreshing] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    let active = true;
    setData(null); setSavedAt(null); setFailed(false); setStale(false); setRefreshing(true);
    void (async () => {
      const saved = await readCache<T>(key, accept);
      if (active && saved) { setData(saved.data); setSavedAt(saved.savedAt); setStale(true); }
      try {
        const fresh = await loadRef.current();
        if (!active) return;
        const now = Date.now();
        setData(fresh); setSavedAt(now); setStale(false); setFailed(false);
        void writeCache(key, fresh, now);
      } catch {
        if (active) setFailed(true);
      } finally { if (active) setRefreshing(false); }
    })();
    return () => { active = false; };
  // `accept` is a module-level guard and `load` is read through the ref, so only the key and the retry counter restart this.
  }, [key, attempt]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const reload = useCallback(async () => {
    try {
      const fresh = await loadRef.current();
      const now = Date.now();
      setData(fresh); setSavedAt(now); setStale(false); setFailed(false);
      void writeCache(key, fresh, now);
    } catch { setFailed(true); }
  }, [key]);
  return { data, savedAt, failed, stale, refreshing, retry, reload };
}
