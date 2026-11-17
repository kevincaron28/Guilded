import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { acceptsGzip, createStandingsFeed, type FeedParts } from "../src/services/standings-feed.js";
import { createStandingsAuthCache } from "../src/services/standings-auth-cache.js";

const header = { protocolVersion: 2, botVersion: "test" };
const withRaids = (ep: number, raids: unknown[] = [{ at: "2026-12-01T00:00:00Z" }]): FeedParts =>
  ({ shared: { standings: [{ ep }] }, personal: { publicRaids: { raids } }, volatileFetchedAt: ["publicRaids"] });

describe("standings ETag ignores per-build timestamps", () => {
  it("keeps the ETag and fetchedAt across rebuilds of the same content, so the poll gets 304", async () => {
    let clock = 1_800_000_000_000;
    const feed = createStandingsFeed({ now: () => clock, ttlMs: 120_000 });
    const first = await feed.get({ guildId: "g", memberKey: "a", header, compose: async () => withRaids(1) });
    clock += 130_000; // the 120 s TTL expires: a rebuild
    const second = await feed.get({ guildId: "g", memberKey: "a", header, compose: async () => withRaids(1) });
    expect(second.etag).toBe(first.etag);
    expect(JSON.parse(second.body!).publicRaids.fetchedAt).toBe(JSON.parse(first.body!).publicRaids.fetchedAt);
    const third = await feed.get({ guildId: "g", memberKey: "a", header, ifNoneMatch: first.etag, compose: async () => withRaids(1) });
    expect(third.status).toBe(304);
    feed.clear();
  });

  it("refreshes fetchedAt (new ETag) once it is older than 5 minutes, and when the content changes", async () => {
    let clock = 1_800_000_000_000;
    const feed = createStandingsFeed({ now: () => clock });
    const first = await feed.get({ guildId: "g", memberKey: "a", header, compose: async () => withRaids(1) });
    clock += 310_000;
    const second = await feed.get({ guildId: "g", memberKey: "a", header, compose: async () => withRaids(1) });
    expect(second.etag).not.toBe(first.etag);
    expect(Date.parse(JSON.parse(second.body!).publicRaids.fetchedAt)).toBe(clock);
    // fetchedAt stays under the addon's 10 minute expiry whenever the poll answers.
    clock += 10_000;
    feed.markChanged("g");
    const third = await feed.get({ guildId: "g", memberKey: "a", header, compose: async () => withRaids(2) });
    expect(third.etag).not.toBe(second.etag);
    expect(JSON.parse(third.body!).standings[0].ep).toBe(2);
    expect(Date.parse(JSON.parse(third.body!).publicRaids.fetchedAt)).toBe(clock);
    feed.clear();
  });

  it("a changed raid list changes the ETag", async () => {
    let clock = 1_800_000_000_000;
    const feed = createStandingsFeed({ now: () => clock });
    const a = await feed.get({ guildId: "g", memberKey: "a", header, compose: async () => withRaids(1, []) });
    clock += 1_000; feed.markChanged("g");
    const b = await feed.get({ guildId: "g", memberKey: "a", header, compose: async () => withRaids(1, [{ at: "x" }]) });
    expect(b.etag).not.toBe(a.etag);
    feed.clear();
  });
});

describe("standings gzip", () => {
  it("negotiates Accept-Encoding", () => {
    expect(acceptsGzip("gzip, deflate, br")).toBe(true);
    expect(acceptsGzip("br;q=1.0, gzip;q=0.8")).toBe(true);
    expect(acceptsGzip("*")).toBe(true);
    expect(acceptsGzip("gzip;q=0")).toBe(false);
    expect(acceptsGzip("identity")).toBe(false);
    expect(acceptsGzip(undefined)).toBe(false);
  });

  it("compresses once per build and the bytes decode to the body", async () => {
    const feed = createStandingsFeed();
    const answer = await feed.get({ guildId: "g", memberKey: "a", header, compose: async () => withRaids(1) });
    const packed = await answer.gzip!();
    expect(gunzipSync(packed).toString()).toBe(answer.body);
    expect(await answer.gzip!()).toBe(packed);
    const again = await feed.get({ guildId: "g", memberKey: "a", header, compose: async () => withRaids(1) });
    expect(await again.gzip!()).toBe(packed); // the cached build keeps its compressed copy
    feed.clear();
  });
});

describe("standings auth cache", () => {
  it("keeps an answer for 30 s, then asks again", () => {
    let t = 0;
    const cache = createStandingsAuthCache<string>({ now: () => t });
    cache.set("secret", "guild", "member");
    expect(cache.get("secret", "guild")).toBe("member");
    expect(cache.get("secret", "other")).toBeUndefined();
    t = 29_999; expect(cache.get("secret", "guild")).toBe("member");
    t = 30_000; expect(cache.get("secret", "guild")).toBeUndefined();
  });

  it("is bounded (least recently used goes) and forgets a signed-out credential", () => {
    const cache = createStandingsAuthCache<number>({ maxEntries: 2 });
    cache.set("a", "g", 1); cache.set("b", "g", 2);
    cache.get("a", "g");
    cache.set("c", "g", 3);
    expect(cache.size()).toBe(2);
    expect(cache.get("b", "g")).toBeUndefined();
    cache.forget("a");
    expect(cache.get("a", "g")).toBeUndefined();
    expect(cache.get("c", "g")).toBe(3);
  });
});
