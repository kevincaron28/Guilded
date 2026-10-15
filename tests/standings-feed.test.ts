import { afterEach, describe, expect, it, vi } from "vitest";
import { createStandingsFeed, type FeedParts } from "../src/services/standings-feed.js";

afterEach(() => { vi.useRealTimers(); });

const header = { protocolVersion: 2, botVersion: "test", features: ["etag"] };
function parts(standings: unknown[], personal: Record<string, unknown> = {}): FeedParts {
  return { shared: { standings }, personal };
}

describe("standings feed", () => {
  it("builds once, then answers from the cache and with 304 for the same ETag", async () => {
    const feed = createStandingsFeed();
    const compose = vi.fn(async () => parts([{ character: "Kev", ep: 10, gp: 5 }]));
    const first = await feed.get({ guildId: "g", memberKey: "m", header, compose });
    expect(first.status).toBe(200);
    expect(JSON.parse(first.body!)).toMatchObject({ protocolVersion: 2, standings: [{ character: "Kev" }] });
    const again = await feed.get({ guildId: "g", memberKey: "m", header, compose, ifNoneMatch: first.etag });
    expect(again).toEqual({ status: 304, etag: first.etag });
    expect(compose).toHaveBeenCalledTimes(1);
  });

  it("gives every member the same stamp for the same shared data, and a newer one when it changes", async () => {
    let now = Date.parse("2026-10-15T10:00:00Z");
    const feed = createStandingsFeed({ now: () => now });
    let standings = [{ character: "Kev", ep: 10, gp: 5 }];
    const a = JSON.parse((await feed.get({ guildId: "g", memberKey: "officer-a", header, compose: async () => parts(standings, { acceptedLedgerRefs: ["x"] }) })).body!);
    now += 60_000;
    const b = JSON.parse((await feed.get({ guildId: "g", memberKey: "officer-b", header, compose: async () => parts(standings, { acceptedLedgerRefs: ["y"] }) })).body!);
    expect(b.updatedAt).toBe(a.updatedAt);
    expect(b.acceptedLedgerRefs).toEqual(["y"]);
    standings = [{ character: "Kev", ep: 20, gp: 5 }];
    feed.markChanged("g");
    now += 60_000;
    const c = JSON.parse((await feed.get({ guildId: "g", memberKey: "officer-a", header, compose: async () => parts(standings) })).body!);
    expect(c.updatedAt > a.updatedAt).toBe(true);
    // Back to the old numbers is still a change: the stamp moves forward, never back.
    standings = [{ character: "Kev", ep: 10, gp: 5 }];
    feed.markChanged("g");
    now += 1;
    const d = JSON.parse((await feed.get({ guildId: "g", memberKey: "officer-a", header, compose: async () => parts(standings) })).body!);
    expect(d.updatedAt > c.updatedAt).toBe(true);
  });

  it("rebuilds after a change or when the cache is older than its lifetime", async () => {
    let now = 1_000_000;
    const feed = createStandingsFeed({ ttlMs: 60_000, now: () => now });
    const compose = vi.fn(async () => parts([]));
    await feed.get({ guildId: "g", memberKey: "m", header, compose });
    await feed.get({ guildId: "g", memberKey: "m", header, compose });
    expect(compose).toHaveBeenCalledTimes(1);
    feed.markChanged("other-guild");
    await feed.get({ guildId: "g", memberKey: "m", header, compose });
    expect(compose).toHaveBeenCalledTimes(1);
    feed.markChanged("g");
    await feed.get({ guildId: "g", memberKey: "m", header, compose });
    expect(compose).toHaveBeenCalledTimes(2);
    now += 61_000;
    await feed.get({ guildId: "g", memberKey: "m", header, compose });
    expect(compose).toHaveBeenCalledTimes(3);
  });

  it("builds once for requests that arrive together", async () => {
    const feed = createStandingsFeed();
    let release: (() => void) | undefined;
    const compose = vi.fn(() => new Promise<FeedParts>((resolve) => { release = () => resolve(parts([])); }));
    const both = Promise.all([feed.get({ guildId: "g", memberKey: "m", header, compose }), feed.get({ guildId: "g", memberKey: "m", header, compose })]);
    await vi.waitFor(() => expect(release).toBeDefined());
    release?.();
    const [one, two] = await both;
    expect(one.etag).toBe(two.etag);
    expect(compose).toHaveBeenCalledTimes(1);
  });

  it("holds a long poll until the guild changes, then answers with the new data", async () => {
    const feed = createStandingsFeed({ wakeDelayMs: 10 });
    let ep = 10;
    const compose = async () => parts([{ character: "Kev", ep, gp: 0 }]);
    const first = await feed.get({ guildId: "g", memberKey: "m", header, compose });
    const waiting = feed.get({ guildId: "g", memberKey: "m", header, compose, ifNoneMatch: first.etag, waitMs: 5_000 });
    await vi.waitFor(() => expect(feed.waiting("g")).toBe(1));
    ep = 30;
    feed.markChanged("g");
    const answer = await waiting;
    expect(answer.status).toBe(200);
    expect(JSON.parse(answer.body!).standings[0].ep).toBe(30);
    expect(feed.waiting("g")).toBe(0);
  });

  it("ends a long poll with 304 when nothing changed in time", async () => {
    const feed = createStandingsFeed();
    const compose = vi.fn(async () => parts([]));
    const first = await feed.get({ guildId: "g", memberKey: "m", header, compose });
    const started = Date.now();
    const answer = await feed.get({ guildId: "g", memberKey: "m", header, compose, ifNoneMatch: first.etag, waitMs: 50 });
    expect(answer.status).toBe(304);
    expect(Date.now() - started).toBeGreaterThanOrEqual(40);
    expect(compose).toHaveBeenCalledTimes(1);
  });

  it("wakes waiting companions once for a burst of changes", async () => {
    const feed = createStandingsFeed({ wakeDelayMs: 20 });
    let version = 0;
    const compose = vi.fn(async () => parts([{ version }]));
    const first = await feed.get({ guildId: "g", memberKey: "m", header, compose });
    const waiting = feed.get({ guildId: "g", memberKey: "m", header, compose, ifNoneMatch: first.etag, waitMs: 5_000 });
    await vi.waitFor(() => expect(feed.waiting("g")).toBe(1));
    for (version = 1; version <= 5; version++) feed.markChanged("g");
    expect((await waiting).status).toBe(200);
    expect(compose).toHaveBeenCalledTimes(2);
  });
});
