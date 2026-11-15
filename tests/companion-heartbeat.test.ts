import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { setTimeout as realDelay } from "node:timers/promises";
import { botClockOffset, featuresLua, forgetBotClock, noteBotClock } from "../companion/group-relay.mjs";
import { createEngine } from "../companion/engine.mjs";

// 9.3.3: the engine rewrites the alive marker of the generated files while it runs, and stops when it is stopped (sign-out stops the engine).
// The marker also carries the bot's clock when it is known, so a PC clock that is off does not decide whether the companion looks alive.

const folders: string[] = [];
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); forgetBotClock(); for (const dir of folders.splice(0)) rmSync(dir, { recursive: true, force: true }); });

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "guilded-heartbeat-")); folders.push(dir);
  const saved = join(dir, "WTF", "Account", "A", "SavedVariables"); mkdirSync(saved, { recursive: true });
  const addon = join(dir, "Interface", "AddOns", "Guilded"); mkdirSync(addon, { recursive: true });
  const watchFile = join(saved, "Guilded.lua"); writeFileSync(watchFile, 'GuildedDB={version=4,addonVersion="6.2.0"}');
  const standings = join(addon, "Standings.lua");
  return { config: { watchFile, realm: "R", uploadUrl: "https://bot.test/api/v1/addon-imports", guildDiscordId: "123", companionCredential: "x".repeat(43) }, standings };
}
// File reads and writes finish on real I/O, which fake timers do not advance.
const settle = () => realDelay(150);
const markerAt = (path: string) => Number(/ at = (\d+)/.exec(readFileSync(path, "utf8"))?.[1]);

describe("the companion heartbeat", () => {
  it("rewrites an old marker while running, and no longer once the engine is stopped (as at sign-out)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    vi.setSystemTime(new Date("2026-11-15T12:00:00Z"));
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL) => String(url).includes("standings")
      ? { ok: false, status: 304, headers: { get: () => null }, json: async () => ({}) }
      : { ok: true, status: 201, headers: { get: () => null }, json: async () => ({ autoApplied: { epgp: 0, discovered: 0 } }) }));
    const { config, standings } = fixture();
    const old = Date.now() - 3 * 3_600_000;
    writeFileSync(standings, `GuildedStandings = {}\n${featuresLua(null, old)}\n`);
    const engine = createEngine(config);
    try {
      expect(await engine.start()).toBe(true);
      await vi.advanceTimersByTimeAsync(40_000);
      await settle();
      expect(markerAt(standings)).toBeGreaterThan(Math.floor(old / 1000) + 3_000);
    } finally { await engine.stop(); }
    // Stopped: an old marker stays old however long the clock runs.
    writeFileSync(standings, `GuildedStandings = {}\n${featuresLua(null, old)}\n`);
    await vi.advanceTimersByTimeAsync(3_600_000);
    await settle();
    expect(markerAt(standings)).toBe(Math.floor(old / 1000));
  });
});

describe("the bot's clock in the marker", () => {
  it("is written next to the PC time once the bot has answered, and left out before", () => {
    const now = Date.parse("2026-11-15T12:00:00Z");
    expect(featuresLua(null, now)).not.toContain("bt =");
    noteBotClock("Sun, 15 Nov 2026 07:00:05 GMT", now); // the PC is five hours ahead of the bot
    expect(botClockOffset()).toBe(-(5 * 3_600_000) + 5_000);
    expect(featuresLua(null, now)).toContain(`at = ${now / 1000}, bt = ${now / 1000 - 5 * 3600 + 5} }`);
    noteBotClock("not a date", now);
    expect(botClockOffset()).toBe(-(5 * 3_600_000) + 5_000);
  });
});
