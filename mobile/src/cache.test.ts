import { beforeEach, describe, expect, it, vi } from "vitest";
const store = vi.hoisted(() => ({ bag: new Map<string, string>(), fail: false }));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (key: string) => { if (store.fail) throw new Error("disk"); return store.bag.get(key) ?? null; },
    setItem: async (key: string, value: string) => { if (store.fail) throw new Error("disk"); store.bag.set(key, value); },
    getAllKeys: async () => [...store.bag.keys()],
    multiRemove: async (keys: string[]) => { for (const key of keys) store.bag.delete(key); }
  }
}));
import { MAX_SNAPSHOT_AGE_MS, cacheKey, clearGuildCaches, fromEnvelope, guildCacheKey, readCache, toEnvelope, updatedAgo, writeCache } from "./cache";

beforeEach(() => { store.bag.clear(); store.fail = false; });
const now = Date.UTC(2026, 10, 18, 12);

describe("offline snapshots", () => {
  it("round trips a value with its save time", async () => {
    await writeCache(cacheKey("boards", "https://x", "en"), { season: "S1" }, now);
    expect(await readCache<{ season: string }>(cacheKey("boards", "https://x", "en"), undefined, now + 60_000)).toEqual({ v: 1, savedAt: now, data: { season: "S1" } });
  });
  it("ignores damaged, foreign, rejected, future and too old copies", () => {
    expect(fromEnvelope(null, now)).toBeNull();
    expect(fromEnvelope("not json", now)).toBeNull();
    expect(fromEnvelope(JSON.stringify({ v: 9, savedAt: now, data: 1 }), now)).toBeNull();
    expect(fromEnvelope(JSON.stringify({ v: 1, savedAt: "x", data: 1 }), now)).toBeNull();
    expect(fromEnvelope(toEnvelope({ a: 1 }, now), now, (d): d is { b: number } => typeof d === "object" && d !== null && "b" in d)).toBeNull();
    expect(fromEnvelope(toEnvelope(1, now + 2 * 86_400_000), now)).toBeNull();
    expect(fromEnvelope(toEnvelope(1, now - MAX_SNAPSHOT_AGE_MS - 1), now)).toBeNull();
    expect(fromEnvelope(toEnvelope(1, now - MAX_SNAPSHOT_AGE_MS + 1000), now)?.data).toBe(1);
  });
  it("never throws when the store fails", async () => {
    store.fail = true;
    await expect(writeCache("k", 1)).resolves.toBeUndefined();
    await expect(readCache("k")).resolves.toBeNull();
  });
  it("forgets only the signed-in guild snapshots", async () => {
    await writeCache(guildCacheKey("123", "hub"), { a: 1 }, now);
    await writeCache(guildCacheKey("456", "standings"), { a: 2 }, now);
    await writeCache(cacheKey("news", "https://x"), { items: [] }, now);
    await clearGuildCaches();
    expect([...store.bag.keys()]).toEqual([cacheKey("news", "https://x")]);
  });
  it("words the age in English and French", () => {
    expect(updatedAgo(now, now + 20_000, "en")).toBe("just now");
    expect(updatedAgo(now, now + 5 * 60_000, "en")).toBe("5 min ago");
    expect(updatedAgo(now, now + 3 * 3_600_000, "fr")).toBe("il y a 3 h");
    expect(updatedAgo(now, now + 2 * 86_400_000, "fr")).toBe("il y a 2 j");
    expect(updatedAgo(now, now - 5000, "en")).toBe("just now");
  });
});
