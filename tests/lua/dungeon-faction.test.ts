import { afterEach, describe, expect, it } from "vitest";
import { exportDungeonRuns } from "../../companion/lua-export-content.mjs";
import { newLuaSession, type LuaSession } from "./harness.js";

// 9.3.6: every party member's faction (Alliance or Horde, from UnitFactionGroup or the race) is recorded with the run, carried in the summary
// (field fa=), exported by the companion and read out of combat only.
let session: LuaSession;
afterEach(() => session?.close());

function start() {
  session = newLuaSession();
  session.run(`NS = {}; GuildedDB = nil; function GetLocale() return "enUS" end
    C_Timer = { After = function() end, NewTicker = function() return {} end }`);
  for (const file of ["Core.lua", "Locale.lua", "DungeonRoutes.lua", "Compat.lua", "Modules/Dungeon.lua"]) session.load(file);
  session.run(`    IN_COMBAT = false
    function InCombatLockdown() return IN_COMBAT end
    FACTIONS = { player = "Alliance", party1 = "Horde" }
    RACES = { party2 = "Scourge" }
    function UnitFactionGroup(unit) return FACTIONS[unit] end
    function UnitRace(unit) if RACES[unit] then return "Undead", RACES[unit] end end
    fire_event("PLAYER_LOGIN")
    GetBuildInfo = function() return "1.60.1", "70790", "date", 16001 end
    STAMP = 1800000000
    NS.compat.serverTime = function() return STAMP end
    NS.compat.instance = function() return {id=2971, type="party", name="The Test Dungeon", difficultyId=1} end
    MOCK_UNITS = { player = { name = "Tester" }, party1 = { name = "Friend" }, party2 = { name = "Zombie" }, party3 = { name = "Mystery" } }
    MOCK_GROUP_SIZE = 4
    NS.isGuildMember = function() return true end
    fire_event("PLAYER_ENTERING_WORLD")
    fire_event("PLAYER_REGEN_DISABLED")
    STAMP = STAMP + 600
    function IsInGroup() return true end
    fire_event("GROUP_ROSTER_UPDATE")`);
  session.chat();
  return session;
}

describe("player factions in a dungeon run", () => {
  it("records the faction the game reports, falls back to the race, and leaves an unknown one empty", () => {
    const s = start();
    const players = "GuildedDB.dungeon.current.players";
    expect(s.run(`return ${players}.Tester.faction`)).toBe("ALLIANCE");
    expect(s.run(`return ${players}.Friend.faction`)).toBe("HORDE");
    expect(s.run(`return ${players}.Zombie.faction`)).toBe("HORDE"); // from the race token "Scourge"
    expect(s.run(`return tostring(${players}.Mystery.faction)`)).toBe("nil");
  });
  it("does not read it in combat, and keeps the earlier answer", () => {
    const s = start();
    s.run(`IN_COMBAT = true; FACTIONS.party1 = "Alliance"; STAMP = STAMP + 30; fire_event("GROUP_ROSTER_UPDATE")`);
    expect(s.run("return GuildedDB.dungeon.current.players.Friend.faction")).toBe("HORDE");
    s.run(`IN_COMBAT = false; STAMP = STAMP + 30; fire_event("GROUP_ROSTER_UPDATE")`);
    expect(s.run("return GuildedDB.dungeon.current.players.Friend.faction")).toBe("ALLIANCE");
  });
  it("travels in the summary after the guild data, as ASCII, and a guildmate's copy has it", () => {
    const s = start();
    const summary = s.run("return NS.dungeon.serialize(GuildedDB.dungeon.current)");
    expect(summary).toContain(";fa=");
    expect(summary).toMatch(/;fa=[^;]*Tester:A/);
    expect(summary).toMatch(/;fa=[^;]*Friend:H/);
    // eslint-disable-next-line no-control-regex
    expect(/^[\x00-\x7f]*$/.test(summary.slice(summary.indexOf(";fa=")))).toBe(true);
    s.run(`PEER = NS.dungeon.deserialize("X", NS.dungeon.serialize(GuildedDB.dungeon.current))`);
    expect(s.run("return PEER.players.Friend.faction")).toBe("HORDE");
    expect(s.run("return PEER.players.Tester.faction")).toBe("ALLIANCE");
  });
  it("keeps guild and faction in the summary of a long dungeon (a 100-row timeline used to push them out)", () => {
    const s = start();
    s.run(`local run = GuildedDB.dungeon.current
      run.players.Tester.guild = "Quebec Gold"; run.players.Friend.guild = "Quebec Gold"
      run.players.Tester.level = 60; run.players.Tester.minLevel = 58; run.players.Friend.level = 60; run.players.Friend.minLevel = 59
      run.players.Tester.spec = "Fury"
      run.integrity = { version = 2, startWitness = "unknown", continuous = true, observer = "Tester", startTrigger = "x" }
      run.players.Tester.integrity = { knownSec = 100, unknownSec = 0, mixedRole = false, knownIntervals = { { 0, 100 } } }
      run.encounters = {}
      for i = 1, 100 do run.encounters[#run.encounters + 1] = { id = 1000 + i, kind = "npc", name = "A long creature name " .. i, success = true, at = 1800000000 + i, startedAt = 1800000000 + i - 5 } end
      LONG = NS.dungeon.serialize(run)`);
    expect(Number(s.run("return #LONG"))).toBeLessThanOrEqual(4000);
    expect(String(s.run("return tostring(LONG:find(';tl=', 1, true) ~= nil)"))).toBe("true");
    s.run(`PEER = NS.dungeon.deserialize("X", LONG)`);
    expect(s.run("return PEER.players.Friend.guild")).toBe("Quebec Gold");
    expect(s.run("return PEER.players.Friend.minLevel")).toBe("59");
    expect(s.run("return PEER.players.Tester.level")).toBe("60");
    expect(s.run("return PEER.players.Tester.spec")).toBe("Fury");
    expect(s.run("return PEER.players.Tester.integrity.knownSec")).toBe("100");
    expect(s.run("return PEER.players.Friend.faction")).toBe("HORDE");
    expect(s.run("return PEER.players.Tester.faction")).toBe("ALLIANCE");
  });
  it("is exported by the companion only as ALLIANCE or HORDE", () => {
    const run = (faction: unknown) => exportDungeonRuns({ dungeon: { runs: { A: { id: "A", state: "COMPLETED", startedAt: 1, endedAt: 2, instanceId: 1, name: "x", difficultyId: 1, players: { Kev: { class: "WARRIOR", faction, presentSec: 1 } }, encounters: [] } } }, displayNames: {} } as never, "forever") as { players: { faction?: string }[] }[];
    const first = (value: unknown) => run(value)[0]?.players[0]?.faction;
    expect(first("ALLIANCE")).toBe("ALLIANCE");
    expect(first("Neutral")).toBeUndefined();
    expect(first(undefined)).toBeUndefined();
  });
});
