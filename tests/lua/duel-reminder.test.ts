import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

// The /reload reminder is for this player's own duels only, never for duels learned from a guildmate.
let s: LuaSession | undefined;
afterEach(() => s?.close());

describe("duel reload reminder", () => {
  it("fires for the player's own duel and not for two other players' duel", () => {
    s = newLuaSession();
    s.run(`DB = { roster = {} }; SETTINGS = {}; CLOCK = 1800000000; CALLS = 0
      function GetServerTime() return CLOCK end
      function GetTime() return 100 end
      function GetLocale() return "enUS" end
      function UnitName() return "Aldric" end
      function IsInGuild() return true end
      function GetNumGuildMembers() return 0 end
      NS = { getDb = function() return DB end, getSettings = function() return SETTINGS end, util = {}, commandHandlers = {}, commandHelp = {},
        message = function() end, isSecret = function() return false end, isGuildMember = function() return true end,
        syncNow = { mark = function() end, noteResult = function() CALLS = CALLS + 1 end } }`);
    s.load("Locale.lua");
    s.load("Modules/Duels.lua");
    s.run(`NS.duels.record("Brenna Vale", "Corwin Hale", CLOCK - 100, "knockout")`);
    expect(s.run("return CALLS")).toBe("0");
    s.run(`NS.duels.record("Aldric", "Corwin Hale", CLOCK - 50, "knockout")`);
    expect(s.run("return CALLS")).toBe("1");
  });
});
