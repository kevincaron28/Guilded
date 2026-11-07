import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";
import { parseCharacterString } from "../../src/services/character-import.js";

let session: LuaSession | undefined;
afterEach(() => session?.close());
function client(build = 16001) {
  session = newLuaSession();
  session.run(`NS = {}; GuildedDB = { epgp = { Halidor = { ep = 100, gp = 40, ledger = {} } } }
    GetBuildInfo = function() return "test", "1", "date", ${build} end
    UnitName = function() return "Halidor", "Galemorne" end
    GetUnitName = function() return "Halidor Galemorne" end`);
  session.load("Core.lua");
  session.run('fire_event("PLAYER_LOGIN")');
  return session;
}
describe("Forever characters are keyed by their full name (8.5)", () => {
  it("keeps same-named party members on separate realms and falls back for local units", () => {
    const s = client(120105);
    s.run(`GetNormalizedRealmName = function() return "Area52" end
      UnitFullName = function(unit) return "Amy", unit == "party1" and "Illidan" or "" end
      IsInGroup = function() return true end
      IsInRaid = function() return false end`);
    expect(s.run('return NS.util.unitKey("party1")')).toBe("Amy-illidan");
    expect(s.run('return NS.util.unitKey("player")')).toBe("Amy-area52");
    expect(s.run('return tostring(NS.util.inMyGroup("Amy-illidan"))')).toBe("true");
    expect(s.run('return tostring(NS.util.inMyGroup("Amy-other"))')).toBe("false");
    s.run('issecretvalue=function(value) return value == "HIDDEN_REALM" end');
    expect(s.run('return tostring(NS.util.characterKey("Amy","HIDDEN_REALM"))')).toBe("nil");
  });
  it("captures both names, keys by the full name, and moves the old first-name points once the roster loads", () => {
    const s = client();
    expect(s.run('return GuildedDB.character.displayName')).toBe("Halidor Galemorne");
    expect(s.run('return GuildedDB.character.name')).toBe("Halidor Galemorne");
    expect(s.run('return NS.playerName()')).toBe("Halidor Galemorne");
    expect(s.run('return NS.displayName("Halidor")')).toBe("Halidor Galemorne");
    // Points stay under the old key until the roster proves only one Halidor is in the guild.
    expect(s.run('return tostring(GuildedDB.epgp.Halidor.ep)')).toBe("100");
    s.run(`GetNumGuildMembers = function() return 2 end
      GetGuildRosterInfo = function(i) if i == 1 then return "Halidor Galemorne", "Officer", 1 end return "Dude Lebowski", "Member", 3 end
      fire_event("GUILD_ROSTER_UPDATE")`);
    expect(s.run('return tostring(GuildedDB.epgp["Halidor Galemorne"].ep) .. ":" .. tostring(GuildedDB.epgp["Halidor Galemorne"].gp)')).toBe("100:40");
    expect(s.run('return tostring(GuildedDB.epgp.Halidor)')).toBe("nil");
  });
  it.each([11508, 50500, 120105])("does not turn the realm into a surname on interface %i", build => {
    const s = client(build);
    expect(s.run('return GuildedDB.character.displayName')).toBe("Halidor");
    s.run('GuildedDB.displayNames = { Halidor = "Halidor Galemorne" }');
    expect(s.run('return NS.displayName("Halidor")')).toBe("Halidor");
  });
  it.each([[16001, "forever"], [11509, "unknown"], [120105, "unknown"]] as const)("captures client provenance for interface %i", (build, edition) => {
    const s = client(build);
    expect(s.run('return GuildedDB.character.gameEdition')).toBe(edition);
    expect(s.run('return GuildedDB.character.interface')).toBe(String(build));
  });
  it("uses the observed surname API when GetUnitName is unavailable", () => {
    const s = client();
    s.run('GetUnitName = nil');
    expect(s.run('return NS.util.unitDisplayName("player")')).toBe("Halidor Galemorne");
    s.run('UnitName = function() return "Halidor" end');
    expect(s.run('return NS.util.unitDisplayName("player")')).toBe("Halidor");
  });
  it("remembers guildmate full names without changing whisper addresses or keys", () => {
    const s = client();
    s.run('NS.util.rememberAddress("Highpriest Cheech")');
    expect(s.run('return NS.displayName("Highpriest")')).toBe("Highpriest Cheech");
    expect(s.run('return NS.util.address("Highpriest")')).toBe("Highpriest Cheech");
    expect(s.run('return NS.normalizeName("Highpriest Cheech")')).toBe("Highpriest Cheech");
    expect(s.run('return NS.normalizeName("highpriest cheech-Realm")')).toBe("Highpriest Cheech");
    s.run('NS.util.rememberDisplayName("Highpriest |Hbad")');
    expect(s.run('return NS.displayName("Highpriest")')).toBe("Highpriest Cheech");
  });
  it("round-trips the optional display name in character import codes", () => {
    const parsed = parseCharacterString("QG2;Halidor;Forever;WARRIOR;Human;60;;;Halidor Galemorne");
    expect(parsed).toMatchObject({ name: "Halidor", displayName: "Halidor Galemorne" });
    expect(parseCharacterString("QG2;Halidor;Realm;WARRIOR;Human;60;;").displayName).toBeUndefined();
  });
});
