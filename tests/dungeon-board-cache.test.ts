import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createDungeonBoardCache } from "../src/services/dungeon-board-cache.js";
import { addonDungeonBoard } from "../src/services/dungeon-stats.js";
import { dungeonBoardFixture } from "./helpers/dungeon-board-fixture.js";

describe("dungeon board content", () => {
  it("is exactly what the quadratic role-level scan produced (sha256 of the whole board JSON)", async () => {
    const { database } = dungeonBoardFixture();
    const board = await addonDungeonBoard(database as never, "g", new Date("2026-11-20T12:00:00Z"));
    const json = JSON.stringify(board);
    expect(board!.profiles).toHaveLength(40);
    expect(json.length).toBe(506434);
    expect(createHash("sha256").update(json).digest("hex")).toBe("5146e8a7cacbb4310c2f72a9a0176f3f3665fb1442755499e139813c983aecb8");
  }, 60_000);
});

describe("dungeon board cache", () => {
  const board = (name: string) => ({ season: name }) as never;
  function setup(options: { maxAgeMs?: number } = {}) {
    let clock = 1_000_000;
    let current = board("A");
    const build = vi.fn(async () => current);
    const log = vi.fn();
    const onChanged = vi.fn();
    const cache = createDungeonBoardCache({ now: () => clock, build, log, ...options });
    return { cache, build, log, onChanged, advance: (ms: number) => { clock += ms; }, change: (name: string) => { current = board(name); },
      settle: () => new Promise(resolve => setTimeout(resolve, 0)) };
  }

  it("builds once and serves the kept board to every later read (a non-dungeon change of the guild never rebuilds it)", async () => {
    const t = setup();
    const first = await t.cache.get({} as never, "g1", t.onChanged);
    // Each EP/GP, bank or raid change re-reads the standings; here that is many reads within the age limit.
    for (let i = 0; i < 20; i++) { t.advance(20_000); expect(await t.cache.get({} as never, "g1", t.onChanged)).toBe(first); }
    expect(t.build).toHaveBeenCalledTimes(1);
    expect(t.onChanged).not.toHaveBeenCalled();
  });

  it("joins concurrent first reads and keeps guilds apart", async () => {
    const t = setup();
    await Promise.all([t.cache.get({} as never, "g1"), t.cache.get({} as never, "g1"), t.cache.get({} as never, "g2")]);
    expect(t.build).toHaveBeenCalledTimes(2);
  });

  it("logs the build time and size so production can be watched", async () => {
    const t = setup();
    await t.cache.get({} as never, "g1");
    expect(t.log).toHaveBeenCalledWith(expect.stringMatching(/^Dungeon board for guild g1 built in 0 ms \(\d+ bytes, first read\)\.$/));
  });

  it("after a dungeon change it answers at once with the old board and rebuilds once in the background, then tells the feed", async () => {
    const t = setup();
    const first = await t.cache.get({} as never, "g1", t.onChanged);
    t.change("B");
    t.cache.invalidate("g1");
    expect(await t.cache.get({} as never, "g1", t.onChanged)).toBe(first);
    expect(await t.cache.get({} as never, "g1", t.onChanged)).toBe(first);
    await t.settle();
    expect(t.build).toHaveBeenCalledTimes(2);
    expect(t.onChanged).toHaveBeenCalledOnce();
    expect(await t.cache.get({} as never, "g1", t.onChanged)).toEqual({ season: "B" });
    expect(t.build).toHaveBeenCalledTimes(2);
  });

  it("keeps the very same object and stays quiet when a rebuild finds the same content", async () => {
    const t = setup({ maxAgeMs: 600_000 });
    const first = await t.cache.get({} as never, "g1", t.onChanged);
    t.advance(600_000);
    expect(await t.cache.get({} as never, "g1", t.onChanged)).toBe(first);
    await t.settle();
    expect(t.build).toHaveBeenCalledTimes(2);
    expect(t.onChanged).not.toHaveBeenCalled();
    expect(await t.cache.get({} as never, "g1", t.onChanged)).toBe(first);
  });

  it("keeps the old board when a rebuild fails and tries again after the retry delay", async () => {
    const t = setup();
    const first = await t.cache.get({} as never, "g1", t.onChanged);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    t.build.mockRejectedValueOnce(new Error("pool timeout"));
    t.cache.invalidate("g1");
    expect(await t.cache.get({} as never, "g1", t.onChanged)).toBe(first);
    await t.settle();
    expect(warn).toHaveBeenCalled();
    t.advance(10_000);
    await t.cache.get({} as never, "g1", t.onChanged);
    await t.settle();
    expect(t.build).toHaveBeenCalledTimes(2);
    t.advance(60_000);
    await t.cache.get({} as never, "g1", t.onChanged);
    await t.settle();
    expect(t.build).toHaveBeenCalledTimes(3);
    warn.mockRestore();
  });
});
