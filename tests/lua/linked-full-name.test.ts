import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

// Live finding, 6 November 2026: "Lebowski Holyroller" was linked on Discord, but Home said
// "Not linked to Discord yet": the saved standings (an 8.4.7 companion, or a guildmate's shared
// copy) still keyed the character by its first name. The 9.0 lookup takes the full name, or a
// first name nobody else in the guild shares (the bot's transitional rule).
let s: LuaSession | undefined;
afterEach(() => { s?.close(); s = undefined; });

function client(players: string, roster: string[] = ["Lebowski Holyroller", "Walter Sobchak"]) {
  s = newLuaSession();
  s.run(`NS = {}; GuildedDB = nil
    UnitName = function() return "Lebowski", "Holyroller" end
    GetUnitName = function() return "Lebowski Holyroller" end
    ROSTER = { ${roster.map((name) => JSON.stringify(name)).join(", ")} }
    GetNumGuildMembers = function() return #ROSTER end
    GetGuildRosterInfo = function(i) return ROSTER[i], "Member", 3 end`);
  s.load("Core.lua");
  s.load("Modules/Sync.lua");
  s.run(`fire_event("PLAYER_LOGIN"); fire_event("GUILD_ROSTER_UPDATE"); NS.util.resetFullNames()
    NS.getDb().standings = { updatedAt = "2026-11-06T10:00:00Z", baseGp = 0, players = ${players} }`);
  return s;
}
const linked = () => s!.run(`return tostring(NS.verifyStatus().linked)`);

describe("Home's link status with Forever full names", () => {
  it("finds the character under its full name", () => {
    client(`{ ["Lebowski Holyroller"] = { ep = 100, gp = 10 } }`);
    expect(linked()).toBe("true");
  });

  it("finds it under a first name from older standings, with its EP/GP", () => {
    const lua = client(`{ Lebowski = { ep = 100, gp = 10 }, Walter = { ep = 5, gp = 1 } }`);
    expect(linked()).toBe("true");
    expect(lua.run(`local row = NS.getStanding("Lebowski Holyroller"); return row.ep .. "/" .. row.gp`)).toBe("100/10");
  });

  it("does not guess when two guild members share the first name", () => {
    client(`{ Lebowski = { ep = 100, gp = 10 } }`, ["Lebowski Holyroller", "Lebowski Greenleaf"]);
    expect(linked()).toBe("false");
  });

  it("does not guess when the standings hold two characters with that first name", () => {
    client(`{ ["Lebowski Greenleaf"] = { ep = 1, gp = 1 }, Lebowski = { ep = 100, gp = 10 } }`);
    expect(linked()).toBe("false");
  });

  it("someone else's first name never matches", () => {
    client(`{ Walter = { ep = 5, gp = 1 } }`);
    expect(linked()).toBe("false");
  });
});
