import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

// 4.5 in game: the core followed by id, the price popup and /guilded price, guildmates'
// professions saved under their own name, the reminder for professions never read, and the
// list of characters that logged in on this PC.
let session: LuaSession | undefined;
afterEach(() => { session?.close(); session = undefined; });

function loggedIn(files: string[], setup = ""): LuaSession {
  session = newLuaSession();
  session.run(String.raw`
    GuildedDB = nil; NS = {}
    MOCK_UNITS = { player = { name = "Kev", buffs = {} } }
    ${setup}
  `);
  session.load("Core.lua");
  session.load("Compat.lua");
  for (const file of files) session.load(file);
  session.run(`fire_event("PLAYER_LOGIN")`);
  return session;
}

const slash = (s: LuaSession, line: string) => s.run(`SlashCmdList["GUILDED"](${JSON.stringify(line)})`);

describe("the raid core is followed by id", () => {
  it("a core picked in game still matches after it was renamed on Discord", () => {
    const s = loggedIn(["Locale.lua", "Modules/Sync.lua", "Modules/Loot.lua"]);
    s.run(`GuildedDB.lootRules = { cores = { { id = "c1", name = "Tuesday MC", mode = "PRIORITY", values = {}, players = {} } }, values = {} }`);
    slash(s, "core Tuesday MC");
    expect(s.run("return GuildedDB.settings.activeCore")).toBe("c1");
    s.run(`GuildedDB.lootRules.cores[1].name = "Molten Core Team"`);
    expect(s.run("return NS.loot.coreName() .. '|' .. NS.loot.mode()")).toBe("Molten Core Team|PRIORITY");
  });

  it("the next raid's core is found by id too", () => {
    const s = loggedIn(["Locale.lua", "Modules/Sync.lua", "Modules/Loot.lua"]);
    s.run(`GuildedDB.lootRules = { cores = { { id = "c1", name = "Renamed", mode = "COUNCIL", values = {}, players = {} } }, values = {} }`);
    s.run(`GuildedNextRaid = { core = "Old Name", coreId = "c1", players = {} }`);
    expect(s.run("return NS.loot.coreName() .. '|' .. NS.loot.mode()")).toBe("Renamed|COUNCIL");
  });
});

describe("item prices set in game", () => {
  function withPriority(): LuaSession {
    const s = loggedIn(["Locale.lua", "Modules/Sync.lua", "Modules/Loot.lua"], String.raw`
      StaticPopupDialogs = {}
      StaticPopup_Show = function(name, a, b, data) POPUP = { name = name, a = a, b = b, data = data } return {} end
    `);
    s.run(String.raw`
      GuildedDB.lootRules = { cores = { { id = "c1", name = "Tuesday MC", mode = "PRIORITY", values = {}, players = {} } }, values = {} }
      GuildedDB.settings.activeCore = "c1"
      STARTED = nil
      NS.council = { startPriority = function(item, price, seconds) STARTED = item .. "@" .. price end }
    `);
    return s;
  }

  it("/guilded drop asks for a price when the item has none, then starts it at that price", () => {
    const s = withPriority();
    slash(s, "drop |cffa335ee|Hitem:19019::|h[Thunderfury]|h|r");
    expect(s.run("return POPUP.name .. '|' .. POPUP.a .. '|' .. POPUP.b")).toBe("GUILDED_ITEM_PRICE|Thunderfury|Tuesday MC");
    s.run(`StaticPopupDialogs.GUILDED_ITEM_PRICE.OnAccept({ editBox = { GetText = function() return "250" end } }, POPUP.data)`);
    expect(s.run("return STARTED")).toContain("@250");
    const saved = s.run(`local p = GuildedDB.itemPrices["c1:thunderfury"]; return p.name .. "|" .. p.gp .. "|" .. p.core .. "|" .. tostring(p.id)`);
    expect(saved).toBe("Thunderfury|250|c1|19019");
    // Next time the price is known: no popup.
    s.run("POPUP = nil; STARTED = nil");
    slash(s, "drop |cffa335ee|Hitem:19019::|h[Thunderfury]|h|r");
    expect(s.run("return tostring(POPUP) .. '|' .. STARTED")).toBe("nil|[Thunderfury]@250".replace("[Thunderfury]", "|cffa335ee|Hitem:19019::|h[Thunderfury]|h|r"));
  });

  it("refuses a price that is not a number from 0 to 100000", () => {
    const s = withPriority();
    s.run(`NS.loot.askPrice("Sword", 30)`);
    s.run(`StaticPopupDialogs.GUILDED_ITEM_PRICE.OnAccept({ editBox = { GetText = function() return "lots" end } }, POPUP.data)`);
    expect(s.run("return tostring(STARTED) .. '|' .. tostring(next(GuildedDB.itemPrices or {}))")).toBe("nil|nil");
  });

  it("/guilded price sets one directly, for the core being run", () => {
    const s = withPriority();
    slash(s, "price Onyxia Scale Cloak 90");
    expect(s.run(`return tostring(GuildedDB.itemPrices["c1:onyxia scale cloak"].gp)`)).toBe("90");
    expect(s.run(`return tostring(NS.loot.priceOf("Onyxia Scale Cloak"))`)).toBe("90");
  });
});

describe("recipes without typing anything", () => {
  function withRecipes(): LuaSession {
    return loggedIn(["Locale.lua", "Modules/Recipes.lua"]);
  }

  it("a guildmate's profession you open is saved under their name, never as yours", () => {
    const s = withRecipes();
    s.run(String.raw`
      C_TradeSkillUI = {
        IsTradeSkillLinked = function() return true, "Ann-Realm" end,
        GetAllRecipeIDs = function() return { 502 } end,
        GetBaseProfessionInfo = function() return { professionName = "Alchemy" } end,
        GetRecipeInfo = function() return { learned = true, name = "Flask of Y", hyperlink = "|Hitem:1002::::|h[Flask of Y]|h" } end,
        GetRecipeSchematic = function() return { reagentSlotSchematics = {} } end
      }
      NS.recipes.scan("trade")
    `);
    expect(s.run("return tostring(GuildedDB.recipeBook.people.Kev)")).toBe("nil");
    expect(s.run("local e = GuildedDB.recipeBook.people.Ann.Alchemy; return e.keys[1] .. '|' .. tostring(e.viewed)")).toBe("1002|true");
    expect(s.chat().join("\n")).toContain("saved Ann's Alchemy recipes (1)");
  });

  it("their own report replaces the copy saved from their window", () => {
    const s = withRecipes();
    s.run(`GuildedDB.recipeBook = { people = { Ann = { Alchemy = { v = 1800000500, keys = { 1002 }, viewed = true } } }, names = {}, mats = {}, cooldowns = {}, cooldownAt = {} }`);
    s.run(`fire_event("CHAT_MSG_ADDON", "GuildedRcp", "R|Alchemy|1700000000|1|1|1002,1003", "GUILD", "Ann")`);
    expect(s.run("local e = GuildedDB.recipeBook.people.Ann.Alchemy; return #e.keys .. '|' .. tostring(e.viewed)")).toBe("2|nil");
  });

  it("reminds once about a crafting profession never opened, not a gathering one", () => {
    const s = withRecipes();
    s.run(String.raw`
      GetProfessions = function() return 1, 2 end
      GetProfessionInfo = function(index)
        if index == 1 then return "Alchemy", nil, 150, 300, nil, nil, 171 end
        return "Herbalism", nil, 150, 300, nil, nil, 182
      end
    `);
    expect(s.run("return table.concat(NS.recipes.remindUnread(), ',')")).toBe("Alchemy");
    expect(s.chat().join("\n")).toContain("Open your Alchemy window once");
    expect(s.run("return table.concat(NS.recipes.remindUnread(), ',')")).toBe("");
  });
});

describe("characters that logged in on this PC", () => {
  it("are remembered for the companion (so a paired player's alts link by themselves)", () => {
    const s = loggedIn([]);
    expect(s.run("return GuildedDB.myCharacters.Kev.class")).toBe("WARRIOR");
  });
});
