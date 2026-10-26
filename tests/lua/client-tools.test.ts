import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";
let session: LuaSession | undefined;
afterEach(() => { session?.close(); session = undefined; });
function setup() {
  const s = session = newLuaSession();
  s.run(`COMBAT = false; EDITION = "retail"; ACTIVE = true; OPENED = 0
    InCombatLockdown = function() return COMBAT end
    ToggleLFDParentFrame = function() OPENED = OPENED + 1 end
    NS = { comm = {}, util = { gameEdition = function() return EDITION end }, isSecret = function(v) return v == "SECRET" end,
      moduleActive = function() return ACTIVE end, message = function(text) MESSAGE = text end,
      recipes = { whoText = function(q) QUERY = q; return "Known crafters" end },
      showCopyText = function(t) COPIED = t end, openGuildPanel = function() PANEL = true end }
  `);
  s.load("Modules/ClientTools.lua"); s.run(`T = NS.clientTools`); return s;
}
describe("user-clicked client integrations", () => {
  it("opens only the existing finder and respects edition, combat, API and eligibility gates", () => {
    const s = setup();
    expect(s.run(`return tostring(T.openFinder()) .. ":" .. OPENED`)).toBe("true:1");
    for (const condition of ['COMBAT = true', 'COMBAT = "SECRET"', 'COMBAT = false; EDITION = "forever"', 'EDITION = "retail"; C_LFGInfo = { CanPlayerUseGroupFinder = function() return false end }']) {
      s.run(condition); expect(s.run(`return tostring(T.openFinder()) .. ":" .. OPENED`)).toBe("false:1");
    }
    expect(s.run(`C_LFGInfo = nil; ToggleLFDParentFrame = nil; return tostring(T.openFinder())`)).toBe("false");
  });
  it("accepts a legacy nil outside combat but blocks missing or throwing combat APIs", () => {
    const s = setup();
    expect(s.run(`COMBAT = nil; return tostring(T.openFinder())`)).toBe("true");
    expect(s.run(`InCombatLockdown = function() error("unavailable") end; return tostring(T.openFinder())`)).toBe("false");
    expect(s.run(`InCombatLockdown = nil; return tostring(T.openFinder())`)).toBe("false");
  });
  it("reads a modern selected item's output and enchant spell key without crafting", () => {
    const s = setup();
    s.run(`INFO = { recipeID = 123 }; ProfessionsFrame = { CraftingPage = { SchematicForm = { GetRecipeInfo = function() return INFO end } } }
      C_TradeSkillUI = { GetRecipeSchematic = function(id) if id == 123 then return { outputItemID = 456 } end end }`);
    expect(s.run(`T.findCrafter("modern"); return QUERY .. ":" .. COPIED`)).toBe("item:456:Known crafters");
    expect(s.run(`INFO.isEnchantingRecipe = true; T.findCrafter("modern"); return QUERY`)).toBe("enchant:123");
    s.load("Modules/Recipes.lua");
    expect(s.run(`return NS.recipes.keyFromLink(T.selectedRecipe("modern"))`)).toBe("-123");
    expect(s.run(`INFO.isEnchantingRecipe = false; return NS.recipes.keyFromLink(T.selectedRecipe("modern"))`)).toBe("456");
    expect(s.run(`INFO.recipeID = "SECRET"; return tostring(T.selectedRecipe("modern"))`)).toBe("nil");
  });
  it("reads legacy selected links, falls back to search, and does nothing during combat or when disabled", () => {
    const s = setup();
    s.run(`GetCraftSelectionIndex = function() return 2 end; GetCraftItemLink = function(i) return i == 2 and "|Henchant:42|h[Test]|h" end`);
    expect(s.run(`T.findCrafter("craft"); return QUERY`)).toContain("enchant:42");
    expect(s.run(`T.findCrafter("trade"); return tostring(PANEL)`)).toBe("true");
    expect(s.run(`COMBAT = true; QUERY = nil; T.findCrafter("craft"); return tostring(QUERY)`)).toBe("nil");
    expect(s.run(`COMBAT = false; ACTIVE = false; T.findCrafter("craft"); return tostring(QUERY)`)).toBe("nil");
  });
  it("attaches one button per loaded profession window, deferring creation until combat ends", () => {
    const s = setup();
    s.run(`TradeSkillFrame = CreateFrame(); CraftFrame = CreateFrame(); COMBAT = true; T.attach()`);
    expect(s.run(`return tostring(next(T.buttons))`)).toBe("nil");
    s.run(`COMBAT = false; T.attach(); FIRST = T.buttons.TradeSkillFrame; T.attach()`);
    expect(s.run(`return tostring(FIRST == T.buttons.TradeSkillFrame) .. ":" .. type(T.buttons.CraftFrame)`)).toBe("true:table");
    s.run(`GetTradeSkillSelectionIndex = function() return 1 end; GetTradeSkillItemLink = function() return "|Hitem:789|h[Test]|h" end; FIRST.scripts.OnClick()`);
    expect(s.run(`return QUERY`)).toContain("item:789");
  });
});
