import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { applySharpLimits, discordCacheOptions, MESSAGE_CACHE_LIMIT, SHARP_CACHE } from "../src/memory-limits.js";
import { readFileSync } from "node:fs";

describe("memory limits", () => {
  it("caps the libvips cache and threads", () => {
    const cache = applySharpLimits();
    expect(cache.memory.max).toBe(SHARP_CACHE.memory);
    expect(cache.files.max).toBe(0);
    expect(cache.items.max).toBe(SHARP_CACHE.items);
    expect(sharp.concurrency()).toBe(1);
  });
  it("limits the discord.js caches the bot never reads, and sweeps old messages", () => {
    const options = discordCacheOptions();
    expect(options.makeCache).toBeTypeOf("function");
    expect(options.sweepers?.messages).toMatchObject({ lifetime: expect.any(Number) });
    expect(MESSAGE_CACHE_LIMIT).toBeLessThanOrEqual(50);
  });
  it("sets MALLOC_ARENA_MAX in the systemd unit", () => {
    expect(readFileSync("deploy/guilded.service", "utf8")).toContain("Environment=MALLOC_ARENA_MAX=2");
  });
});
