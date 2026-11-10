import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";
import { PROFESSION_IDENTITIES } from "../../src/services/profession-names.js";

// 9 November 2026 (owner report): a French client says "Cuisine", an English one "Cooking", and Guilded kept
// them as two professions in the tooltip, the recipe book and Discord. Util.lua now gives every profession one
// identity: the English name, by skill line id when the game gives it, else from any client's name.
let session: LuaSession | undefined;
afterEach(() => { session?.close(); session = undefined; });

// The test harness measures a Lua source string in UTF-16 units, so non-ASCII text goes in as byte escapes.
const lua = (text: string) => `"${Array.from(Buffer.from(text, "utf8")).map(b => b < 128 && b !== 34 && b !== 92 ? String.fromCharCode(b) : `\\${String(b).padStart(3, "0")}`).join("")}"`;

function util(): LuaSession {
  session = newLuaSession();
  session.run("NS = {}");
  session.load("Util.lua");
  return session;
}

describe("Util.lua profession names", () => {
  it("maps every client language's name and every skill line to the same canonical name (the bot's table)", () => {
    const s = util();
    for (const [canonical, identity] of Object.entries(PROFESSION_IDENTITIES)) {
      expect(s.run(`return tostring(NS.util.professionKey(nil, ${identity.skillLine}))`)).toBe(canonical);
      for (const names of Object.values(identity.names)) {
        for (const name of names) {
          expect(s.run(`return tostring(NS.util.professionKey(${lua(name)}))`), name).toBe(canonical);
          expect(s.run(`return tostring(NS.util.professionName(${lua(` ${name.replace(/[A-Z]/g, c => c.toLowerCase())} `)}))`), name).toBe(canonical);
        }
      }
    }
  });

  it("keeps a name it does not know, and joins Cooking and Cuisine", () => {
    const s = util();
    expect(s.run(`return NS.util.professionName("Lockpicking")`)).toBe("Lockpicking");
    expect(s.run(`return tostring(NS.util.professionKey("Lockpicking"))`)).toBe("nil");
    expect(s.run(`return NS.util.professionName("Cuisine")`)).toBe("Cooking");
    expect(s.run(`return NS.util.professionName("Whatever", 185)`)).toBe("Cooking");
    expect(s.run(`return NS.util.professionSkillText(${lua("Cuisine:300,Cooking:150,Pêche:75,Secourisme:20")})`)).toBe("Cooking:300,Fishing:75,First Aid:20");
  });

  it("rewrites older saved data once: recipe book, cooldowns and guildmates' digests", () => {
    const s = util();
    s.run(`DB = {
      recipeBook = {
        people = { Amy = { Cuisine = { v = 5, keys = { 1, 2 } }, Cooking = { v = 9, keys = { 3 } }, Alchemy = { v = 4, keys = { 7 } }, ["Pêche"] = { v = 2, keys = { 8 } } } },
        cooldowns = { Amy = { { prof = "Alchimie", name = "Transmute", readyAt = 5 }, { prof = "Alchemy", name = "Other", readyAt = 6 } } }
      },
      peerRoster = { Bob = { professions = ${lua("Cuisine:300,Cooking:225,Forge:150")} }, Cy = { professions = "Mining:75" } }
    }`);
    expect(s.run("return tostring(NS.util.normalizeProfessionData(DB))")).toBe("true");
    // The newest copy of a duplicated profession wins; nothing is lost.
    expect(s.run("return DB.recipeBook.people.Amy.Cooking.v .. ':' .. DB.recipeBook.people.Amy.Cooking.keys[1]")).toBe("9:3");
    expect(s.run("return tostring(DB.recipeBook.people.Amy.Cuisine)")).toBe("nil");
    expect(s.run("return tostring(DB.recipeBook.people.Amy.Alchemy.v) .. tostring(DB.recipeBook.people.Amy.Fishing.v)")).toBe("42");
    expect(s.run("return DB.recipeBook.cooldowns.Amy[1].prof .. ',' .. DB.recipeBook.cooldowns.Amy[2].prof")).toBe("Alchemy,Alchemy");
    expect(s.run("return DB.peerRoster.Bob.professions")).toBe("Cooking:300,Blacksmithing:150");
    expect(s.run("return DB.peerRoster.Cy.professions")).toBe("Mining:75");
    // Already canonical: a second run changes nothing.
    expect(s.run("return tostring(NS.util.normalizeProfessionData(DB))")).toBe("false");
    expect(s.run("return tostring(NS.util.normalizeProfessionData(nil))")).toBe("false");
  });
});

describe("a French and an English client are one profession everywhere", () => {
  it("collects the English name from the skill line id on a French client", () => {
    session = newLuaSession();
    session.run(String.raw`
      NS = {}; GuildedDB = nil
      function GetProfessions() return 1, 2 end
      function GetProfessionInfo(i)
        if i == 1 then return ${lua("Cuisine")}, "icon", 150, 300, 0, 0, 185 end
        return ${lua("Pêche")}, "icon", 75, 300, 0, 0 end -- an older client without the skill line id: by name
    `);
    session.load("Core.lua");
    session.run('fire_event("PLAYER_LOGIN")');
    const names = session.run('local t = {}; for _, p in ipairs(NS.collectProfessions()) do t[#t + 1] = p.name .. ":" .. p.skillLevel end; return table.concat(t, ",")');
    expect(names).toBe("Cooking:150,Fishing:75");
  });

  it("stores a French guildmate's Cuisine recipes and an English one's Cooking recipes under one profession", () => {
    session = newLuaSession();
    const s = session;
    s.run(String.raw`
      SENT = {}
      function IsInGuild() return true end
      C_Timer = { After = function(delay, fn) fn() end }
      C_ChatInfo = { SendAddonMessage = function(_, text, ch) SENT[#SENT + 1] = ch .. ":" .. text end, RegisterAddonMessagePrefix = function() return true end }
      DB = {}
      NOW = 1800000000
      function GetServerTime() return NOW end
      function GetTime() return NOW end
      NS = { L = function(t) return t end, isSecret = function() return false end,
        normalizeName = function(n) if not n then return nil end return (string.gsub(n, "%-.*", "")) end,
        playerName = function() return "Ray" end, message = function() end, getDb = function() return DB end, commandHandlers = {}, commandHelp = {} }
    `);
    s.load("Modules/Recipes.lua");
    const receive = (from: string, text: string) => s.run(`fire_event("CHAT_MSG_ADDON", "GuildedRcp", ${lua(text)}, "GUILD", ${lua(from)})`);
    receive("Amelie", "R|Cuisine|100|1|1|555");
    receive("Bob", "R|Cooking|101|1|1|555");
    receive("Amelie", "CD|Cuisine|1800086400|Pot");
    expect(s.run("local t = {}; for p in pairs(DB.recipeBook.people.Amelie) do t[#t + 1] = p end; return table.concat(t, ',')")).toBe("Cooking");
    const crafters = s.run("local t = {}; for _, c in ipairs(NS.recipes.crafters(555)) do t[#t + 1] = c.name .. '=' .. c.profession end; table.sort(t); return table.concat(t, ',')");
    expect(crafters).toBe("Amelie=Cooking,Bob=Cooking");
    expect(s.run("return DB.recipeBook.cooldowns.Amelie[1].prof")).toBe("Cooking");
  });

  it("shows the profession in the player's own language (Locale.lua) while storing English", () => {
    for (const [language, expected] of [["fr", "Cuisine"], ["en", "Cooking"], ["de", "Kochkunst"], ["es", "Cocina"]] as const) {
      session = newLuaSession();
      session.run(`NS = {}; function GetLocale() return "enUS" end; NS.getSettings = function() return { language = "${language}" } end`);
      session.load("Util.lua");
      session.load("Locale.lua");
      expect(session.run('return NS.util.professionLabel("Cooking")')).toBe(expected);
      expect(session.run(`return NS.util.professionLabel(${lua("Cuisine")})`)).toBe(expected);
      expect(session.run('return NS.util.professionLabel("Lockpicking")')).toBe("Lockpicking");
      session.close();
    }
    session = undefined;
  });
});
