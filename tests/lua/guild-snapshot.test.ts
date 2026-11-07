import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

// 8.5: Modules/GuildSnapshot.lua saves what the game's guild roster shows about EVERY member
// (with or without the addon), plus the MOTD and info text, for the companion to upload.
let s: LuaSession | undefined;
afterEach(() => { s?.close(); s = undefined; });

function setup() {
  s = newLuaSession();
  s.run(`CLOCK = 1800000000; SHOW_OFFLINE = true
    function GetServerTime() return CLOCK end
    ROSTER = {
      { "Dude Lebowski", "Member", 3, 12, "Warrior", "Elwynn", "public note", "officer note", false, 0, "WARRIOR" },
      { "Walter Sobchak", "Officer", 1, 30, "Paladin", "Stormwind", "", "", true, 0, "PALADIN" },
      { "Bad|Name", "Member", 3, 5, "Rogue", "", "", "", false, 0, "ROGUE" }
    }
    function GetNumGuildMembers() return #ROSTER, 1, 1 end
    function GetGuildRosterInfo(i) return unpack(ROSTER[i]) end
    function GetGuildRosterLastOnline(i) if i == 1 then return 0, 0, 2, 5 end return nil end
    function GetGuildRosterShowOffline() return SHOW_OFFLINE end
    function GetGuildRosterMOTD() return "Raid Friday 8 pm" end
    function GetGuildInfoText() return "Be kind.\\nRaid rules in Discord." end
    DB = {}
    NS = { getDb = function() return DB end, isSecret = function() return false end,
      normalizeName = function(n) if type(n) ~= "string" or n:find("|", 1, true) then return nil end return n end }`);
  s.load("Modules/GuildSnapshot.lua");
  return s;
}
const value = (expr: string) => s!.run(`return tostring(${expr})`);

describe("GuildSnapshot.lua", () => {
  it("files every member under the full Forever name, with the real resolver", () => {
    s = newLuaSession();
    s.run(`function GetServerTime() return 1800000000 end
      ROSTER = { { "lebowski holyroller-OtherSegment", "Member", 3, 20, "Priest", "", "", "", false, 0, "PRIEST" },
        { "Lebowski Greenleaf", "Member", 3, 15, "Druid", "", "", "", false, 0, "DRUID" } }
      function GetNumGuildMembers() return #ROSTER, 1, 1 end
      function GetGuildRosterInfo(i) return unpack(ROSTER[i]) end
      GuildedDB = {} NS = {}`);
    s.load("Core.lua");
    s.load("Modules/GuildSnapshot.lua");
    s.run(`fire_event("PLAYER_LOGIN"); NS.guildSnapshot.read(true)`);
    expect(s.run(`local out = {} for key in pairs(GuildedDB.guildSnapshot.members) do out[#out + 1] = key end table.sort(out) return table.concat(out, "|")`))
      .toBe("Lebowski Greenleaf|Lebowski Holyroller");
  });

  it("keeps every member's level, class, rank and last online, but never notes", () => {
    const lua = setup();
    lua.run(`fire_event("GUILD_ROSTER_UPDATE")`);
    expect(value(`DB.guildSnapshot.members["Dude Lebowski"].level`)).toBe("12");
    expect(value(`DB.guildSnapshot.members["Dude Lebowski"].class`)).toBe("WARRIOR");
    expect(value(`DB.guildSnapshot.members["Dude Lebowski"].rankIndex`)).toBe("3");
    expect(value(`DB.guildSnapshot.members["Dude Lebowski"].lastOnline`)).toBe(String(1800000000 - (2 * 24 + 5) * 3600));
    expect(value(`DB.guildSnapshot.members["Walter Sobchak"].lastOnline`)).toBe("1800000000"); // online now
    expect(value(`DB.guildSnapshot.members["Bad|Name"]`)).toBe("nil");
    expect(lua.run(`local out = {} for _, m in pairs(DB.guildSnapshot.members) do for k, v in pairs(m) do out[#out + 1] = tostring(v) end end return table.concat(out, ",")`)).not.toContain("note");
    expect(value(`DB.guildSnapshot.complete`)).toBe("true");
    expect(value(`DB.guildSnapshot.motd`)).toBe("Raid Friday 8 pm");
    expect(value(`DB.guildSnapshot.info`)).toBe("Be kind. Raid rules in Discord.");
  });

  it("reads at most once a minute, and says when offline members were hidden", () => {
    const lua = setup();
    lua.run(`fire_event("GUILD_ROSTER_UPDATE")`);
    lua.run(`ROSTER[1][4] = 13; CLOCK = CLOCK + 30; fire_event("GUILD_ROSTER_UPDATE")`);
    expect(value(`DB.guildSnapshot.members["Dude Lebowski"].level`)).toBe("12");
    lua.run(`CLOCK = CLOCK + 31; SHOW_OFFLINE = false; fire_event("GUILD_ROSTER_UPDATE")`);
    expect(value(`DB.guildSnapshot.members["Dude Lebowski"].level`)).toBe("13");
    expect(value(`DB.guildSnapshot.complete`)).toBe("false");
  });
});
