import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

// 9.5.2: the reagents every recipe needs ship with the addon (Data/Reagents.lua, generated from data/recipes/*.csv). Your own
// profession scan wins, a difference is noted quietly in /guilded diag, names come from the game in the player's language.
let session: LuaSession | undefined;
afterEach(() => { session?.close(); session = undefined; });

// One recipe row in a fake classic profession window: product item id, then reagents { id, count, name }.
const windowWith = (rows: string) => String.raw`
  TS = { line = "Alchemy", rows = { ${rows} } }
  function GetTradeSkillLine() return TS.line end
  function GetNumTradeSkills() return #TS.rows end
  function GetTradeSkillInfo(i) local r = TS.rows[i]; return r.name, "optimal", 0, true end
  function GetTradeSkillItemLink(i) return "|Hitem:" .. TS.rows[i].id .. "::::|h[" .. TS.rows[i].name .. "]|h" end
  function GetTradeSkillNumReagents(i) return #TS.rows[i].reagents end
  function GetTradeSkillReagentInfo(i, j) local r = TS.rows[i].reagents[j]; return r.name, "tex", r.count, 0 end
  function GetTradeSkillReagentItemLink(i, j) return "|Hitem:" .. TS.rows[i].reagents[j].id .. "::::|h[x]|h" end
`;

function setup(): LuaSession {
  session = newLuaSession();
  session.run(String.raw`
    function IsInGuild() return true end
    C_Timer = { After = function(_, fn) end }
    C_ChatInfo = { SendAddonMessage = function() end, RegisterAddonMessagePrefix = function() return true end }
    DB = {}; NOW = 1800000000
    function GetServerTime() return NOW end
    function GetTime() return NOW end
    DIAG = {}; CHAT_LOG = {}
    NS = {
      L = function(t) return t end, isSecret = function() return false end,
      normalizeName = function(n) if not n then return nil end return (string.gsub(n, "%-.*", "")) end,
      playerName = function() return "Ray" end,
      message = function(text) CHAT_LOG[#CHAT_LOG + 1] = text end,
      logDiagnostic = function(kind, detail) DIAG[#DIAG + 1] = kind .. ": " .. detail end,
      getDb = function() return DB end, commandHandlers = {}, commandHelp = {}
    }
  `);
  session.load("Data/Reagents.lua");
  session.load("Modules/Recipes.lua");
  return session;
}

describe("shipped reagent data (Data/Reagents.lua)", () => {
  it("covers thousands of recipes, enchants by minus the spell id, and gives the count one craft makes", () => {
    const s = setup();
    expect(Number(s.run("return NS.reagentData.recipeCount"))).toBeGreaterThan(2000);
    // Elixir of Minor Strength (item 2454): Earthroot, Silverleaf, Empty Vial.
    expect(s.run("local m, source, made = NS.recipes.matsFor(2454); return source .. made .. ':' .. m[1].id .. 'x' .. m[1].count .. ',' .. m[3].id")).toBe("data1:2449x1,3371");
    expect(s.run("local n = 0; for key in pairs(NS.reagentData.recipes) do if key < 0 then n = n + 1 end end; return tostring(n > 100)")).toBe("true");
    expect(s.run("return tostring(NS.recipes.matsFor(999999999))")).toBe("nil");
  });

  it("names reagents with the game's own (localized) name, the English data name only as a fallback", () => {
    const s = setup();
    expect(s.run("return NS.recipes.matsFor(2454)[1].name")).toBe("Earthroot"); // no item cache yet: the shipped name
    s.run(`function GetItemInfo(id) if id == 2449 then return "Racine-de-terre" end end`);
    expect(s.run("return NS.recipes.matsFor(2454)[1].name")).toBe("Racine-de-terre");
    expect(s.run("return NS.recipes.matsFor(2454)[2].name")).toBe("Silverleaf");
  });
});

describe("your own profession scan against the shipped data", () => {
  it("wins over the shipped reagents and notes a difference once, quietly (kind RECIPES, no chat line)", () => {
    const s = setup();
    s.run(windowWith(String.raw`{ name = "Elixir of Minor Strength", id = 2454, reagents = { { id = 2449, count = 2, name = "Earthroot" }, { id = 765, count = 1, name = "Silverleaf" } } }`));
    s.run(`NS.recipes.scan("trade")`);
    expect(s.run("local m, source = NS.recipes.matsFor(2454); return source .. m[1].count .. #m")).toBe("scan22");
    expect(s.run("return #DIAG .. DIAG[1]")).toContain("RECIPES: Elixir of Minor Strength (2454): the game lists 2x2449 1x765, the shipped data 1x2449 1x765 1x3371");
    s.run(`NS.recipes.scan("trade")`);
    s.run(`TS.rows[1].reagents[1].count = 3; NS.recipes.scan("trade")`);
    expect(s.run("return #DIAG")).toBe("1"); // once per recipe and session
  });

  it("notes a recipe the shipped data lacks, says nothing when they agree, and never lets an empty reading replace known reagents", () => {
    const s = setup();
    s.run(windowWith(String.raw`
      { name = "Elixir of Minor Strength", id = 2454, reagents = { { id = 2449, count = 1, name = "Earthroot" }, { id = 765, count = 1, name = "Silverleaf" }, { id = 3371, count = 1, name = "Empty Vial" } } },
      { name = "Brand New Potion", id = 987654, reagents = { { id = 2449, count = 5, name = "Earthroot" } } },
      { name = "Empty Reading", id = 2455, reagents = {} }`));
    s.run(`NS.recipes.scan("trade")`);
    expect(s.run("return #DIAG")).toBe("1");
    expect(s.run("return DIAG[1]")).toContain("Brand New Potion (987654): not in the shipped data, the game lists 5x2449");
    expect(s.run("return NS.recipes.matsFor(987654)[1].name")).toBe("Earthroot");
    expect(s.run("local _, source = NS.recipes.matsFor(2455); return source")).toBe("data");
    expect(s.run("return table.concat(CHAT_LOG, '|')")).not.toContain("RECIPES");
  });

  it("uses the shipped reagents for /guilded recipes mats of a recipe you never opened", () => {
    const s = setup();
    s.run(`local a = { "|cff1eff00|Hitem:2454::::|h[Elixir of Minor Strength]|h|r", "2" }; NS.commandHandlers["recipes"]({ "mats", a[1], a[2] })`);
    expect(s.run("return table.concat(CHAT_LOG, '|')")).toContain("2 x Earthroot");
  });
});
