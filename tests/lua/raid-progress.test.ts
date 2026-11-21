import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

// Raid progress (Modules/RaidProgress.lua): boss kills inside raid instances.
let s: LuaSession | undefined;
afterEach(() => s?.close());

function setup() {
  s = newLuaSession();
  s.run(`EPOCH = 1800000000; DB = {}; MSGS = {}
    function GetServerTime() return EPOCH end
    INSTANCE = { id = 9001, name = "Test Raid", type = "raid", difficultyId = 14, difficultyName = "Normal" }
    MEMBERS = {}
    for i = 1, 10 do MEMBERS[i] = { name = "Guildy" .. i, inGuild = true } end
    for i = 11, 12 do MEMBERS[i] = { name = "Pug" .. i, inGuild = false } end
    NS = { util = {}, commandHandlers = {}, commandHelp = {},
      message = function(text) MSGS[#MSGS + 1] = text end,
      isSecret = function(v) return v == "SECRET" end,
      playerName = function() return "Guildy1" end,
      getDb = function() return DB end,
      compat = { instance = function() return INSTANCE end, groupMembers = function() return MEMBERS end,
        registerEvent = function(frame, event) frame:RegisterEvent(event); return true end } }`);
  s.load("Locale.lua");
  s.load("Modules/RaidProgress.lua");
  return s;
}

describe("raid progress", () => {
  it("records a successful raid boss kill with the guild's part of the group and the pull time", () => {
    setup();
    s!.run(`fire_event("ENCOUNTER_START", 1234, "Boss One", 14, 12); EPOCH = EPOCH + 300
      fire_event("ENCOUNTER_END", 1234, "Boss One", 14, 12, 1)`);
    expect(s!.run(`local r = NS.raidProgress.list()[1]; return r.instance .. "|" .. r.boss .. "|" .. r.groupSize .. "|" .. r.guildCount .. "|" .. r.durationSec .. "|" .. tostring(r.first) .. "|" .. #r.guildNames`))
      .toBe("Test Raid|Boss One|12|10|300|true|10");
  });
  it("ignores wipes, dungeons, secret values and the duplicate BOSS_KILL of the same kill", () => {
    setup();
    s!.run(`fire_event("ENCOUNTER_END", 1, "Wipe", 14, 12, 0)`);
    s!.run(`INSTANCE.type = "party"; fire_event("ENCOUNTER_END", 2, "Dungeon boss", 1, 5, 1); INSTANCE.type = "raid"`);
    s!.run(`fire_event("ENCOUNTER_END", "SECRET", "x", 14, 12, 1)`);
    expect(s!.run(`return #NS.raidProgress.list()`)).toBe("0");
    s!.run(`fire_event("ENCOUNTER_END", 3, "Boss", 14, 12, 1); fire_event("BOSS_KILL", 3, "Boss")`);
    expect(s!.run(`return #NS.raidProgress.list()`)).toBe("1");
  });
  it("marks only the first kill of a boss and keeps rows in the saved variables", () => {
    setup();
    s!.run(`fire_event("ENCOUNTER_END", 3, "Boss", 14, 12, 1); EPOCH = EPOCH + 700; fire_event("ENCOUNTER_END", 3, "Boss", 14, 12, 1)`);
    expect(s!.run(`local f = 0; for _, r in pairs(DB.raidProgress.kills) do if r.first then f = f + 1 end end return f .. "/" .. #NS.raidProgress.list()`)).toBe("1/2");
  });
  it("drops kills older than 180 days and caps the stored rows", () => {
    setup();
    s!.run(`fire_event("ENCOUNTER_END", 3, "Old", 14, 12, 1); EPOCH = EPOCH + 181 * 86400; fire_event("ENCOUNTER_END", 4, "New", 14, 12, 1)`);
    expect(s!.run(`return #NS.raidProgress.list()`)).toBe("1");
  });
  it("answers /guilded raidprogress only when the member types it", () => {
    setup();
    s!.run(`NS.commandHandlers.raidprogress()`);
    expect(s!.run(`return #MSGS`)).toBe("1");
  });
});
