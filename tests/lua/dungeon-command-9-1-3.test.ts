import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

// 9.1.3 (real-client report on a French client, Guilded 9.1.2 next to GuildedDungeons 9.1.0): /guilded dungeon
// printed nothing. The command now always answers, says when it fails, and notes mixed versions once.
const CLOCK = 1800000000;
let s: LuaSession;
afterEach(() => s?.close());

function start(language = "frFR", other: string | null = "9.1.0") {
  s = newLuaSession();
  s.run(`NS = {}; GuildedDB = nil; CLOCK = ${CLOCK}; function GetLocale() return "${language}" end
    C_Timer = { After = function() end, NewTicker = function() return {} end }
    C_AddOns = { GetAddOnMetadata = function(name, field)
      if field ~= "Version" then return nil end
      if name == "GuildedDungeons" then return ${other === null ? "nil" : `"${other}"`} end
      return "9.1.2"
    end, IsAddOnLoaded = function() return true end }`);
  for (const file of ["Core.lua", "Locale.lua", "DungeonRoutes.lua", "Compat.lua", "Modules/Dungeon.lua", "Modules/RunResults.lua"]) s.load(file);
  s.run(`fire_event("PLAYER_LOGIN"); NS.compat.serverTime = function() return CLOCK end
    NS.dungeon.loadedAt = CLOCK; GuildedDB.dungeon.lastSaveAt = CLOCK - 1000
    local runs = NS.dungeon.savedRuns()
    for i = 1, 3 do runs["r" .. i] = { id = "r" .. i, state = "COMPLETED", endedAt = CLOCK - 9000, players = {} } end`);
  s.chat();
  return s;
}
const say = () => s.chat().join("\n");

describe("/guilded dungeon", () => {
  it("prints on a French client with an older Guilded Dungeons next to Guilded", () => {
    start();
    s.run(`SlashCmdList["GUILDED"]("dungeon")`);
    const text = say();
    expect(text).toContain("Aucun donjon en cours. Donjons enregistrés : 3 (3 en attente d'envoi vers Discord).");
    expect(text).toContain("Synchroniser avec Discord en 3 étapes");
    expect(text).toContain("Guilded Dungeons 9.1.0 est installé à côté de Guilded 9.1.2.");
  });

  it("names a version mismatch once per version, never when the versions match or the addon is absent", () => {
    start();
    s.run(`SlashCmdList["GUILDED"]("dungeon"); SlashCmdList["GUILDED"]("dungeon")`);
    expect((say().match(/est installé à côté/g) ?? []).length).toBe(1);
    start("enUS", "9.1.2");
    s.run(`SlashCmdList["GUILDED"]("dungeon")`);
    expect(say()).not.toContain("installed next to");
    start("enUS", null);
    s.run(`SlashCmdList["GUILDED"]("dungeon")`);
    expect(say()).toContain("Saved runs: 3 (3 waiting to reach Discord).");
    expect(say()).not.toContain("installed next to");
  });

  it("says why when the dungeon data is not there, instead of staying silent", () => {
    start("enUS", null);
    s.run(`NS.getDb = function() return nil end`);
    s.run(`NS.commandHandlers.dungeon({})`);
    expect(say()).toContain("Dungeon data is not loaded yet.");
  });

  it("says so when the command itself fails, and keeps the error in the diagnostics", () => {
    start("enUS", null);
    s.run(`NS.dungeon.waitingRuns = function() error("boom") end
      NS.commandHandlers.dungeon({})`);
    expect(say()).toContain("The dungeon command failed. /guilded diag shows the details.");
    expect(s.run(`local d = GuildedDB.diagnostics or {}; return tostring(#d > 0 and d[#d].detail or "")`)).toContain("boom");
  });

  it("answers in French when it fails", () => {
    start("frFR", null);
    s.run(`NS.dungeon.waitingRuns = function() error("boom") end
      NS.commandHandlers.dungeon({})`);
    expect(say()).toContain("La commande de donjon a échoué.");
  });
});

describe("French on the character page and /guilded companion", () => {
  it("translates the readiness notes and uses 'vous' in the companion line", () => {
    start();
    const french = (text: string) => s.run(`return NS.L(${JSON.stringify(text)})`);
    expect(french("No off-hand item equipped (expected when using a two-handed weapon).")).toBe("Aucun objet en main gauche (normal avec une arme à deux mains).");
    expect(s.run(`return string.format(NS.L("Empty slots (normal while levelling): %s."), "Head, Neck")`)).toBe("Emplacements vides (normal en montant de niveau) : Head, Neck.");
    const line = french("Guilded companion (Windows): sends your data to Discord and brings standings, raids and signups into the game.");
    expect(line).toContain("vos données");
    expect(line).not.toMatch(/\btes\b|\bton\b|\bta\b/);
  });
});

describe("/gdungeons with Guilded alone", () => {
  it("answers (and /gdg too) instead of WoW's unknown-command line, in French", () => {
    start("frFR", null);
    s.run(`SlashCmdList["GUILDEDDUNGEONS"]("status")`);
    expect(say()).toContain("Aucun donjon en cours.");
    expect(s.run(`return SLASH_GUILDEDDUNGEONS1 .. " " .. SLASH_GUILDEDDUNGEONS2`)).toBe("/gdungeons /gdg");
  });
});
