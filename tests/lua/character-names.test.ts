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
describe("Forever display names without changing accounting identity", () => {
  it("captures both names and preserves the existing key and points", () => {
    const s = client();
    expect(s.run('return GuildedDB.character.displayName')).toBe("Halidor Galemorne");
    expect(s.run('return GuildedDB.character.name')).toBe("Halidor");
    expect(s.run('return NS.displayName("Halidor")')).toBe("Halidor Galemorne");
    expect(s.run('return tostring(GuildedDB.epgp.Halidor.ep) .. ":" .. tostring(GuildedDB.epgp.Halidor.gp)')).toBe("100:40");
    expect(s.run('return tostring(GuildedDB.epgp["Halidor Galemorne"])')).toBe("nil");
  });
  it.each([11508, 50500, 120105])("does not turn the realm into a surname on interface %i", build => {
    const s = client(build);
    expect(s.run('return GuildedDB.character.displayName')).toBe("Halidor");
    s.run('GuildedDB.displayNames = { Halidor = "Halidor Galemorne" }');
    expect(s.run('return NS.displayName("Halidor")')).toBe("Halidor");
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
    expect(s.run('return NS.normalizeName("Highpriest Cheech")')).toBe("Highpriest");
    s.run('NS.util.rememberDisplayName("Highpriest |Hbad")');
    expect(s.run('return NS.displayName("Highpriest")')).toBe("Highpriest Cheech");
  });
  it("round-trips the optional display name in character import codes", () => {
    const parsed = parseCharacterString("QG2;Halidor;Forever;WARRIOR;Human;60;;;Halidor Galemorne");
    expect(parsed).toMatchObject({ name: "Halidor", displayName: "Halidor Galemorne" });
    expect(parseCharacterString("QG2;Halidor;Realm;WARRIOR;Human;60;;").displayName).toBeUndefined();
  });
});
