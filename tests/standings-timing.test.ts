import { describe, expect, it, vi } from "vitest";
import { createStandingsFeed, type FeedParts } from "../src/services/standings-feed.js";
import { calendarEventsWithin } from "../src/services/discord-calendar.js";
import { errorCodeNote } from "../companion/engine.mjs";

// Hotfix 2 (8.5): a companion's plain standings request right after an upload timed out at 20 s
// ("Could not reach the bot") while the bot rebuilt the answer. The bot now answers in time.

const header = { protocolVersion: 2 };
const parts = (ep: number): FeedParts => ({ shared: { standings: [{ ep }] }, personal: {} });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("standings answer time", () => {
  it("a rebuild slower than the budget answers with the member's previous answer, then the new one", async () => {
    const feed = createStandingsFeed({ composeBudgetMs: 50 });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const first = await feed.get({ guildId: "g", memberKey: "m", header, compose: async () => parts(10) });
    feed.markChanged("g"); // the member's upload
    const started = Date.now();
    const slowCompose = vi.fn(async () => { await sleep(300); return parts(20); });
    const answer = await feed.get({ guildId: "g", memberKey: "m", header, compose: slowCompose });
    expect(Date.now() - started).toBeLessThan(250);
    expect(answer.body).toBe(first.body); // the previous answer, with its own (older) stamp
    await sleep(350); // the rebuild finished in the background
    const next = await feed.get({ guildId: "g", memberKey: "m", header, compose: slowCompose });
    expect(JSON.parse(next.body!).standings).toEqual([{ ep: 20 }]);
    expect(slowCompose).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore(); feed.clear();
  });

  it("a first answer (nothing to fall back on) still waits for the rebuild", async () => {
    const feed = createStandingsFeed({ composeBudgetMs: 20 });
    const answer = await feed.get({ guildId: "g", memberKey: "m", header, compose: async () => { await sleep(60); return parts(5); } });
    expect(JSON.parse(answer.body!).standings).toEqual([{ ep: 5 }]);
    feed.clear();
  });

  it("stops re-reading once the budget is spent, even while writes keep landing", async () => {
    let clock = 1_800_000_000_000;
    const feed = createStandingsFeed({ composeBudgetMs: 10_000, now: () => clock });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const compose = vi.fn(async () => { clock += 12_000; feed.markChanged("g"); return parts(1); });
    const answer = await feed.get({ guildId: "g", memberKey: "m", header, compose });
    expect(answer.status).toBe(200);
    expect(compose).toHaveBeenCalledTimes(1);
    warn.mockRestore(); feed.clear();
  });
});

describe("Discord scheduled events in the standings answer", () => {
  it("answer within the limit with the last known events, and refresh them for the next answer", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const event = { id: "1" } as never;
    expect(await calendarEventsWithin(async () => [event], "g:a", 50)).toEqual([event]);
    const started = Date.now();
    expect(await calendarEventsWithin(async () => { await sleep(200); return []; }, "g:a", 30)).toEqual([event]);
    expect(Date.now() - started).toBeLessThan(150);
    expect(await calendarEventsWithin(async () => { await sleep(200); return [event]; }, "g:new", 30)).toEqual([]);
    await sleep(250);
    expect(await calendarEventsWithin(async () => { await sleep(200); return []; }, "g:new", 30)).toEqual([event]);
    warn.mockRestore();
  });
});

describe("logs", () => {
  it("one standings line with the guild hashed and no secrets", async () => {
    const { standingsTimingLine } = await import("../src/companion-api.js");
    const line = standingsTimingLine({ guild: "123456789012345678", status: 200, ms: 1234.4, bytes: 999, wait: null, conditional: true });
    expect(line).toMatch(/^standings guild=[0-9a-f]{8} status=200 ms=1234 bytes=999 wait=0 conditional=1$/);
    expect(line).not.toContain("123456789012345678");
    expect(standingsTimingLine({ guild: null, status: "closed", ms: 20000, bytes: 0, wait: "12", conditional: false })).toContain("status=closed");
  });

  it("the companion names what failed under 'Could not reach the bot'", () => {
    expect(errorCodeNote(Object.assign(new Error("fetch failed"), { cause: { code: "UND_ERR_HEADERS_TIMEOUT" } }))).toBe(" [UND_ERR_HEADERS_TIMEOUT]");
    expect(errorCodeNote(Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }))).toBe(" [TimeoutError]");
    expect(errorCodeNote(new Error("plain"))).toBe("");
    expect(errorCodeNote({ cause: { code: "bad code with spaces" } })).toBe("");
  });
});
