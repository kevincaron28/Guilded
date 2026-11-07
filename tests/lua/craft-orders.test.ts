import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

// Crafting orders in game (Modules/CraftOrders.lua, docs/plans/CRAFTING_ORDERS.md): Discord craft requests on
// the Orders page, filtered to this character's recipes with reagents, and Claim / Done / Give back from the game.
let s: LuaSession | undefined;
afterEach(() => { s?.close(); s = undefined; });

const FRAMES = String.raw`
  local base = CreateFrame
  function CreateFrame(kind, name, parent, template)
    local f = base(kind)
    f.kind, f.shown, f.text = kind, true, ""
    f.Show = function(self) self.shown = true end
    f.Hide = function(self) self.shown = false end
    f.IsShown = function(self) return self.shown end
    f.SetText = function(self, v) self.text = v or "" end
    f.GetText = function(self) return self.text end
    f.HookScript = function(self, n, fn) self.scripts[n] = fn end
    f.CreateFontString = function() return CreateFrame("FontString") end
    f.CreateTexture = function() return CreateFrame("Texture") end
    return f
  end
`;

const FILE = String.raw`GuildedOrders = { at = "2026-11-07T12:00:00.000Z", orders = {
    { id = "req_shirt01", key = 2580, item = "Brown Linen Shirt", qty = 2, prof = "Tailoring", status = "OPEN", by = "Ann Walker", crafter = "", character = "", asked = "", mats = false, note = "Tip 5g", at = 1799990000 },
    { id = "req_belt002", key = 7026, item = "Linen Belt", qty = 1, prof = "Tailoring", status = "OPEN", by = "Bo Dee", crafter = "", character = "", asked = "", mats = true, note = "", at = 1799990100 },
    { id = "req_flask03", key = 13510, item = "Flask of the Titans", qty = 1, prof = "Alchemy", status = "OPEN", by = "Cy Ra", crafter = "", character = "", asked = "", mats = false, note = "", at = 1799990200 },
    { id = "req_cloak04", key = 2584, item = "Woolen Cape", qty = 1, prof = "Tailoring", status = "CLAIMED", by = "Di Vo", crafter = "Eve", character = "Eve Stone", asked = "", mats = false, note = "", at = 1799990300 },
    { id = "req_asked05", key = 9999, item = "Odd Hat", qty = 1, prof = "Tailoring", status = "OPEN", by = "Fa Le", crafter = "", character = "", asked = "Tester", mats = false, note = "", at = 1799990400 },
  } }`;

function setup(options: { lang?: string; file?: boolean } = {}) {
  s = newLuaSession();
  s.run(FRAMES);
  s.run("NS = {}; GuildedDB = nil");
  s.load("Core.lua"); s.load("Compat.lua"); s.load("Locale.lua"); s.load("Modules/Recipes.lua"); s.load("Modules/CraftOrders.lua");
  s.run(`fire_event("PLAYER_LOGIN")
    NS.isGuildMember = function(name) return name ~= "Stranger" end
    NS.util.tooFarAhead = function() return false end
    NS.getSettings().language = "${options.lang ?? "en"}"
    MESSAGES = {}; NS.message = function(text) MESSAGES[#MESSAGES + 1] = text end
    BAGS = { [2589] = 5, [2320] = 1 }
    GetItemCount = function(id) return BAGS[id] or 0 end
    local book = NS.recipes.book()
    book.people[NS.playerName()] = { Tailoring = { v = 1, keys = { 2580, 7026, 2584 } } }
    book.mats[2580] = { { id = 2589, count = 3, name = "Linen Cloth" }, { id = 2320, count = 1, name = "Coarse Thread" } }
    SENT = {}`);
  if (options.file !== false) s.run(FILE);
  return s;
}

function buildPage() {
  s!.run(`PAGE = CreateFrame("Frame")
    HELPERS = { width = 582,
      newLabel = function(parent, text) local l = parent:CreateFontString(); l:SetText(text ~= "" and NS.L(text) or ""); return l end,
      newButton = function(parent, text, width, onClick) local b = CreateFrame("Button"); b:SetText(NS.L(text)); b:SetScript("OnClick", onClick); return b end,
      at = function(widget) return widget end }
    VIEW = NS.craftOrders.buildPage(PAGE, HELPERS)
    PAGE.scripts.OnShow(PAGE)`);
}
const titles = () => s!.run(`local t = {} for _, row in ipairs(VIEW.rows) do if row.frame.shown then t[#t + 1] = row.title.text end end return table.concat(t, "\\n")`);
const sent = (kind: string) => s!.run(`local t = {} for _, m in ipairs(SENT) do if m.prefix == "GuildedOrd" and string.find(m.text, "^${kind}|") then t[#t + 1] = m.text end end return table.concat(t, "\\n")`);

describe("the Orders page", () => {
  it("lists the orders this character can craft, asked-of-you first, with reagents and bag counts", () => {
    setup();
    buildPage();
    expect(s!.run("return VIEW.header.text")).toBe("From Discord, through your companion.");
    const shown = titles().split("\n");
    // The asked order first (even without the recipe), then the craftable open ones; the Alchemy and taken orders stay out.
    expect(shown[0]).toContain("For you");
    expect(shown[0]).toContain("Odd Hat");
    expect(shown[1]).toContain("2x |cffffd100Brown Linen Shirt|r");
    expect(shown[1]).toContain("for Ann Walker");
    expect(shown[2]).toContain("Linen Belt");
    expect(shown).toHaveLength(3);
    // 2 shirts x 3 cloth = 6 needed, 5 in bags (red); 2 thread needed, 1 in bags.
    expect(s!.run("return VIEW.rows[2].reagents.text")).toBe("Reagents: |cffff40405/6|r Linen Cloth, |cffff40401/2|r Coarse Thread");
    expect(s!.run("return VIEW.rows[2].note.text")).toBe('"Tip 5g"');
    expect(s!.run("return VIEW.rows[3].reagents.text")).toBe("The requester brings the materials.");
    expect(s!.run("return VIEW.rows[2].first.text .. '/' .. VIEW.rows[2].second.text")).toBe("Claim/Done");
    // Show all adds the rest, greyed when the recipe is not yours.
    s!.run("VIEW.allButton.scripts.OnClick(VIEW.allButton)");
    expect(titles()).toContain("Not in your recipes|r  1x |cffffd100Flask of the Titans|r");
    expect(titles()).not.toContain("Woolen Cape");
  });

  it("claims in game, says it on GUILD, and shows Done / Give back until Discord has it", () => {
    setup();
    buildPage();
    s!.run("VIEW.rows[2].first.scripts.OnClick(VIEW.rows[2].first)");
    expect(s!.run("return NS.getDb().craftOrders.actions.req_shirt01.action")).toBe("claim");
    expect(sent("ACT")).toBe(`ACT|req_shirt01|claim|1800000000|${s!.run("return NS.craftOrders.myName()")}`);
    expect(s!.run("return MESSAGES[#MESSAGES]")).toContain("Order claimed");
    expect(s!.run("return VIEW.rows[1].status.text")).toBe("Yours - goes to Discord with your next sync");
    expect(s!.run("return VIEW.rows[1].first.text .. '/' .. VIEW.rows[1].second.text")).toBe("Done/Give back");
    // Giving back a claim that never reached Discord just forgets it.
    s!.run("VIEW.rows[1].second.scripts.OnClick(VIEW.rows[1].second)");
    expect(s!.run("return tostring(NS.getDb().craftOrders.actions.req_shirt01)")).toBe("nil");
    // Once Discord shows the claim, the waiting action goes away and the order stays yours.
    s!.run(`NS.craftOrders.act("req_shirt01", "claim")
      GuildedOrders.orders[1].status = "CLAIMED"; GuildedOrders.orders[1].character = NS.craftOrders.myName(); NS.craftOrders.prune()`);
    expect(s!.run("return tostring(NS.getDb().craftOrders.actions.req_shirt01)")).toBe("nil");
    expect(s!.run(`local row = NS.craftOrders.list(false)[1]; return row.order.id .. ':' .. NS.craftOrders.statusText(row)`)).toBe("req_shirt01:Yours");
    s!.run(`NS.craftOrders.act("req_shirt01", "done")`);
    expect(s!.run("return NS.getDb().craftOrders.actions.req_shirt01.action")).toBe("done");
  });

  it("refuses an order someone else took, and says when officers turned orders off", () => {
    setup();
    expect(s!.run(`local ok, why = NS.craftOrders.act("req_cloak04", "claim"); return why`)).toBe("Someone already took that order.");
    expect(s!.run(`local ok, why = NS.craftOrders.act("req_cloak04", "release"); return why`)).toBe("Only the crafter who took an order can give it back.");
    expect(s!.run(`local ok, why = NS.craftOrders.act("nope00", "claim"); return why`)).toBe("That order is no longer open.");
    s!.run(`GuildedOrders = { at = "2026-11-08T00:00:00.000Z", off = true }`);
    buildPage();
    expect(s!.run("return VIEW.header.text")).toContain("turned crafting orders off");
    expect(titles()).toBe("");
  });

  it("prints one login line for new orders you can make, unless the member turned alerts off", () => {
    setup();
    expect(s!.run("return tostring(NS.craftOrders.loginAlert())")).toBe("true");
    expect(s!.run("return MESSAGES[1]")).toBe("3 craft order(s) from Discord you can make: the Orders page of the Guilded window (/guilded orders).");
    expect(s!.run("return tostring(NS.craftOrders.loginAlert())")).toBe("false");
    s!.run(`NS.commandHandlers.orders({ "alerts", "off" })
      GuildedOrders.orders[6] = { id = "req_new0006", key = 2580, item = "Shirt", qty = 1, status = "OPEN", by = "Gi", at = 1799999999 }`);
    expect(s!.run("return tostring(NS.craftOrders.loginAlert())")).toBe("false");
  });

  it("is translated in French, German and Spanish", () => {
    for (const lang of ["fr", "de", "es"]) {
      setup({ lang });
      buildPage();
      expect(s!.run("return VIEW.rows[2].first.text")).not.toBe("Claim");
      expect(s!.run("return VIEW.allButton.text")).not.toBe("Show all open orders");
      expect(s!.run("return VIEW.header.text")).not.toBe("From Discord, through your companion.");
      s!.close(); s = undefined;
    }
  });
});

describe("the relay for crafters without the companion", () => {
  it("shares the orders on GUILD and a guildmate rebuilds them", () => {
    setup();
    expect(s!.run("return tostring(NS.craftOrders.share())")).toBe("true");
    const parts = s!.run(`local t = {} for _, m in ipairs(SENT) do if string.find(m.text, "^ORDERS|") then t[#t + 1] = m.text end end return table.concat(t, "\\0")`).split("\0");
    expect(parts[0]).toMatch(/^ORDERS\|2026-11-07T12:00:00\.000Z\|1\|\d+\|req_shirt01;2580;2;O;1799990000;0;Brown Linen Shirt;Ann Walker;/);
    s!.close();
    setup({ file: false });
    for (const part of parts) s!.run(`fire_event("CHAT_MSG_ADDON", "GuildedOrd", ${JSON.stringify(part)}, "GUILD", "Kev Caron")`);
    expect(s!.run("local c = NS.craftOrders.current(); return c.source .. ':' .. c.from .. ':' .. #c.orders .. ':' .. c.orders[4].character .. ':' .. c.orders[1].note"))
      .toBe("guild:Kev Caron:5:Eve Stone:Tip 5g");
    buildPage();
    expect(s!.run("return VIEW.header.text")).toBe("Shared by Kev Caron (from Discord).");
  });

  it("keeps guildmates' actions, newest per order and sender, for this PC's companion to carry", () => {
    setup();
    s!.run(`fire_event("CHAT_MSG_ADDON", "GuildedOrd", "ACT|req_belt002|claim|1799999000|Ann Walker", "GUILD", "Ann Walker")
      fire_event("CHAT_MSG_ADDON", "GuildedOrd", "ACT|req_belt002|release|1799998000|Ann Walker", "GUILD", "Ann Walker")
      fire_event("CHAT_MSG_ADDON", "GuildedOrd", "ACT|req_belt002|claim|1799999000|X", "GUILD", "Stranger")
      fire_event("CHAT_MSG_ADDON", "GuildedOrd", "ACT|req_belt002|steal|1799999000|Bo", "GUILD", "Bo Dee")`);
    expect(s!.run(`local t = {} for key, v in pairs(NS.getDb().craftOrders.heard) do t[#t + 1] = key .. "=" .. v.action end return table.concat(t, ";")`))
      .toBe("req_belt002@Ann Walker=claim");
  });

  it("round-trips its own line format and refuses malformed text", () => {
    setup();
    expect(s!.run(`local c = NS.craftOrders.decode(NS.craftOrders.encode(NS.craftOrders.current())); return c.orders[2].item .. "|" .. tostring(c.orders[2].mats) .. "|" .. c.orders[4].status`))
      .toBe("Linen Belt|true|CLAIMED");
    expect(s!.run(`return tostring(NS.craftOrders.decode("bad line"))`)).toBe("nil");
    expect(s!.run(`return NS.craftOrders.decode("X").off and "off" or "on"`)).toBe("off");
  });
});
