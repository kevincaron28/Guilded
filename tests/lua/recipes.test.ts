import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

let session: LuaSession | undefined;
afterEach(() => { session?.close(); session = undefined; });

// A fake profession window (the classic API): headers can be collapsed, which hides their recipes.
const TRADE_WINDOW = String.raw`
  TS = {
    line = "Alchemy",
    rows = {
      { name = "Potions", kind = "header", expanded = false },
      { name = "Elixir of X", kind = "optimal", link = "|cff1eff00|Hitem:1001::::|h[Elixir of X]|h|r",
        reagents = { { name = "Peacebloom", count = 2, link = "|cffffffff|Hitem:2447::::|h[Peacebloom]|h|r" }, { name = "Vial", count = 1, link = "|Hitem:3371::::|h[Empty Vial]|h" } } },
      { name = "Transmute: Iron to Gold", kind = "easy", link = "|Hitem:3575::::|h[Iron Bar]|h", cd = 172800, reagents = {} },
      { name = "Transmute: Mithril to Truesilver", kind = "easy", link = "|Hitem:7910::::|h[Truesilver Bar]|h", cd = 172800, reagents = {} },
      { name = "Flasks", kind = "header", expanded = true },
      { name = "Flask of Y", kind = "optimal", link = "|Hitem:1002::::|h[Flask of Y]|h", reagents = {} },
    }
  }
  local function visible()
    local list, open = {}, true
    for index, row in ipairs(TS.rows) do
      if row.kind == "header" then open = row.expanded; table.insert(list, index)
      elseif open then table.insert(list, index) end
    end
    return list
  end
  function GetTradeSkillLine() return TS.line end
  function GetNumTradeSkills() return #visible() end
  function GetTradeSkillInfo(i) local row = TS.rows[visible()[i]]; return row.name, row.kind, 0, row.expanded end
  function GetTradeSkillItemLink(i) return TS.rows[visible()[i]].link end
  function GetTradeSkillCooldown(i) return TS.rows[visible()[i]].cd end
  function GetTradeSkillNumReagents(i) return #(TS.rows[visible()[i]].reagents or {}) end
  function GetTradeSkillReagentInfo(i, j) local r = TS.rows[visible()[i]].reagents[j]; return r.name, "tex", r.count, 0 end
  function GetTradeSkillReagentItemLink(i, j) return TS.rows[visible()[i]].reagents[j].link end
  function ExpandTradeSkillSubClass(i) TS.rows[visible()[i]].expanded = true end
  function CollapseTradeSkillSubClass(i) TS.rows[visible()[i]].expanded = false end
`;

// Guilded's own module, with a fake of what it needs from the addon.
function withRecipes(me = "Ray"): LuaSession {
  session = newLuaSession();
  session.run(String.raw`
    SENT = {}
    function IsInGuild() return true end
    C_Timer = { After = function(_, fn) fn() end }
    C_ChatInfo = {
      SendAddonMessage = function(_, text, ch) SENT[#SENT + 1] = ch .. ":" .. text end,
      RegisterAddonMessagePrefix = function() return true end
    }
    DB = {}
    NOW = 1800000000
    function GetServerTime() return NOW end
    NS = {
      L = function(t) return t end,
      isSecret = function() return false end,
      normalizeName = function(n) if not n then return nil end return (string.gsub(n, "%-.*", "")) end,
      playerName = function() return "${me}" end,
      message = function(text) CHAT_LOG = CHAT_LOG or {}; CHAT_LOG[#CHAT_LOG + 1] = text end,
      getDb = function() return DB end,
      commandHandlers = {}, commandHelp = {}
    }
  `);
  session.run(TRADE_WINDOW);
  session.load("Modules/Recipes.lua");
  return session;
}

const cmd = (s: LuaSession, name: string, line: string) =>
  s.run(`local a = {}; for w in string.gmatch(${JSON.stringify(line)}, "%S+") do a[#a + 1] = w end; NS.commandHandlers[${JSON.stringify(name)}](a)`);
const receive = (s: LuaSession, from: string, text: string, channel = "GUILD") =>
  s.run(`fire_event("CHAT_MSG_ADDON", "GuildedRcp", ${JSON.stringify(text)}, ${JSON.stringify(channel)}, ${JSON.stringify(from)})`);
const last = (s: LuaSession) => s.run("return CHAT_LOG[#CHAT_LOG]");
const keysOf = (s: LuaSession, who: string, profession: string) =>
  s.run(`local t = {}; for _, k in ipairs(DB.recipeBook.people[${JSON.stringify(who)}][${JSON.stringify(profession)}].keys) do t[#t + 1] = tostring(k) end; return table.concat(t, ",")`);

describe("Recipes.lua reading a profession window", () => {
  it("reads every recipe, even in collapsed groups, and leaves the window as it was", () => {
    const s = withRecipes();
    s.run(`NS.recipes.scan("trade")`);
    expect(keysOf(s, "Ray", "Alchemy")).toBe("1001,1002,3575,7910");
    expect(s.run("return tostring(TS.rows[1].expanded)")).toBe("false");
    expect(s.run("return tostring(TS.rows[5].expanded)")).toBe("true");
    expect(s.run("return DB.recipeBook.names[1001]")).toBe("Elixir of X");
  });

  it("keeps the materials of each recipe for the shopping list", () => {
    const s = withRecipes();
    s.run(`NS.recipes.scan("trade")`);
    s.run(`GetItemCount = function(id) return id == 2447 and 3 or 0 end`);
    cmd(s, "recipes", "mats |cff1eff00|Hitem:1001::::|h[Elixir of X]|h|r 5");
    expect(last(s)).toBe("Materials for 5 x Elixir of X:\n10 x Peacebloom (you have 3)\n5 x Vial (you have 0)");
  });

  it("shows shared cooldowns as one line", () => {
    const s = withRecipes();
    s.run(`NS.recipes.scan("trade")`);
    const list = s.run("return #DB.recipeBook.cooldowns.Ray");
    expect(list).toBe("1");
    expect(s.run("return DB.recipeBook.cooldowns.Ray[1].name")).toBe("Transmute");
    expect(s.run("return DB.recipeBook.cooldowns.Ray[1].readyAt")).toBe(String(1800000000 + 172800));
    cmd(s, "cooldowns", "mine");
    expect(last(s)).toBe("Ray - Transmute (Alchemy): 2d 0h");
  });

  it("uses enchant links as negative ids and ignores hunter pet training", () => {
    const s = withRecipes();
    s.run(`TS.line = "Beast Training"; NS.recipes.scan("trade")`);
    expect(s.run("return tostring(DB.recipeBook and DB.recipeBook.people.Ray)")).toBe("nil");
    s.run(`
      TS.line = "Enchanting"
      TS.rows = { { name = "Enchant Bracer", kind = "header", expanded = true }, { name = "Minor Health", kind = "easy", link = "|cffffd000|Henchant:7418|h[Enchant Bracer - Minor Health]|h|r", reagents = {} } }
      NS.recipes.scan("trade")
    `);
    expect(keysOf(s, "Ray", "Enchanting")).toBe("-7418");
  });

  it("does nothing when the game has no profession window functions", () => {
    const s = withRecipes();
    s.run(`GetNumTradeSkills = nil; NS.recipes.scan("trade")`);
    expect(s.run("return tostring(DB.recipeBook and DB.recipeBook.people.Ray)")).toBe("nil");
  });

  it("falls back to the modern C_TradeSkillUI window when the classic API is gone", () => {
    const s = withRecipes();
    s.run(String.raw`
      GetNumTradeSkills = nil
      C_TradeSkillUI = {
        GetAllRecipeIDs = function() return { 501, 502, 503 } end,
        GetBaseProfessionInfo = function() return { professionName = "Enchanting" } end,
        GetRecipeInfo = function(id)
          if id == 501 then return { learned = true, name = "Minor Health", isEnchantingRecipe = true, skillLineAbilityID = 7418 } end
          if id == 502 then return { learned = true, name = "Flask of Y", hyperlink = "|Hitem:1002::::|h[Flask of Y]|h" } end
          if id == 503 then return { learned = false, name = "Not Learned Yet" } end
        end,
        GetRecipeSchematic = function(id)
          if id == 501 then return { reagentSlotSchematics = { { reagents = { { itemID = 2447 } }, quantityRequired = 2 } } } end
          return { reagentSlotSchematics = {} }
        end
      }
      GetItemInfo = function(id) return id == 2447 and "Peacebloom" or nil end
      NS.recipes.scan("trade")
    `);
    expect(keysOf(s, "Ray", "Enchanting")).toBe("-7418,1002");
    expect(s.run("return DB.recipeBook.names[1002]")).toBe("Flask of Y");
    expect(s.run("return DB.recipeBook.mats[-7418][1].name")).toBe("Peacebloom");
    expect(s.run("return DB.recipeBook.mats[-7418][1].count")).toBe("2");
  });
});

describe("Recipes.lua sharing with the guild", () => {
  it("sends the list in short chunks, then the cooldowns", () => {
    const s = withRecipes();
    s.run(`NS.recipes.scan("trade")`);
    expect(s.run("return SENT[1]")).toBe("GUILD:R|Alchemy|1800000000|1|1|1001,1002,3575,7910");
    expect(s.run("return SENT[2]")).toBe("GUILD:CDC|Alchemy");
    expect(s.run("return SENT[3]")).toBe(`GUILD:CD|Alchemy|${1800000000 + 172800}|Transmute`);
  });

  it("splits a big list, and every message stays under the limit", () => {
    const s = withRecipes();
    s.run(`
      TS.rows = { { name = "All", kind = "header", expanded = true } }
      for i = 1, 150 do TS.rows[#TS.rows + 1] = { name = "R" .. i, kind = "easy", link = "|Hitem:" .. (20000 + i) .. "::|h[R" .. i .. "]|h", reagents = {} } end
      NS.recipes.scan("trade")
    `);
    expect(Number(s.run("return #SENT"))).toBeGreaterThan(3);
    expect(s.run("local m = 0; for _, t in ipairs(SENT) do if #t > m then m = #t end end; return m <= 255 and 1 or 0")).toBe("1");
  });

  it("does not resend when nothing changed", () => {
    const s = withRecipes();
    s.run(`NS.recipes.scan("trade")`);
    const sent = s.run("return #SENT");
    s.run(`TS.rows[3].cd = nil; TS.rows[4].cd = nil; NS.recipes.scan("trade")`); // cooldowns used up: that is a change
    expect(Number(s.run("return #SENT"))).toBeGreaterThan(Number(sent));
    const again = s.run("return #SENT");
    s.run(`NS.recipes.scan("trade")`);
    expect(s.run("return #SENT")).toBe(again);
  });

  it("does not send when you are not in a guild", () => {
    const s = withRecipes();
    s.run(`IsInGuild = function() return false end; NS.recipes.scan("trade")`);
    expect(s.run("return #SENT")).toBe("0");
  });
});

describe("Recipes.lua receiving from guildmates", () => {
  it("assembles chunks into a person's list and answers who can craft", () => {
    const s = withRecipes();
    receive(s, "Ann-Realm", "R|Tailoring|100|1|2|555,556");
    expect(s.run("return #NS.recipes.crafters(555)")).toBe("0"); // not complete yet
    receive(s, "Ann-Realm", "R|Tailoring|100|2|2|557");
    receive(s, "Bob", "R|Alchemy|100|1|1|557,-7418");
    expect(s.run("local t = {}; for _, c in ipairs(NS.recipes.crafters(557)) do t[#t + 1] = c.name .. ':' .. c.profession end; return table.concat(t, ',')")).toBe("Ann:Tailoring,Bob:Alchemy");
    cmd(s, "recipes", "who |Hitem:557::|h[Bolt of Mageweave]|h");
    expect(last(s)).toBe("item 557: Ann (Tailoring), Bob (Alchemy)");
  });

  it("finds recipes by name once the game has told us the name", () => {
    const s = withRecipes();
    receive(s, "Ann", "R|Tailoring|100|1|1|555");
    s.run(`DB.recipeBook.names[555] = "Bolt of Silk Cloth"`);
    cmd(s, "recipes", "who silk cloth");
    expect(last(s)).toBe("Bolt of Silk Cloth: Ann (Tailoring)");
    cmd(s, "recipes", "who nothing here");
    expect(last(s)).toContain("Nobody is known to craft");
  });

  it("ignores other channels, itself, older lists and broken chunks", () => {
    const s = withRecipes();
    receive(s, "Ann", "R|Tailoring|100|1|1|555", "WHISPER");
    receive(s, "Ray", "R|Tailoring|100|1|1|555");
    receive(s, "Ann", "R|Tailoring|100|9|2|555");
    receive(s, "Ann", "R|Tailoring|100|1|99|555");
    expect(s.run("return tostring(DB.recipeBook and next(DB.recipeBook.people) or nil)")).toBe("nil");
    receive(s, "Ann", "R|Tailoring|200|1|1|555");
    receive(s, "Ann", "R|Tailoring|100|1|1|999"); // older
    expect(keysOf(s, "Ann", "Tailoring")).toBe("555");
  });

  it("keeps guildmates' cooldowns and lists them soonest first", () => {
    const s = withRecipes();
    receive(s, "Ann", "CDC|Alchemy");
    receive(s, "Ann", `CD|Alchemy|${1800000000 + 7200}|Transmute`);
    receive(s, "Bob", `CD|Tailoring|${1800000000 - 60}|Mooncloth`);
    cmd(s, "cooldowns", "");
    expect(s.run("return CHAT_LOG[#CHAT_LOG - 1]")).toBe("Bob - Mooncloth (Tailoring): ready");
    expect(last(s)).toBe("Ann - Transmute (Alchemy): 2h 0m");
    receive(s, "Ann", "CDC|Alchemy"); // cleared
    cmd(s, "cooldowns", "");
    expect(s.run("return CHAT_LOG[#CHAT_LOG]")).toBe("Bob - Mooncloth (Tailoring): ready");
  });

  it("says who can craft an item on its tooltip", () => {
    const s = withRecipes();
    receive(s, "Ann", "R|Tailoring|100|1|1|555");
    expect(s.run("return NS.recipes.tooltipLines(555)[1]")).toBe("Crafted by Ann (Tailoring)");
    expect(s.run("return #NS.recipes.tooltipLines(1)")).toBe("0");
  });

  it("does nothing while the module is off", () => {
    const s = withRecipes();
    s.run(`NS.moduleActive = function() return false end`);
    receive(s, "Ann", "R|Tailoring|100|1|1|555");
    expect(s.run("return tostring(DB.recipeBook and next(DB.recipeBook.people) or nil)")).toBe("nil");
  });
});
