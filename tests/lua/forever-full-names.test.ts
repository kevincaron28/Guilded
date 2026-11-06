import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

// WoW Forever, 8.5: alts sharing a first name ("Lebowski Holyroller", "Lebowski Greenleaf") are
// separate characters everywhere, and saved data keyed by first name moves only when unambiguous.
let s: LuaSession | undefined;
afterEach(() => { s?.close(); s = undefined; });

function client(surname: string, saved: string, roster: string[]) {
  s = newLuaSession();
  // fengari's os.date has no "!" (UTC) form; the game's date does.
  s.run(`local od = os.date; date = function(f, t) if type(f) == "string" and f:sub(1, 1) == "!" then return od(f:sub(2), t) end return od(f, t) end
    NS = {}; GuildedDB = ${saved}
    UnitName = function() return "Lebowski", "${surname}" end
    GetUnitName = function() return "Lebowski ${surname}" end
    ROSTER = { ${roster.map((name) => JSON.stringify(name)).join(", ")} }
    GetNumGuildMembers = function() return #ROSTER end
    GetGuildRosterInfo = function(i) return ROSTER[i], "Member", 3 end`);
  s.load("Core.lua");
  s.run(`fire_event("PLAYER_LOGIN")`);
  return s;
}
const roster = () => s!.run(`fire_event("GUILD_ROSTER_UPDATE")`);
const value = (expr: string) => s!.run(`return tostring(${expr})`);

describe("Forever alts sharing a first name", () => {
  it("each alt is its own character on the same PC", () => {
    const lua = client("Holyroller", "nil", ["Lebowski Holyroller", "Lebowski Greenleaf"]);
    expect(lua.run(`return NS.playerName()`)).toBe("Lebowski Holyroller");
    lua.run(`UnitName = function() return "Lebowski", "Greenleaf" end; GetUnitName = function() return "Lebowski Greenleaf" end`);
    expect(lua.run(`return NS.playerName()`)).toBe("Lebowski Greenleaf");
    expect(value(`NS.normalizeName("Lebowski Holyroller") ~= NS.normalizeName("Lebowski Greenleaf")`)).toBe("true");
    roster();
    // A bare first name is ambiguous in this guild and is never guessed.
    expect(lua.run(`return NS.normalizeName("Lebowski")`)).toBe("Lebowski");
    expect(lua.run(`return NS.util.address("Lebowski Greenleaf")`)).toBe("Lebowski Greenleaf");
  });

  it("keeps an ambiguous first-name EP/GP account untouched and lists it for an officer", () => {
    const lua = client("Holyroller", `{ epgp = { Lebowski = { ep = 500, gp = 20, ledger = {} } }, roster = { Lebowski = { firstSeen = "2026-10-01T00:00:00Z", inGuild = true } } }`,
      ["Lebowski Holyroller", "Lebowski Greenleaf", "Dude Lebowski"]);
    roster();
    expect(value(`GuildedDB.epgp.Lebowski.ep`)).toBe("500");
    expect(value(`GuildedDB.epgp["Lebowski Holyroller"]`)).toBe("nil");
    expect(value(`GuildedDB.nameMigration.flagged["epgp:Lebowski"].reason`)).toBe("shared first name");
    lua.run(`NS.commandHandlers.names({})`);
    const text = lua.chat().join("\n");
    expect(text).toContain("epgp Lebowski -> Lebowski Greenleaf / Lebowski Holyroller (shared first name)");
    // The old roster row is not merged into either alt, and nothing is deleted.
    expect(value(`GuildedDB.roster.Lebowski ~= nil`)).toBe("true");
  });

  it("moves first-name keys to the only full name the roster knows, keeping the earliest sighting", () => {
    client("Holyroller", `{ epgp = { Lebowski = { ep = 500, gp = 20, ledger = {} }, Walter = { ep = 1, gp = 0, ledger = {} } },
      roster = { Lebowski = { firstSeen = "2026-10-01T00:00:00Z", joinedAt = "2026-10-01T00:00:00Z", inGuild = true, note = "old" } },
      peerRoster = { Lebowski = { professions = "Mining:10", seenAt = 1 } }, settings = { officers = { Lebowski = true } } }`,
      ["Lebowski Holyroller", "Dude Lebowski"]);
    roster();
    expect(value(`GuildedDB.epgp["Lebowski Holyroller"].ep`)).toBe("500");
    expect(value(`GuildedDB.epgp.Lebowski`)).toBe("nil");
    expect(value(`GuildedDB.roster["Lebowski Holyroller"].firstSeen`)).toBe("2026-10-01T00:00:00Z");
    expect(value(`GuildedDB.roster["Lebowski Holyroller"].note`)).toBe("old");
    expect(value(`GuildedDB.roster.Lebowski`)).toBe("nil");
    expect(value(`GuildedDB.peerRoster["Lebowski Holyroller"].professions`)).toBe("Mining:10");
    expect(value(`GuildedDB.settings.officers["Lebowski Holyroller"]`)).toBe("true");
    // Someone the roster does not know stays as they were.
    expect(value(`GuildedDB.epgp.Walter.ep`)).toBe("1");
    expect(value(`next(GuildedDB.nameMigration.flagged)`)).toBe("nil");
  });

  it("an EP/GP account under both keys is never merged: listed instead", () => {
    const lua = client("Holyroller", `{ epgp = { Lebowski = { ep = 500, gp = 0, ledger = {} }, ["Lebowski Holyroller"] = { ep = 7, gp = 0, ledger = {} } } }`,
      ["Lebowski Holyroller"]);
    roster();
    expect(value(`GuildedDB.epgp.Lebowski.ep .. "/" .. GuildedDB.epgp["Lebowski Holyroller"].ep`)).toBe("500/7");
    expect(value(`GuildedDB.nameMigration.flagged["epgp:Lebowski"].reason`)).toBe("both");
    expect(lua.chat().join("\n")).not.toContain("error");
  });

  it("an older guildmate's digest (first name only) is kept under the sender's full name", () => {
    const lua = client("Holyroller", "nil", ["Lebowski Holyroller", "Donny Kerabatsos"]);
    roster();
    lua.run(`fire_event("CHAT_MSG_ADDON", "Guilded", "READINESS|Donny|READY|0|100|Bowling:300|I:WARRIOR,Human,30,", "GUILD", "Donny Kerabatsos")`);
    expect(value(`GuildedDB.peerRoster["Donny Kerabatsos"].identity.level`)).toBe("30");
    expect(value(`GuildedDB.peerRoster.Donny`)).toBe("nil");
    // Someone else's name is still refused.
    lua.run(`fire_event("CHAT_MSG_ADDON", "Guilded", "READINESS|Walter|READY|0|100|", "GUILD", "Donny Kerabatsos")`);
    expect(value(`GuildedDB.peerRoster.Walter`)).toBe("nil");
  });
});
