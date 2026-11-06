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
    C_Timer = { After = function(delay, fn) if delay <= 1 then NOW = NOW + 1 end; fn() end }
    C_ChatInfo = {
      SendAddonMessage = function(_, text, ch) SENT[#SENT + 1] = ch .. ":" .. text end,
      RegisterAddonMessagePrefix = function() return true end
    }
    DB = {}
    NOW = 1800000000
    function GetServerTime() return NOW end
    function GetTime() return NOW end
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
// The tooltip lines as text, one per line; the middle dot is shown as "*".
const tip = (s: LuaSession, id: number, opts = "") =>
  s.run(`local t = NS.recipes.tooltipLines(${id}${opts ? ", " + opts : ""}); local o = {}; for _, l in ipairs(t) do o[#o + 1] = (string.gsub(l.raw, "\\194\\183", "*")) end; return table.concat(o, "\\n")`);
// Several people who can craft the same First Aid recipe (item 555), each seen at a later time.
const craftFirstAid = (s: LuaSession, names: string[], profession = "First Aid") =>
  names.forEach((name, index) => receive(s, name, `R|${profession}|${100 + index}|1|1|555`));
const keysOf = (s: LuaSession, who: string, profession: string) =>
  s.run(`local t = {}; for _, k in ipairs(DB.recipeBook.people[${JSON.stringify(who)}][${JSON.stringify(profession)}].keys) do t[#t + 1] = tostring(k) end; return table.concat(t, ",")`);

describe("Recipes.lua reading a profession window", () => {
  it("quietly skips unsupported crafting events while registering supported events", () => {
    const s = withRecipes();
    s.run(`
      DIAGNOSTICS = {}; REGISTERED = {}
      NS.logDiagnostic = function(kind, detail) DIAGNOSTICS[#DIAGNOSTICS + 1] = detail end
      local create = CreateFrame
      CreateFrame = function(...)
        local f = create(...)
        f.RegisterEvent = function(_, event)
          if event == "TRADE_SKILL_UPDATE" or event == "CRAFT_SHOW" or event == "CRAFT_UPDATE" then
            error("Unknown event")
          end
          REGISTERED[event] = true
        end
        return f
      end
    `);
    s.load("Compat.lua");
    s.load("Modules/Recipes.lua");
    expect(s.run(`return tostring(#DIAGNOSTICS)`)).toBe("0");
    expect(s.run(`return tostring(REGISTERED.PLAYER_LOGIN and REGISTERED.CHAT_MSG_ADDON and REGISTERED.TRADE_SKILL_SHOW and REGISTERED.TRADE_SKILL_LIST_UPDATE)`)).toBe("true");
    expect(s.run(`return tostring(NS.compat.registerEvent({ RegisterEvent = function() error("Unknown event") end }, "REQUIRED_EVENT"))`)).toBe("false");
    expect(s.run(`return DIAGNOSTICS[1]`)).toBe("event:REQUIRED_EVENT: event not available");
  });

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
        GetAllRecipeIDs = function() return { 7418, 502, 503 } end,
        GetBaseProfessionInfo = function() return { professionName = "Enchanting" } end,
        GetRecipeInfo = function(id)
          -- The recipe id of an enchant is its spell id (the classic window's "enchant:7418").
          if id == 7418 then return { learned = true, name = "Minor Health", isEnchantingRecipe = true, skillLineAbilityID = 31 } end
          if id == 502 then return { learned = true, name = "Flask of Y", hyperlink = "|Hitem:1002::::|h[Flask of Y]|h" } end
          if id == 503 then return { learned = false, name = "Not Learned Yet" } end
        end,
        GetRecipeSchematic = function(id)
          if id == 7418 then return { reagentSlotSchematics = { { reagents = { { itemID = 2447 } }, quantityRequired = 2 } } } end
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
    expect(s.run("return SENT[3]")).toBe("GUILD:CDC|Alchemy");
    expect(s.run("return SENT[4]")).toBe(`GUILD:CD|Alchemy|${1800000000 + 172800}|Transmute`);
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
    expect(tip(s, 555)).toBe("Guilded * Tailoring: Ann");
    expect(s.run("return #NS.recipes.tooltipLines(1)")).toBe("0");
  });

  it("does nothing while the module is off", () => {
    const s = withRecipes();
    s.run(`NS.moduleActive = function() return false end`);
    receive(s, "Ann", "R|Tailoring|100|1|1|555");
    expect(s.run("return tostring(DB.recipeBook and next(DB.recipeBook.people) or nil)")).toBe("nil");
  });

  it("shows known Forever full names in lookup, tooltip and cooldowns without changing recipe keys", () => {
    const s = withRecipes();
    s.run(`NS.util.gameEdition = function() return "forever" end; DB.displayNames = { Ann = "Ann River" }`);
    receive(s, "Ann", "R|Tailoring|100|1|1|555");
    receive(s, "Ann", "CD|Tailoring|1800000000|Mooncloth");
    expect(s.run(`return NS.recipes.whoText("item:555")`)).toContain("Ann River (Tailoring)");
    expect(tip(s, 555)).toBe("Guilded * Tailoring: Ann");
    expect(s.run(`return NS.recipes.cooldownLines(false)[1]`)).toContain("Ann River - Mooncloth");
    expect(keysOf(s, "Ann", "Tailoring")).toBe("555");
  });

  it("never saves someone else's profession (a chat link or the guild view) as yours", () => {
    const s = withRecipes();
    s.run(String.raw`
      GetNumTradeSkills = nil
      C_TradeSkillUI = {
        IsTradeSkillLinked = function() return true end,
        GetAllRecipeIDs = function() return { 502 } end,
        GetBaseProfessionInfo = function() return { professionName = "Alchemy" } end,
        GetRecipeInfo = function() return { learned = true, name = "Flask of Y", hyperlink = "|Hitem:1002::::|h[Flask of Y]|h" } end,
        GetRecipeSchematic = function() return { reagentSlotSchematics = {} } end
      }
      NS.recipes.scan("trade")
    `);
    expect(s.run("return tostring(DB.recipeBook and DB.recipeBook.people.Ray)")).toBe("nil");
    s.run("C_TradeSkillUI.IsTradeSkillLinked = function() return false end; NS.recipes.scan('trade')");
    expect(keysOf(s, "Ray", "Alchemy")).toBe("1002");
  });
});

describe("profession relay removals", () => {
  it("broadcasts an empty recipe list after unlearning a profession, and the peer clears its copy", () => {
    const s = withRecipes();
    s.run('NS.recipes.scan("trade"); NS.collectProfessions = function() return {}, true end; NS.recipes.pruneMine()');
    expect(keysOf(s, "Ray", "Alchemy")).toBe("");
    expect(s.run('return #DB.recipeBook.cooldowns.Ray')).toBe("0");
    expect(s.run('local found = false; for _, m in ipairs(SENT) do if m == "GUILD:R|Alchemy|1800000001|1|1|" then found = true end end; return tostring(found)')).toBe("true");
    receive(s, "Ann", "R|Alchemy|1800000000|1|1|1001");
    receive(s, "Ann", "R|Alchemy|1800000001|1|1|");
    expect(keysOf(s, "Ann", "Alchemy")).toBe("");
  });
  it("relays names only for keys the sender actually reported", () => {
    const s = withRecipes();
    receive(s, "Ann", "R|Alchemy|1800000000|1|1|1001");
    receive(s, "Ann", "N|1001~Elixir of X;9999~Unknown recipe");
    expect(s.run('return DB.recipeBook.names[1001]')).toBe("Elixir of X");
    expect(s.run('return tostring(DB.recipeBook.names[9999])')).toBe("nil");
  });
});

describe("Recipes.lua compact tooltip", () => {
  const prepare = (me = "Ray") => {
    const s = withRecipes(me);
    s.run(`
      SHIFT = false; function IsShiftKeyDown() return SHIFT end
      ONLINE = {}
      function GetNumGuildMembers() return #ONLINE end
      function GetGuildRosterInfo(i) return ONLINE[i] .. "-Realm", "", 0, 0, "", "", "", "", true end
      NS.getSettings = function() DB.settings = DB.settings or {}; return DB.settings end
    `);
    return s;
  };

  it("names the profession once and lists up to three crafters on one line", () => {
    const s = prepare();
    craftFirstAid(s, ["Ann", "Bob"]);
    expect(tip(s, 555)).toBe("Guilded * First Aid: Bob, Ann"); // most recently shared first
    craftFirstAid(s, ["Ann", "Bob", "Cy"]);
    expect(tip(s, 555)).toBe("Guilded * First Aid: Cy, Bob, Ann");
  });

  it("shows the count and three names plus '+N more' for four to six crafters", () => {
    const s = prepare();
    craftFirstAid(s, ["Ann", "Bob", "Cy", "Dan"]);
    expect(tip(s, 555)).toBe("Guilded * First Aid: 4 crafters\nDan, Cy, Bob +1 more");
    craftFirstAid(s, ["Ann", "Bob", "Cy", "Dan", "Eve", "Fay"]);
    expect(tip(s, 555)).toBe("Guilded * First Aid: 6 crafters\nFay, Eve, Dan +3 more");
  });

  it("shows only the count when more than six can craft it", () => {
    const s = prepare();
    craftFirstAid(s, ["Ann", "Bob", "Cy", "Dan", "Eve", "Fay", "Gus"]);
    expect(tip(s, 555)).toBe("Guilded * First Aid: 7 crafters");
    expect(s.run("local _, more = NS.recipes.tooltipLines(555); return tostring(more)")).toBe("true");
  });

  it("puts you first as 'you', then guildmates online, then the most recent", () => {
    const s = prepare("Ray");
    craftFirstAid(s, ["Ann", "Bob", "Cy", "Dan"]);
    s.run(`DB.recipeBook.people.Ray = { ["First Aid"] = { v = 50, keys = { 555 } } }; ONLINE = { "Ann" }`); // your own recipes come from the profession window, not a message
    expect(tip(s, 555)).toBe("Guilded * First Aid: 5 crafters\nyou, Ann (online), Dan +2 more");
  });

  it("adds last seen from the roster: online now, hours, days, weeks (one line, no taller)", () => {
    const s = prepare("Ray");
    craftFirstAid(s, ["Ann", "Bob", "Cy"]);
    s.run(`
      ONLINE = { "Ann", "Bob", "Cy" }
      ONLINE_FLAGS = { Ann = true }
      function GetGuildRosterInfo(i) return ONLINE[i] .. "-Realm", "", 0, 0, "", "", "", "", ONLINE_FLAGS[ONLINE[i]] == true end
      LAST = { Bob = { 0, 0, 3, 5 }, Cy = { 0, 0, 20, 0 } }
      function GetGuildRosterLastOnline(i) local t = LAST[ONLINE[i]]; if not t then return nil end return t[1], t[2], t[3], t[4] end
    `);
    expect(tip(s, 555)).toBe("Guilded * First Aid: Ann (online), Cy (2w), Bob (3d)");
  });

  it("remembers last seen in SavedVariables with the read time, and falls back to it", () => {
    const s = prepare("Ray");
    craftFirstAid(s, ["Bob"]);
    s.run(`
      ONLINE = { "Bob" }
      function GetGuildRosterInfo(i) return "Bob-Realm", "", 0, 0, "", "", "", "", false end
      function GetGuildRosterLastOnline() return 0, 0, 2, 0 end
    `);
    expect(tip(s, 555)).toBe("Guilded * First Aid: Bob (2d)");
    expect(s.run(`return DB.crafterSeen.Bob.read == time() and "read" or "stale"`)).toBe("read");
    // The roster no longer answers (not loaded): the saved value is used instead.
    s.run(`GetGuildRosterLastOnline = nil; function GetGuildRosterInfo() return nil end; GetNumGuildMembers = function() return 0 end`);
    expect(s.run(`return NS.recipes.lastSeenText("Bob", false)`)).toBe("2d");
    expect(s.run(`return tostring(NS.recipes.lastSeenText("Nobody", false))`)).toBe("nil");
  });

  it("formats the elapsed time and shows it in the Shift list too", () => {
    const s = prepare("Ray");
    const text = (secs: number) => s.run(`return NS.recipes.lastSeenText("X", false, time() - ${secs})`);
    expect(text(60)).toBe("<1h");
    expect(text(5 * 3600)).toBe("5h");
    expect(text(3 * 86400)).toBe("3d");
    expect(text(21 * 86400)).toBe("3w");
    expect(text(90 * 86400)).toBe("3mo");
    expect(text(800 * 86400)).toBe("2y");
    expect(s.run(`return NS.recipes.lastSeenText("X", true)`)).toBe("online");
  });

  it("uses full names only where two crafters share a first name", () => {
    const s = prepare();
    s.run(`NS.util.gameEdition = function() return "forever" end; DB.displayNames = { Ann = "Ann River", Bob = "Bob Stone", Cy = "Ann Lake" }`);
    craftFirstAid(s, ["Ann", "Bob", "Cy"]);
    expect(tip(s, 555)).toBe("Guilded * First Aid: Ann Lake, Bob, Ann River");
  });

  it("lists everyone with online status while Shift is held", () => {
    const s = prepare("Ray");
    craftFirstAid(s, ["Ann", "Bob", "Cy", "Dan", "Eve", "Fay", "Gus"]);
    s.run(`DB.recipeBook.people.Ray = { ["First Aid"] = { v = 50, keys = { 555 } } }; ONLINE = { "Gus" }; SHIFT = true`);
    const text = tip(s, 555);
    const rows = text.split("\n");
    expect(rows[0]).toBe("Guilded * First Aid: 8 crafters");
    expect(rows).toHaveLength(9);
    expect(rows[1]).toBe("  Ray (you) - |cff40ff40online|r");
    expect(rows[2]).toBe("  Gus - |cff40ff40online|r");
    expect(rows[3]).toBe("  Fay - |cff9d9d9doffline|r");
    expect(s.run("local _, more = NS.recipes.tooltipLines(555); return tostring(more)")).toBe("false");
  });

  it("follows the setting: off, compact (default) and full", () => {
    const s = prepare();
    craftFirstAid(s, ["Ann", "Bob", "Cy", "Dan"]);
    expect(s.run("return NS.recipes.tooltipMode()")).toBe("compact");
    cmd(s, "recipes", "tooltip full");
    expect(s.run("return DB.settings.tooltipCrafters")).toBe("full");
    expect(tip(s, 555).split("\n")).toHaveLength(5);
    cmd(s, "recipes", "tooltip off");
    expect(s.run("return #NS.recipes.tooltipLines(555)")).toBe("0");
    cmd(s, "recipes", "tooltip nonsense");
    expect(s.run("return NS.recipes.tooltipMode()")).toBe("off");
    cmd(s, "recipes", "tooltip compact");
    expect(tip(s, 555)).toBe("Guilded * First Aid: 4 crafters\nDan, Cy, Bob +1 more");
  });

  it("keeps the professions apart when a recipe is shared by two", () => {
    const s = prepare();
    receive(s, "Ann", "R|Alchemy|100|1|1|555");
    receive(s, "Bob", "R|Tailoring|101|1|1|555");
    expect(tip(s, 555)).toBe("Guilded * Alchemy: Ann\nGuilded * Tailoring: Bob");
  });
});
