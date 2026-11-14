import { afterEach, describe, expect, it, vi } from "vitest";
import { handleDeviceUpload, type DeviceRow, type DeviceStore, type ServerCandidate } from "../src/services/companion-device.js";
import { newLuaSession, type LuaSession } from "./lua/harness.js";

// 9.3.1 review of the parked-guild upload: a runs-only upload vouches only with characters the device already reported
// (never new ones), and the addon ages out old parked runs and says so once.

const candidate: ServerCandidate = { guildId: "g1", discordId: "111111111", serverName: "Other Guild", officerLinked: true };
const device: DeviceRow = { id: "d1", guildId: null, chosenGuildId: null, claimedMemberId: null, revokedAt: null, uploads: 0 };
const now = new Date("2026-11-13T12:00:00Z");
const start = Math.floor(now.getTime() / 1000) - 7200;
const run = (id: string, character: string) => ({ id, protocolVersion: 1, state: "COMPLETED", instanceId: 90, name: "Gnomeregan", difficultyId: 0,
  startedAt: start, endedAt: start + 2700, reporters: 1, completedBy: "final boss", encounters: [],
  players: [character, "Amy"].map((name) => ({ character: name, realm: "Forever", deaths: 0, presentSec: 2700 })) });

function store(reported: string[]) {
  const importRuns = vi.fn(async (_guildId: string, runs: unknown[]) => ({ stored: runs.length, skipped: 0 }));
  const saveUpload = vi.fn(async () => undefined);
  const s = { async create() { return { id: "d1" }; }, async find() { return device; }, async candidates() { return [candidate]; },
    async characterKeys() { return reported; }, async claim() { return false; }, saveUpload, importRuns } as unknown as DeviceStore;
  return { s, importRuns, saveUpload };
}
const body = (character: string) => ({ runsOnly: true, guild: { name: "Other Guild", realm: "R" }, characters: [{ name: character }], dungeonRuns: [run("P1", character)] });

describe("a runs-only upload vouches only with characters the device already reported", () => {
  it("never adds a character, and a name the device never reported does not vouch", async () => {
    const stranger = store(["kev"]);
    await handleDeviceUpload(stranger.s, device, body("Zed"), { now });
    expect(stranger.importRuns).not.toHaveBeenCalled();
    expect(stranger.saveUpload).not.toHaveBeenCalled();
    const own = store(["zed"]);
    await handleDeviceUpload(own.s, device, body("Zed"), { now });
    expect(own.importRuns).toHaveBeenCalledTimes(1);
    expect(own.saveUpload).not.toHaveBeenCalled();
  });
});

let session: LuaSession;
afterEach(() => session?.close());

describe("old parked runs", () => {
  it("are removed, with one neutral line in chat", () => {
    session = newLuaSession();
    session.run(`NS = {}; GuildedDB = nil; C_Timer = { After = function() end, NewTicker = function() return {} end }`);
    for (const file of ["Core.lua", "Locale.lua", "DungeonRoutes.lua", "Compat.lua", "Modules/Dungeon.lua"]) session.load(file);
    session.run(`fire_event("PLAYER_LOGIN"); STAMP = 1800000000; NS.compat.serverTime = function() return STAMP end
      GuildedDB.otherGuilds = { ["Other-Realm"] = { dungeon = { runs = {
        old = { id = "old", endedAt = STAMP - 60 * 86400 }, fresh = { id = "fresh", endedAt = STAMP - 2 * 86400 },
        oldSynced = { id = "oldSynced", endedAt = STAMP - 40 * 86400, synced = true } } } } }
      NS.dungeon.markSynced()`);
    const left = session.run(`local out = {}; for id in pairs(GuildedDB.otherGuilds["Other-Realm"].dungeon.runs) do out[#out + 1] = id end; table.sort(out); return table.concat(out, ",")`);
    expect(left).toBe("fresh");
    const text = session.chat().join("\n");
    expect(text).toContain("could no longer be sent");
    expect(text).not.toMatch(/\d+ days/);
  });
});
