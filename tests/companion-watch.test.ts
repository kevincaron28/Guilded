import { afterEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// The folder watch is replaced by fakes this test can make fail on demand.
const { watchers } = vi.hoisted(() => ({ watchers: [] as (EventEmitter & { close: () => void })[] }));
vi.mock("node:fs", async (original) => {
  const real = await original<typeof import("node:fs")>();
  const { EventEmitter: Emitter } = await import("node:events");
  return { ...real, watch: vi.fn(() => { const fake = Object.assign(new Emitter(), { close: vi.fn() }); watchers.push(fake); return fake; }) };
});
const { createEngine } = await import("../companion/engine.mjs");

const folders: string[] = [];
afterEach(() => {
  vi.useRealTimers(); vi.unstubAllGlobals(); watchers.splice(0);
  for (const dir of folders.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "guilded-watch-")); folders.push(dir);
  const saved = join(dir, "WTF", "Account", "A", "SavedVariables"); mkdirSync(saved, { recursive: true });
  mkdirSync(join(dir, "Interface", "AddOns", "Guilded"), { recursive: true });
  const watchFile = join(saved, "Guilded.lua"); writeFileSync(watchFile, 'GuildedDB={version=4,addonVersion="6.2.0"}');
  return { watchFile, realm: "R", uploadUrl: "https://bot.test/api/v1/addon-imports", guildDiscordId: "123", companionCredential: "x".repeat(43) };
}

describe("companion folder watch recovery", () => {
  it("falls back to the 30-second check, then tries the watch again instead of giving up for the session", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => String(url).includes("standings")
      ? { ok: true, status: 200, json: async () => ({ protocolVersion: 2, updatedAt: "now", standings: [] }) }
      : { ok: true, status: 201, json: async () => ({ autoApplied: { epgp: 0, discovered: 0 } }) }));
    const engine = createEngine(fixture());
    const fail = () => watchers.at(-1)!.emit("error", new Error("EPERM"));
    try {
      expect(await engine.start()).toBe(true);
      expect(watchers).toHaveLength(1);
      expect(engine.state().fileWatch).toBe("watching");
      // Five quick failures each restart the watch after 5 seconds.
      for (let i = 0; i < 5; i++) {
        fail();
        expect(engine.state().fileWatch).toBe("checking");
        await vi.advanceTimersByTimeAsync(5_000);
      }
      expect(watchers).toHaveLength(6);
      // The sixth gives up for now: saves are still noticed by the 30-second check.
      fail();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(watchers).toHaveLength(6);
      expect(engine.state().fileWatch).toBe("checking");
      // A few minutes later the watch is tried again and works.
      await vi.advanceTimersByTimeAsync(5 * 60_000);
      expect(watchers).toHaveLength(7);
      expect(engine.state().fileWatch).toBe("watching");
      // Rare failures far apart never add up to "keeps stopping": each one restarts the watch.
      for (let i = 0; i < 7; i++) {
        await vi.advanceTimersByTimeAsync(11 * 60_000);
        fail();
        await vi.advanceTimersByTimeAsync(5_000);
      }
      expect(watchers).toHaveLength(14);
      expect(engine.state().fileWatch).toBe("watching");
    } finally { await engine.stop(); }
    expect(engine.state().fileWatch).toBeNull();
  });
});
