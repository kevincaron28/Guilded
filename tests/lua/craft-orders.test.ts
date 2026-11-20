import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

// Crafting orders in game (Modules/CraftOrders.lua, docs/plans/CRAFTING_ORDERS.md): Discord craft requests on
// the Crafting page: search an item and Request it, your requests (Cancel), and the orders for this character's
// recipes with Claim / Done / Give back from the game.
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
    UI, RUN, RELAYOUTS, TIPS = {}, {}, 0, {}
    HELPERS = { width = 582, ui = UI,
      newLabel = function(parent, text) local l = parent:CreateFontString(); l:SetText(text ~= "" and NS.L(text) or ""); return l end,
      newButton = function(parent, text, width, onClick) local b = CreateFrame("Button"); b:SetText(NS.L(text)); b:SetScript("OnClick", onClick); return b end,
      newEdit = function(parent, width, numeric) return CreateFrame("EditBox") end,
      at = function(widget) return widget end,
      placeholder = function(box, text) box.hint = text; return box end,
      itemBox = function(box) return box end,
      run = function(command) RUN[#RUN + 1] = command end,
      relayout = function() RELAYOUTS = RELAYOUTS + 1 end }
    VIEW = NS.craftOrders.buildCraftingPage(PAGE, HELPERS)
    PAGE.scripts.OnShow(PAGE)`);
}
const REQ = "VIEW.requestButton.scripts.OnClick(VIEW.requestButton)";
const tab = (id: string) => s!.run(`VIEW.sub = "${id}"; NS.craftOrders.refresh()`);
const forMe = () => (tab("craft"), s!.run(`local t = {} for _, row in ipairs(VIEW.forMeRows) do if row.frame.shown then t[#t + 1] = row.text.text end end return table.concat(t, "\\n")`));
const mine = () => (tab("mine"), s!.run(`local t = {} for _, row in ipairs(VIEW.mineRows) do if row.frame.shown then t[#t + 1] = row.text.text .. " " .. row.chips.text end end return table.concat(t, "\\n")`));
const found = () => (tab("request"), s!.run(`local t = {} for _, row in ipairs(VIEW.resultRows) do if row.frame.shown then t[#t + 1] = row.text.text end end return table.concat(t, "\\n")`));
const crafters = () => s!.run(`local t = {} for _, l in ipairs(VIEW.dCrafters) do if l.shown then t[#t + 1] = l.text end end return table.concat(t, "\\n")`);
const pick = (n: number) => s!.run(`VIEW.sub = "request"; NS.craftOrders.refresh(); local f = VIEW.resultRows[${n}].frame; f.scripts.OnClick(f)`);
const search = (text: string) => s!.run(`VIEW.box:SetText(${JSON.stringify(text)}); VIEW.box.scripts.OnEnterPressed(VIEW.box)`);
const sent = (kind: string) => s!.run(`local t = {} for _, m in ipairs(SENT) do if m.prefix == "GuildedOrd" and string.find(m.text, "^${kind}|") then t[#t + 1] = m.text end end return table.concat(t, "\\n")`);

describe("the Crafting page: requests for me", () => {
  it("lists the orders this character can craft, asked-of-you first, with reagents in the tooltip text", () => {
    setup();
    buildPage();
    expect(s!.run("return VIEW.sourceLabel.text")).toBe("From Discord, through your companion.");
    const shown = forMe().split("\n");
    // The asked order first (even without the recipe), then the craftable open ones; the Alchemy and taken orders stay out.
    expect(shown[0]).toContain("For you");
    expect(shown[0]).toContain("Odd Hat");
    expect(shown[1]).toContain("2x |cffffd100Brown Linen Shirt|r");
    expect(shown[1]).toContain("for Ann Walker");
    expect(shown[2]).toContain("Linen Belt");
    expect(shown).toHaveLength(3);
    expect(s!.run("return VIEW.forMeHeader.text")).toBe("Requests for me (3)");
    // 2 shirts x 3 cloth = 6 needed, 5 in bags (red); 2 thread needed, 1 in bags.
    expect(s!.run("return NS.craftOrders.reagentText(NS.craftOrders.list(false)[2].order)")).toBe("Reagents: |cffff40405/6|r Linen Cloth, |cffff40401/2|r Coarse Thread");
    expect(s!.run("return NS.craftOrders.reagentText(NS.craftOrders.list(false)[3].order)")).toBe("The requester brings the materials.");
    expect(s!.run("return VIEW.forMeRows[2].first.text .. '/' .. VIEW.forMeRows[2].second.text")).toBe("Claim/Done");
    // Show all adds the rest, greyed when the recipe is not yours.
    s!.run("VIEW.allButton.scripts.OnClick(VIEW.allButton)");
    expect(forMe()).toContain("Not in your recipes|r  1x |cffffd100Flask of the Titans|r");
    expect(forMe()).not.toContain("Woolen Cape");
  });

  it("claims in game, says it on GUILD, and shows Done / Give back until Discord has it", () => {
    setup();
    buildPage();
    tab("craft");
    s!.run("VIEW.forMeRows[2].first.scripts.OnClick(VIEW.forMeRows[2].first)");
    expect(s!.run("return NS.getDb().craftOrders.actions.req_shirt01.action")).toBe("claim");
    expect(sent("ACT")).toBe(`ACT|req_shirt01|claim|1800000000|${s!.run("return NS.craftOrders.myName()")}`);
    expect(s!.run("return MESSAGES[#MESSAGES]")).toContain("Order claimed");
    expect(forMe().split("\n")[0]).toContain("Yours - goes to Discord with your next sync");
    expect(s!.run("return VIEW.forMeRows[1].first.text .. '/' .. VIEW.forMeRows[1].second.text")).toBe("Done/Give back");
    // Giving back a claim that never reached Discord just forgets it.
    s!.run("VIEW.forMeRows[1].second.scripts.OnClick(VIEW.forMeRows[1].second)");
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
    expect(s!.run("return VIEW.sourceLabel.text")).toContain("turned crafting orders off");
    expect(forMe()).toBe("");
    // Nobody can request while orders are off.
    expect(s!.run(`local ok, why = NS.craftOrders.submit({ item = "Linen Belt", key = 7026 }); return why`)).toBe("Your officers turned crafting orders off.");
  });

  it("prints one login line for new orders you can make, unless the member turned alerts off", () => {
    setup();
    expect(s!.run("return tostring(NS.craftOrders.loginAlert())")).toBe("true");
    expect(s!.run("return MESSAGES[1]")).toBe("3 craft order(s) from Discord you can make: the Crafting page of the Guilded window (/guilded orders).");
    expect(s!.run("return tostring(NS.craftOrders.loginAlert())")).toBe("false");
    s!.run(`NS.commandHandlers.orders({ "alerts", "off" })
      GuildedOrders.orders[6] = { id = "req_new0006", key = 2580, item = "Shirt", qty = 1, status = "OPEN", by = "Gi", at = 1799999999 }`);
    expect(s!.run("return tostring(NS.craftOrders.loginAlert())")).toBe("false");
  });

  it("opens the Crafting page from /guilded orders", () => {
    setup();
    s!.run(`OPENED = nil; NS.openToolsPage = function(name) OPENED = name end; NS.commandHandlers.orders({})`);
    expect(s!.run("return OPENED")).toBe("Crafting");
  });

  it("is translated in French, German and Spanish", () => {
    for (const lang of ["fr", "de", "es"]) {
      setup({ lang });
      buildPage();
      expect(s!.run("return VIEW.forMeRows[2].first.text")).not.toBe("Claim");
      expect(s!.run("return VIEW.allButton.text")).not.toBe("Show all open orders");
      expect(s!.run("return VIEW.sourceLabel.text")).not.toBe("From Discord, through your companion.");
      expect(s!.run("return VIEW.onlineButton.text")).not.toBe("Crafter online now");
      expect(s!.run("return VIEW.searchButton.text")).not.toBe("Search");
      expect(s!.run("return VIEW.shareButton.text")).not.toBe("Share my recipes");
      expect(s!.run("return VIEW.mineHeader.text")).not.toContain("My requests");
      s!.close(); s = undefined;
    }
  });
});

describe("the Crafting page: sub-tabs", () => {
  it("has Request, My requests and Craft for the guild, one shown at a time", () => {
    setup();
    buildPage();
    expect(s!.run("local t = {} for _, b in ipairs(VIEW.tabs) do t[#t + 1] = b.subId end return table.concat(t, ',')")).toBe("request,mine,craft");
    expect(s!.run("return VIEW.sub .. tostring(VIEW.box.shown) .. tostring(VIEW.mineHeader.shown) .. tostring(VIEW.forMeHeader.shown)")).toBe("requesttruefalsefalse");
    s!.run("VIEW.tabs[2].scripts.OnClick(VIEW.tabs[2])");
    expect(s!.run("return VIEW.sub .. tostring(VIEW.box.shown) .. tostring(VIEW.mineHeader.shown) .. tostring(VIEW.forMeHeader.shown)")).toBe("minefalsetruefalse");
    s!.run("VIEW.tabs[3].scripts.OnClick(VIEW.tabs[3])");
    expect(s!.run("return VIEW.sub .. tostring(VIEW.box.shown) .. tostring(VIEW.mineHeader.shown) .. tostring(VIEW.forMeHeader.shown)")).toBe("craftfalsefalsetrue");
    expect(s!.run("return VIEW.tabs[3].text")).toContain("Craft for the guild");
  });

  it("is translated", () => {
    setup({ lang: "fr" });
    buildPage();
    expect(s!.run("return VIEW.tabs[3].text")).not.toContain("Craft for the guild");
    expect(s!.run("return VIEW.tabs[1].text")).not.toContain("Request");
  });
});

describe("the Crafting page: My requests status chips", () => {
  const mineOrder = (status: string, extra = "") => String.raw`GuildedOrders = { at = "2026-11-07T12:00:00.000Z", orders = {
    { id = "req_mine0001", ref = "g6a0b1c2d3", key = 2580, item = "Brown Linen Shirt", qty = 1, status = "${status}", by = NS.craftOrders.myName(), crafter = "Eve", character = "${extra}", asked = "", mats = false, note = "", at = 1799990000 } } }`;
  function withOrder(status: string, character = "") {
    setup({ file: false });
    s!.run(`local book = NS.recipes.book()
      book.names[2580] = "Brown Linen Shirt"
      book.people["Ann Walker"] = { Tailoring = { v = 1, keys = { 2580 } } }`);
    s!.run(mineOrder(status, character));
    buildPage();
  }
  const chips = () => (tab("mine"), s!.run("return VIEW.mineRows[1].chips.text"));

  it("walks Sent, On Discord, Claimed by X, Done and marks the current stage", () => {
    withOrder("OPEN");
    expect(chips()).toContain("|cff20c020[Sent]|r");
    expect(chips()).toContain("|cffffd100[On Discord, 2 can craft]|r");
    expect(chips()).toContain("|cff707070[Claimed]|r");
    s!.run(`GuildedOrders.orders[1].status = "CLAIMED"; GuildedOrders.orders[1].character = "Eve Stone"; NS.craftOrders.refresh()`);
    expect(chips()).toContain("|cffffd100[Claimed by Eve Stone]|r");
    s!.run(`GuildedOrders.orders[1].status = "DONE"; NS.craftOrders.refresh()`);
    expect(chips()).toContain("|cffffd100[Done by Eve Stone]|r");
  });

  it("shows only Sent for a request not on Discord yet", () => {
    setup();
    buildPage();
    s!.run(`NS.craftOrders.submit({ item = "Brown Linen Shirt", key = 2580 })`);
    expect(chips()).toContain("|cffffd100[Sent]|r");
    expect(chips()).toContain("|cff707070[Done]|r");
  });

  it("Mark received closes a done request here, sends nothing, and keeps Cancel for open ones", () => {
    withOrder("OPEN");
    tab("mine");
    expect(s!.run("return tostring(VIEW.mineRows[1].first.shown) .. tostring(VIEW.mineRows[1].second.shown)")).toBe("falsetrue");
    s!.run(`GuildedOrders.orders[1].status = "DONE"; GuildedOrders.orders[1].character = "Eve Stone"; NS.craftOrders.refresh()`);
    expect(s!.run("return tostring(VIEW.mineRows[1].first.shown) .. VIEW.mineRows[1].first.text .. tostring(VIEW.mineRows[1].second.shown)")).toBe("trueMark receivedfalse");
    s!.run("SENT = {}; VIEW.mineRows[1].first.scripts.OnClick(VIEW.mineRows[1].first)");
    expect(mine()).toBe("");
    expect(s!.run("return #SENT")).toBe("0");
    expect(s!.run("return tostring(NS.getDb().craftOrders.received.req_mine0001 ~= nil)")).toBe("true");
    expect(s!.run("return MESSAGES[#MESSAGES]")).toContain("Marked as received");
  });
});

describe("the Crafting page: Request tab (favourites, recent, tree, filter, detail)", () => {
  function withBook() {
    setup();
    s!.run(`local book = NS.recipes.book()
      book.names[2580], book.names[7026], book.names[2584], book.names[13510] = "Brown Linen Shirt", "Linen Belt", "Woolen Cape", "Flask of the Titans"
      book.people["Ann Walker"] = { Tailoring = { v = 1799990000, keys = { 2580 } } }
      book.people["Cy Ra"] = { Alchemy = { v = 1799990000, keys = { 13510 } } }
      ONLINE = {}; CLOCK = 0
      GetTime = function() CLOCK = CLOCK + 1; return CLOCK end   -- the roster cache is per GetTime stamp
      GetNumGuildMembers = function() return 2 end
      GetGuildRosterInfo = function(i) if i == 1 then return "Ann Walker", nil, nil, nil, nil, nil, nil, nil, ONLINE.ann end return "Cy Ra", nil, nil, nil, nil, nil, nil, nil, ONLINE.cy end`);
    buildPage();
  }
  const rowsText = () => found().split("\n");
  const reagents = () => s!.run("local t = {} for _, r in ipairs(VIEW.dReagents) do if r.frame.shown then t[#t + 1] = r.text.text end end return table.concat(t, ',')");

  it("groups the known recipes by profession; a click opens a group and a recipe fills the detail pane", () => {
    withBook();
    expect(rowsText()).toEqual(["|cffffd100+ Alchemy (1)|r", "|cffffd100+ Tailoring (3)|r"]);
    s!.run(`local f = VIEW.resultRows[2].frame; f.scripts.OnClick(f)`);
    expect(rowsText()).toHaveLength(5);
    expect(rowsText()[0]).toContain("+ Alchemy");
    expect(rowsText()[1]).toContain("- Tailoring");
    expect(rowsText()[2]).toContain("Brown Linen Shirt");
    s!.run(`local f = VIEW.resultRows[3].frame; f.scripts.OnClick(f)`);
    expect(s!.run("return VIEW.dTitle.text")).toContain("Brown Linen Shirt");
    expect(s!.run("return VIEW.dProf.text")).toBe("Tailoring");
    // The reagents of a recipe you know: have/need, times the quantity.
    expect(reagents()).toBe("|cff20ff205/3|r Linen Cloth,|cff20ff201/1|r Coarse Thread");
    s!.run(`VIEW.qtyBox:SetText("2"); NS.craftOrders.refresh()`);
    expect(reagents()).toContain("|cffff40405/6|r Linen Cloth");
  });

  it("keeps favourites and the last 10 recipes locally, shown first when nothing is typed", () => {
    withBook();
    search("shirt");
    s!.run("VIEW.dStar.scripts.OnClick(VIEW.dStar)");
    expect(s!.run("return #NS.craftOrders.favourites()")).toBe("1");
    expect(s!.run("return NS.craftOrders.favourites()[1].name .. NS.craftOrders.favourites()[1].key")).toBe("Brown Linen Shirt2580");
    s!.run(`VIEW.box:SetText(""); VIEW.query = ""; VIEW.results = {}; NS.craftOrders.refresh()`);
    expect(rowsText()[0]).toContain("Favourites (1)");
    expect(rowsText()[1]).toContain("Brown Linen Shirt");
    // Only the newest ten recipes stay as recent, without duplicates.
    for (let i = 1; i <= 12; i++) s!.run(`NS.craftOrders.addRecent({ name = "Recipe ${i}", key = ${1000 + i} })`);
    s!.run(`NS.craftOrders.addRecent({ name = "Recipe 12", key = 1012 })`);
    expect(s!.run("return #NS.craftOrders.recents()")).toBe("10");
    expect(s!.run("return NS.craftOrders.recents()[1].name")).toBe("Recipe 12");
    // Un-starring from the list's own star.
    s!.run(`NS.craftOrders.refresh(); local r = VIEW.resultRows[2]; r.star.scripts.OnClick(r.star)`);
    expect(s!.run("return #NS.craftOrders.favourites()")).toBe("0");
    // The saved lists are still there after the page is rebuilt (SavedVariables).
    buildPage();
    expect(rowsText().some((r) => r.includes("Recent (10)"))).toBe(true);
  });

  it("records a recipe as recent when it is requested", () => {
    withBook();
    search("belt");
    s!.run(REQ);
    expect(s!.run("return NS.craftOrders.recents()[1].name")).toBe("Linen Belt");
  });

  it("Crafter online now keeps recipes a guildmate who can make them has online", () => {
    withBook();
    s!.run(`ONLINE.ann = true`);
    s!.run("VIEW.onlineButton.scripts.OnClick(VIEW.onlineButton)");
    expect(rowsText()).toEqual(["|cffffd100+ Tailoring (1)|r"]);   // Ann is online; Cy and the recipes only you know are not
    expect(s!.run("return VIEW.onlineButton.text")).toContain("|cffffd100");
    s!.run(`ONLINE.ann = false; VIEW.browse = nil; NS.craftOrders.refresh()`);
    expect(rowsText()).toEqual([""]);
    expect(s!.run("return VIEW.leftNote.text")).toBe("Nobody who can craft these is online right now.");
    s!.run("VIEW.onlineButton.scripts.OnClick(VIEW.onlineButton)");
    expect(rowsText()).toHaveLength(2);
  });

  it("lists crafters in the detail pane with online state and last seen", () => {
    withBook();
    s!.run(`ONLINE.ann = true`);
    search("shirt");
    expect(crafters().split("\n")[1]).toMatch(/^Ann Walker {2}\|cff20ff20online\|r {2}\|cffaaaaaaTailoring\|r$/);
    s!.run(`ONLINE.ann = false; NS.getDb().crafterSeen = nil; NS.craftOrders.refresh()`);
    expect(crafters().split("\n")[1]).toContain("last seen unknown");
  });
});

describe("the Crafting page: materials toggle and the NEW line", () => {
  function withShirt() {
    setup();
    s!.run(`NS.recipes.book().names[2580] = "Brown Linen Shirt"`);
    buildPage();
    search("shirt");
  }
  it("says who brings the materials in the NEW line's existing materials field, which older addons already read", () => {
    withShirt();
    expect(s!.run("return VIEW.matsButton.text")).toBe("Materials: crafter provides");
    s!.run("VIEW.matsButton.scripts.OnClick(VIEW.matsButton)");
    expect(s!.run("return VIEW.matsButton.text")).toBe("Materials: I bring them");
    s!.run(REQ);
    const line = sent("NEW");
    expect(line).toMatch(/^NEW\|g[0-9a-f]+\|2580\|1\|1\|1800000000\|Tailoring\|\|Brown Linen Shirt\|$/);
    expect(s!.run("local r = NS.craftOrders.decodeRequest('" + line + "'); return tostring(r.mats) .. r.item")).toBe("trueBrown Linen Shirt");
    // The same number of bar-separated fields as before the toggle existed: an older addon parses it unchanged.
    expect(line.split("|")).toHaveLength(10);
    // Back to "crafter provides" for the next one.
    expect(s!.run("return VIEW.matsButton.text")).toBe("Materials: crafter provides");
  });

  it("sends 0 when the crafter provides them", () => {
    withShirt();
    s!.run(REQ);
    const line = sent("NEW");
    expect(line).toMatch(/\|2580\|1\|0\|1800000000\|/);
    expect(s!.run("return tostring(NS.craftOrders.decodeRequest('" + line + "').mats)")).toBe("false");
  });

  it("stores the choice in the saved request for the companion", () => {
    withShirt();
    s!.run("VIEW.matsButton.scripts.OnClick(VIEW.matsButton)");
    s!.run(REQ);
    expect(s!.run("local t = {} for _, v in pairs(NS.getDb().craftOrders.requests) do t[#t + 1] = tostring(v.mats) end return t[1]")).toBe("true");
  });
});

describe("the Crafting page: Craft for the guild shopping list", () => {
  const shop = () => s!.run("local t = {} for _, r in ipairs(VIEW.shopRows) do if r.frame.shown then t[#t + 1] = r.text.text end end return table.concat(t, '|')");
  function withClaims() {
    setup();
    s!.run(`GuildedOrders.orders[#GuildedOrders.orders + 1] = { id = "req_shirt02", key = 2580, item = "Brown Linen Shirt", qty = 1, prof = "Tailoring", status = "OPEN", by = "Gil Ho", crafter = "", character = "", asked = "", mats = false, note = "", at = 1799990500 }`);
    buildPage();
    tab("craft");
  }

  it("sums the reagents of the orders you claimed, with have/need from your bags", () => {
    withClaims();
    expect(s!.run("return VIEW.shopHeader.text")).toBe("Shopping list (0)");
    expect(s!.run("return VIEW.shopNote.text")).toBe("Claim an order and its reagents add up here.");
    s!.run(`NS.craftOrders.act("req_shirt01", "claim"); NS.craftOrders.act("req_shirt02", "claim")`);
    // 2 + 1 shirts: 3 Linen Cloth and 1 Coarse Thread each. Bags: 5 cloth, 1 thread.
    expect(s!.run("return VIEW.shopHeader.text")).toBe("Shopping list (2)");
    expect(shop()).toBe("|cffff40401/3|r Coarse Thread  |cffff40402 to get|r||cffff40405/9|r Linen Cloth  |cffff40404 to get|r");   // what is missing first, then by name
  });

  it("leaves out orders whose requester brings the materials, and finished or unclaimed ones", () => {
    withClaims();
    s!.run(`NS.craftOrders.act("req_belt002", "claim")`);   // the belt order says the requester brings the materials
    expect(s!.run("return VIEW.shopHeader.text")).toBe("Shopping list (0)");
    s!.run(`NS.craftOrders.act("req_shirt01", "claim"); BAGS[2589] = 9; BAGS[2320] = 3; NS.craftOrders.refresh()`);
    expect(shop()).toContain("|cff20ff209/6|r Linen Cloth");
    s!.run(`NS.craftOrders.act("req_shirt01", "done"); NS.craftOrders.refresh()`);
    expect(s!.run("return VIEW.shopHeader.text")).toBe("Shopping list (0)");
  });

  it("says when a claimed order's reagents are not known yet, and sums nothing for it", () => {
    withClaims();
    s!.run(`NS.craftOrders.act("req_flask03", "claim")`);   // an alchemy order: this character has not read the recipe
    expect(s!.run("return VIEW.shopHeader.text")).toBe("Shopping list (0)");
    expect(s!.run("return VIEW.shopNote.text")).toContain("1 claimed order(s) have no reagents yet");
    const list = JSON.parse(s!.run(`local l = NS.craftOrders.shoppingList(); return '{"orders":' .. l.orders .. ',"unknown":' .. l.unknown .. ',"rows":' .. #l.rows .. '}'`));
    expect(list).toEqual({ orders: 1, unknown: 1, rows: 0 });
  });

  it("puts the number of requests you can craft on the Craft for the guild sub-tab", () => {
    setup();
    buildPage();
    // Open orders this character can make (shirt, belt) plus the one asked of them (odd hat).
    expect(s!.run("return VIEW.tabs[3].text")).toContain("(3)");
    s!.run(`NS.craftOrders.act("req_shirt01", "claim"); NS.craftOrders.refresh()`);
    expect(s!.run("return VIEW.tabs[3].text")).toContain("(2)");
  });
});

describe("the Crafting page: search and Request", () => {
  function withCrafters() {
    setup();
    s!.run(`local book = NS.recipes.book()
      book.names[2580], book.names[7026], book.names[2584] = "Brown Linen Shirt", "Linen Belt", "Woolen Cape"
      book.people["Ann Walker"] = { Tailoring = { v = 1799990000, keys = { 2580 } } }`);
    buildPage();
  }

  it("shows who can craft the item you typed, you first", () => {
    withCrafters();
    expect(found()).toContain("Tailoring (3)");   // nothing typed: the professions, closed
    search("shirt");
    expect(found()).toContain("|cffffd100Brown Linen Shirt|r");
    expect(crafters()).toMatch(/you {2}\|cff20ff20online[^\n]*\nAnn Walker/);
    search("linen");
    expect(found().split("\n")).toHaveLength(2);
    // A shift-clicked link finds the item by its id.
    search("|cff1eff00|Hitem:7026::::::::60:|h[Linen Belt]|h|r");
    expect(found().split("\n")).toHaveLength(1);
    expect(found()).toContain("Linen Belt");
    // Nobody known: still requestable by name.
    search("Mooncloth Bag");
    expect(found()).toContain("Mooncloth Bag");
    expect(crafters()).toContain("nobody known");
  });

  it("sends one request on GUILD, keeps it, and lists it under My requests", () => {
    withCrafters();
    search("shirt");
    s!.run("VIEW.requestButton.scripts.OnClick(VIEW.requestButton)");
    const request = s!.run(`local t = {} for _, v in pairs(NS.getDb().craftOrders.requests) do t[#t + 1] = v.ref .. "|" .. v.item .. "|" .. v.key .. "|" .. v.qty .. "|" .. v.character end return t[1]`);
    expect(request).toMatch(/^g[0-9a-f]+\|Brown Linen Shirt\|2580\|1\|/);
    const ref = request.split("|")[0];
    expect(sent("NEW")).toBe(`NEW|${ref}|2580|1|0|1800000000|Tailoring||Brown Linen Shirt|`);
    expect(s!.run("return MESSAGES[#MESSAGES]")).toContain("Asked the guild for 1x Brown Linen Shirt");
    expect(mine()).toContain("Brown Linen Shirt");
    expect(mine()).toContain("[Sent]");
    expect(s!.run("return VIEW.mineHeader.text")).toBe("My requests (1)");
    // The same item again right away is refused, and nothing more is sent.
    search("shirt");
    s!.run("VIEW.requestButton.scripts.OnClick(VIEW.requestButton)");
    expect(s!.run("return MESSAGES[#MESSAGES]")).toBe("You just asked for that.");
    expect(sent("NEW").split("\n")).toHaveLength(1);
  });

  it("takes quantity, a note and one asked crafter from the detail pane, and drops an asked name that cannot craft it", () => {
    withCrafters();
    search("linen");   // Brown Linen Shirt (Ann can make it) and Linen Belt (only you)
    expect(s!.run("return tostring(VIEW.qtyBox.shown) .. tostring(VIEW.askButton.shown)")).toBe("falsefalse");   // nothing picked yet
    pick(1);
    expect(s!.run("return tostring(VIEW.qtyBox.shown) .. tostring(VIEW.askButton.shown)")).toBe("truetrue");
    s!.run(`VIEW.qtyBox:SetText("3"); VIEW.noteBox:SetText("Tip | 5g")
      VIEW.askButton.scripts.OnClick(VIEW.askButton)`);
    expect(s!.run("return VIEW.askButton.text")).toBe("Ask: Ann Walker");
    // Asking Ann for an item she cannot make leaves it open to anyone.
    s!.run(`VIEW.sel = { key = 7026, name = "Linen Belt", prof = "Tailoring" }; ${REQ}`);
    expect(sent("NEW")).toMatch(/\|7026\|3\|0\|1800000000\|Tailoring\|\|Linen Belt\|Tip {3}5g$/);
    // The options are for that one request: quantity, note and the asked crafter start over.
    expect(s!.run("return VIEW.qtyBox.text .. '|' .. VIEW.noteBox.text .. '|' .. VIEW.askButton.text")).toBe("1||Ask: anyone");
    pick(1);
    s!.run(`VIEW.askButton.scripts.OnClick(VIEW.askButton)
      ${REQ}`);
    expect(sent("NEW").split("\n")[1]).toMatch(/\|2580\|1\|0\|1800000000\|Tailoring\|Ann Walker\|Brown Linen Shirt\|$/);
  });

  it("allows five open requests, and nothing in combat, outside a guild, or without a name", () => {
    withCrafters();
    for (let i = 1; i <= 5; i++) {
      expect(s!.run(`return tostring(NS.craftOrders.submit({ item = "Item number ${i}" }) ~= nil)`)).toBe("true");
    }
    expect(s!.run(`local ok, why = NS.craftOrders.submit({ item = "One more" }); return tostring(ok) .. ":" .. why`)).toBe("nil:You already have 5 open craft requests.");
    s!.close();
    withCrafters();
    s!.run("InCombatLockdown = function() return true end");
    expect(s!.run(`local ok, why = NS.craftOrders.submit({ item = "Linen Belt" }); return tostring(ok) .. ":" .. why`)).toBe("nil:You can request a craft after combat.");
    s!.run("InCombatLockdown = function() return false end; IsInGuild = function() return false end");
    expect(s!.run(`local ok, why = NS.craftOrders.submit({ item = "Linen Belt" }); return why`)).toBe("Join a guild to request a craft.");
    s!.run("IsInGuild = function() return true end");
    expect(s!.run(`local ok, why = NS.craftOrders.submit({ item = " " }); return why`)).toBe("Name the item you want crafted.");
    expect(sent("NEW")).toBe("");
  });

  it("becomes the real order once the feed has its ref, and Cancel goes to Discord as an action", () => {
    withCrafters();
    s!.run(`NS.craftOrders.submit({ item = "Brown Linen Shirt", key = 2580, prof = "Tailoring" })
      REF = next(NS.getDb().craftOrders.requests)`);
    s!.run(`GuildedOrders.orders[#GuildedOrders.orders + 1] = { id = "req_mine0007", ref = REF, key = 2580, item = "Brown Linen Shirt", qty = 1, prof = "Tailoring", status = "OPEN",
      by = NS.craftOrders.myName(), crafter = "", character = "", asked = "", mats = false, note = "", at = 1799999999 }
      NS.craftOrders.refresh()`);
    expect(mine()).not.toContain("Sent.");
    expect(mine().split("\n")).toHaveLength(1);
    // Mine only: it is not also listed under Requests for me.
    expect(forMe()).not.toContain("req_mine0007");
    expect(forMe().match(/Brown Linen Shirt/g)).toHaveLength(1);
    expect(s!.run("return tostring(VIEW.mineRows[1].second.shown) .. VIEW.mineRows[1].second.text")).toBe("trueCancel");
    s!.run("VIEW.mineRows[1].second.scripts.OnClick(VIEW.mineRows[1].second)");
    expect(s!.run("return NS.getDb().craftOrders.actions.req_mine0007.action")).toBe("cancel");
    expect(sent("ACT")).toMatch(/^ACT\|req_mine0007\|cancel\|1800000000\|/);
    expect(s!.run("return MESSAGES[#MESSAGES]")).toContain("Request cancelled");
    expect(mine()).toBe("");
    // Discord shows it cancelled (gone from the feed): the waiting action is dropped.
    s!.run(`GuildedOrders.orders[#GuildedOrders.orders].status = "CANCELLED"; NS.craftOrders.prune()`);
    expect(s!.run("return tostring(NS.getDb().craftOrders.actions.req_mine0007)")).toBe("nil");
    // Only the requester can cancel; someone else's order is refused.
    expect(s!.run(`local ok, why = NS.craftOrders.act("req_belt002", "cancel"); return why`)).toBe("Only the member who asked can cancel a request.");
  });

  it("sizes the page for its blocks and keeps Advanced and the share button working", () => {
    withCrafters();
    const base = Number(s!.run("return VIEW.height()"));
    expect(base).toBeGreaterThan(150);
    search("linen");
    pick(1);
    expect(Number(s!.run("return VIEW.height()"))).toBeGreaterThan(150);
    expect(Number(s!.run("return RELAYOUTS"))).toBeGreaterThan(0);
    expect(s!.run("return tostring(VIEW.professions.shown)")).toBe("false");
    s!.run("VIEW.advancedButton.scripts.OnClick(VIEW.advancedButton)");
    expect(s!.run("return tostring(VIEW.professions.shown) .. tostring(VIEW.alertsButton.shown)")).toBe("truetrue");
    expect(s!.run("return UI.craftHeight()")).toBe(s!.run("return VIEW.height()"));
    s!.run("VIEW.alertsButton.scripts.OnClick(VIEW.alertsButton)");
    expect(s!.run("return VIEW.alertsButton.text")).toBe("Order alerts: off");
    s!.run("VIEW.shareButton.scripts.OnClick(VIEW.shareButton)");
    expect(s!.run("return RUN[1]")).toBe("recipes share");
  });
});

describe("requests heard from guildmates", () => {
  const ref = "g6a0b1c2d3";
  const message = `NEW|${ref}|2580|2|1|1799999900||Eve Stone|Brown Linen Shirt|Tip 5g`;

  it("keeps one copy per sender and tells a crafter once, and lists it for the crafter until Discord has it", () => {
    setup();
    buildPage();
    s!.run(`MESSAGES = {}; fire_event("CHAT_MSG_ADDON", "GuildedOrd", ${JSON.stringify(message)}, "GUILD", "Ann Walker")
      fire_event("CHAT_MSG_ADDON", "GuildedOrd", ${JSON.stringify(message)}, "GUILD", "Ann Walker")`);
    expect(s!.run(`local n = 0 for _ in pairs(NS.getDb().craftOrders.heardRequests) do n = n + 1 end return n`)).toBe("1");
    expect(s!.run("return #MESSAGES")).toBe("1");
    expect(s!.run("return MESSAGES[1]")).toBe("Ann Walker asks for 2x Brown Linen Shirt. Open Guilded, Crafting.");
    expect(forMe()).toContain("not on Discord yet");
    expect(forMe()).toContain("Brown Linen Shirt");
    // Once the feed has an order with that ref, the heard copy is not listed again.
    s!.run(`GuildedOrders.orders[#GuildedOrders.orders + 1] = { id = "req_ann00008", ref = "${ref}", key = 2580, item = "Brown Linen Shirt", qty = 2, status = "OPEN", by = "Ann Walker", at = 1799999950 }
      NS.craftOrders.refresh()`);
    expect(forMe().match(/Brown Linen Shirt/g)).toHaveLength(2);   // the real order and the earlier one, not three
  });

  it("ignores malformed, stale, own and non-guild requests", () => {
    setup();
    const heard = () => s!.run(`local n = 0 for _ in pairs(NS.getDb().craftOrders.heardRequests) do n = n + 1 end return n`);
    for (const [text, sender] of [["NEW|x|2580|1|0|1799999900|||Item|", "Ann Walker"], ["NEW|g6a0b1c2d3|2580|1|0|1799999900||Eve|I|", "Stranger"],
      ["NEW|g6a0b1c2d3|2580|1|0|1799999900||Eve|I", "Ann Walker"], ["NEW|g6a0b1c2d3|2580|1|0|1500000000||Eve|Old item|", "Ann Walker"],
      ["NEW|g6a0b1c2d3|2580|1|0|1799999900||Eve|X|", "Ann Walker"]]) {
      s!.run(`fire_event("CHAT_MSG_ADDON", "GuildedOrd", ${JSON.stringify(text)}, "GUILD", ${JSON.stringify(sender)})`);
    }
    expect(heard()).toBe("0");
    s!.run(`fire_event("CHAT_MSG_ADDON", "GuildedOrd", "NEW|g6a0b1c2d3|2580|1|0|1799999900||Eve|Brown Linen Shirt|", "GUILD", "${s!.run("return NS.playerName()")}")`);
    expect(heard()).toBe("0");
  });

  it("round-trips the message the sender builds", () => {
    setup();
    const row = `{ ref = "gabc123def", key = 2580, qty = 4, mats = true, at = 1799999900, prof = "Tailoring", asked = "Eve Stone", item = "Brown Linen Shirt", note = "A;B%C" }`;
    const back = s!.run(`local d = NS.craftOrders.decodeRequest(NS.craftOrders.encodeRequest(${row}))
      return table.concat({ d.ref, d.key, d.qty, tostring(d.mats), d.prof, d.asked, d.item, d.note }, "|")`);
    expect(back).toBe("gabc123def|2580|4|true|Tailoring|Eve Stone|Brown Linen Shirt|A;B%C");
    // A long note is dropped, never the item, to stay inside one addon message.
    const long = s!.run(`return NS.craftOrders.encodeRequest({ ref = "gabc123def", key = 2580, qty = 1, at = 1799999900, prof = "Tailoring", asked = string.rep("a", 80), item = string.rep("b", 80), note = string.rep("c", 80) })`);
    expect(long.length).toBeLessThanOrEqual(250);
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
    expect(s!.run("return VIEW.sourceLabel.text")).toBe("Shared by Kev Caron (from Discord).");
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
    expect(s!.run(`local c = NS.craftOrders.decode(NS.craftOrders.encode(NS.craftOrders.current())); local by = {}; for _, o in ipairs(c.orders) do by[o.id] = o end; return by.req_belt002.item .. "|" .. tostring(by.req_belt002.mats) .. "|" .. by.req_cloak04.status`))
      .toBe("Linen Belt|true|CLAIMED");
    expect(s!.run(`return tostring(NS.craftOrders.decode("bad line"))`)).toBe("nil");
    expect(s!.run(`return NS.craftOrders.decode("X").off and "off" or "on"`)).toBe("off");
  });
});

describe("the Crafting page: review fixes", () => {
  const FEED_LATER = `GuildedOrders = { at = "2027-01-15T07:59:00.000Z", orders = {} }`;   // the clock is 2027-01-15T08:00:00Z
  function withMe() {
    setup();
    s!.run(`local book = NS.recipes.book()
      book.names[2580], book.names[7026] = "Brown Linen Shirt", "Linen Belt"
      book.people["Ann Walker"] = { Tailoring = { v = 1799990000, keys = { 2580 } } }`);
    buildPage();
  }
  const requests = () => Number(s!.run(`local n = 0 for _ in pairs(NS.getDb().craftOrders.requests) do n = n + 1 end return n`));

  it("settles a request Discord showed and then dropped, so finished requests never come back or block new ones", () => {
    withMe();
    for (let i = 1; i <= 5; i++) s!.run(`NS.craftOrders.submit({ item = "Item number ${i}" })`);
    expect(requests()).toBe(5);
    // Discord shows all five (mine, by name) ...
    s!.run(`GuildedOrders.at = "2026-11-08T00:00:00.000Z"
      local n = 0
      for ref, r in pairs(NS.getDb().craftOrders.requests) do
        n = n + 1
        GuildedOrders.orders[#GuildedOrders.orders + 1] = { id = "req_own000" .. n, ref = ref, item = r.item, qty = 1, status = "OPEN", by = NS.craftOrders.myName(), at = 1799999999 }
      end
      NS.craftOrders.refresh()`);
    expect(s!.run("return #VIEW.mineRows")).toBe("8");
    expect(mine()).not.toContain("|cffffd100[Sent]");   // on Discord now: Sent is passed, not current
    // ... then they are done or cancelled there and leave the feed.
    s!.run(`GuildedOrders.at = "2026-11-09T00:00:00.000Z"
      for i = #GuildedOrders.orders, 6, -1 do table.remove(GuildedOrders.orders, i) end
      GuildedOrders.orders = { table.unpack(GuildedOrders.orders, 1, 5) }
      for i = 1, #GuildedOrders.orders do GuildedOrders.orders[i].status = nil end
      GuildedOrders.orders = {}
      NS.craftOrders.refresh()`);
    expect(requests()).toBe(0);
    expect(mine()).toBe("");
    expect(s!.run(`return tostring(NS.craftOrders.submit({ item = "A new one" }) ~= nil)`)).toBe("true");
  });

  it("settles a request the feed never showed once a feed 6 hours newer still lacks it, but not before", () => {
    withMe();
    s!.run(`NS.craftOrders.submit({ item = "Linen Belt", key = 7026 })
      for _, r in pairs(NS.getDb().craftOrders.requests) do r.at = 1800000000 - 7 * 3600 end`);
    s!.run(`GuildedOrders = { at = "2027-01-15T06:30:00.000Z", orders = {} }; NS.craftOrders.refresh()`);   // not yet 6 h after the request
    expect(requests()).toBe("1");
    s!.run(`${FEED_LATER}; NS.craftOrders.refresh()`);
    expect(requests()).toBe(0);
  });

  it("keeps a request a guildmate's relayed feed (newer, without its ref) does not show: only the companion's own feed settles by absence", () => {
    setup({ file: false });
    s!.run(`NS.craftOrders.submit({ item = "Linen Belt", key = 7026 })
      for _, r in pairs(NS.getDb().craftOrders.requests) do r.at = 1800000000 - 7 * 3600 end
      fire_event("CHAT_MSG_ADDON", "GuildedOrd", "ORDERS|2027-01-15T07:59:00.000Z|1|1|E", "GUILD", "Kev Caron")`);
    expect(s!.run("return NS.craftOrders.current().source")).toBe("guild");
    expect(requests()).toBe("1");
  });

  it("a cancelled order drops its local request at once (nothing is re-said or uploaded for it)", () => {
    withMe();
    s!.run(`NS.craftOrders.submit({ item = "Brown Linen Shirt", key = 2580 })
      REF = next(NS.getDb().craftOrders.requests)
      GuildedOrders.orders[#GuildedOrders.orders + 1] = { id = "req_mine0009", ref = REF, key = 2580, item = "Brown Linen Shirt", qty = 1, status = "OPEN", by = NS.craftOrders.myName(), at = 1799999999 }
      NS.craftOrders.act("req_mine0009", "cancel")`);
    expect(requests()).toBe(0);
  });

  it("gives a request that is not on Discord yet a Cancel button that takes it back", () => {
    withMe();
    search("shirt");
    s!.run("VIEW.requestButton.scripts.OnClick(VIEW.requestButton)");
    tab("mine");
    expect(s!.run("return tostring(VIEW.mineRows[1].second.shown) .. VIEW.mineRows[1].second.text")).toBe("trueCancel");
    s!.run("VIEW.mineRows[1].second.scripts.OnClick(VIEW.mineRows[1].second)");
    expect(requests()).toBe(0);
    expect(mine()).toBe("");
    expect(s!.run("return MESSAGES[#MESSAGES]")).toContain("Request withdrawn");
    // Nothing is said again at login for it.
    s!.run("SENT = {}; fire_event('PLAYER_ENTERING_WORLD')");
    expect(sent("NEW")).toBe("");
  });

  it("a copied ref cannot hide someone else's request, mine or a guildmate's", () => {
    withMe();
    s!.run(`NS.craftOrders.submit({ item = "Brown Linen Shirt", key = 2580 })
      REF = next(NS.getDb().craftOrders.requests)
      GuildedOrders.orders[#GuildedOrders.orders + 1] = { id = "req_copy0010", ref = REF, key = 2580, item = "Brown Linen Shirt", qty = 1, status = "OPEN", by = "Mallory Evil", at = 1799999999 }
      fire_event("CHAT_MSG_ADDON", "GuildedOrd", "NEW|g6a0b1c2d3|2580|1|0|1799999900|||Brown Linen Shirt|", "GUILD", "Ann Walker")
      GuildedOrders.orders[#GuildedOrders.orders + 1] = { id = "req_copy0011", ref = "g6a0b1c2d3", key = 2580, item = "Brown Linen Shirt", qty = 1, status = "OPEN", by = "Mallory Evil", at = 1799999999 }
      NS.craftOrders.refresh()`);
    expect(mine()).toContain("[Sent]");                     // still my own pending row
    expect(s!.run("return #NS.craftOrders.heardForMe()")).toBe("1");   // Ann's request is still listed
    expect(s!.run(`return tostring(NS.craftOrders.isMyRequest({ ref = REF, by = "Mallory Evil" }))`)).toBe("false");
  });

  it("cuts text on character boundaries and keeps the asked crafter's full name", () => {
    withMe();
    const accented = `a${"\\195\\169".repeat(40)}`;   // 81 bytes: a, then 40 two-byte letters
    const row = s!.run(`local r = NS.craftOrders.submit({ item = "${accented}" }); return r.item .. "|" .. #r.item`);
    expect(row.endsWith("|59")).toBe(true);                  // cut before the half character, not in it
    search("shirt");
    s!.run("VIEW.askButton.scripts.OnClick(VIEW.askButton)");
    s!.run("VIEW.requestButton.scripts.OnClick(VIEW.requestButton)");
    expect(sent("NEW").split("\n").pop()).toContain("|Ann Walker|Brown Linen Shirt|");
  });

  it("refreshes the results for a shift-clicked link even when the game says it was not typed", () => {
    withMe();
    s!.run(`VIEW.box:SetText("|cff1eff00|Hitem:2580::::::::60:|h[Brown Linen Shirt]|h|r"); VIEW.box.scripts.OnTextChanged(VIEW.box, false)`);
    expect(found()).toContain("Brown Linen Shirt");
  });
});

describe("requests heard from guildmates: limits and clean-up", () => {
  const heard = (ref: string, sender: string, extra = "") =>
    `fire_event("CHAT_MSG_ADDON", "GuildedOrd", "NEW|${ref}|2580|1|0|1799999900||${extra}|Brown Linen Shirt|", "GUILD", "${sender}")`;

  it("keeps five per sender (replacing only that sender's oldest) and alerts once per sender per 30 seconds", () => {
    setup();
    s!.run(`MESSAGES = {}
      fire_event("CHAT_MSG_ADDON", "GuildedOrd", "NEW|g6a0b1c2d3|2580|1|0|1799999900|||Item of Bo|", "GUILD", "Bo Dee")`);
    for (let i = 0; i < 7; i++) s!.run(`fire_event("CHAT_MSG_ADDON", "GuildedOrd", "NEW|gaaaaa${i}|2580|1|0|${1799999000 + i}|||Brown Linen Shirt|", "GUILD", "Ann Walker")`);
    const count = (name: string) => Number(s!.run(`local n = 0 for _, v in pairs(NS.getDb().craftOrders.heardRequests) do if v.name == "${name}" then n = n + 1 end end return n`));
    expect(count("Ann Walker")).toBe(5);
    expect(count("Bo Dee")).toBe("1");
    expect(s!.run(`return tostring(NS.getDb().craftOrders.heardRequests["gaaaaa0@Ann Walker"])`)).toBe("nil");   // her oldest went
    expect(s!.run(`return tostring(NS.getDb().craftOrders.heardRequests["gaaaaa6@Ann Walker"] ~= nil)`)).toBe("true");
    // Ann made seven and Bo one: Ann alerted once (the 30 s gap), Bo once.
    expect(s!.run("return #MESSAGES")).toBe("2");
    s!.run(`GetServerTime = function() return 1800000031 end
      ${heard("gbbbbb1", "Ann Walker")}`);
    expect(s!.run("return #MESSAGES")).toBe("3");
  });

  it("clamps a time far ahead to a minute from now, and cleans prof, asked and note like the item", () => {
    setup();
    s!.run(`fire_event("CHAT_MSG_ADDON", "GuildedOrd", "NEW|g6a0b1c2d3|2580|1|0|1900000000|Tai%0Aloring|Eve%0AStone|Brown Linen Shirt|No%0Ate", "GUILD", "Ann Walker")`);
    expect(s!.run(`local v = NS.getDb().craftOrders.heardRequests["g6a0b1c2d3@Ann Walker"]; return v.at .. "|" .. v.prof .. "|" .. v.asked .. "|" .. v.note`))
      .toBe("1800000060|Tai loring|Eve Stone|No te");
  });
});

describe("the orders relay carries the request refs", () => {
  it("shares refs beside the order lines, in any order of arrival, without changing the order layout", () => {
    setup();
    s!.run(`GuildedOrders.orders[#GuildedOrders.orders + 1] = { id = "req_ref00012", ref = "g6a0b1c2d3", key = 2580, item = "Brown Linen Shirt", qty = 1, status = "OPEN", by = "Ann Walker", at = 1799999999 }`);
    expect(s!.run("return tostring(NS.craftOrders.share())")).toBe("true");
    const parts = s!.run(`local t = {} for _, m in ipairs(SENT) do if string.find(m.text, "^ORDERS|") then t[#t + 1] = m.text end end return table.concat(t, "\\0")`).split("\0");
    expect(parts.every((p) => !p.includes("g6a0b1c2d3"))).toBe(true);   // older addons decode these lines exactly as before
    const refs = sent("ORDREFS");
    expect(refs).toMatch(/^ORDREFS\|2026-11-07T12:00:00\.000Z\|req_ref00012:g6a0b1c2d3$/);
    for (const order of ["orders-first", "refs-first"]) {
      s!.close();
      setup({ file: false });
      const feed = order === "orders-first" ? [...parts, refs] : [refs, ...parts];
      for (const text of feed) s!.run(`fire_event("CHAT_MSG_ADDON", "GuildedOrd", ${JSON.stringify(text)}, "GUILD", "Kev Caron")`);
      expect(s!.run(`for _, o in ipairs(NS.craftOrders.current().orders) do if o.id == "req_ref00012" then return o.ref end end`), order).toBe("g6a0b1c2d3");
    }
  });

  it("keeps 119 of a 120-order list with one bad line, and caps the list at 500 newest first", () => {
    setup();
    const lines = Array.from({ length: 120 }, (_, i) => `req_n${i};2580;1;O;${1799990000 + i};0;Item${i};By;;;;Tailoring;`);
    lines[50] = "garbage line";
    expect(s!.run(`return #NS.craftOrders.decode(${JSON.stringify(lines.join(String.fromCharCode(10)))}).orders`)).toBe("119");
    s!.run(`local rows = {}; for i = 1, 700 do rows[i] = { id = "req_m" .. i, key = 2580, qty = 1, status = "OPEN", at = 1799000000 + i, item = "I", by = "B", prof = "Tailoring" } end
      BIG = NS.craftOrders.encode({ orders = rows })`);
    // Newest first: whatever fits the parts is the newest, and the decoder takes at most 500.
    expect(s!.run(`local c = NS.craftOrders.decode(BIG); return tostring(#c.orders <= 500) .. "," .. c.orders[#c.orders].id`)).toBe("true,req_m700");
  });
});

describe("the Crafting page: scrolling list (20 Nov 2026 polish)", () => {
  function withMany() {
    setup();
    // 40 recipes shared by Ann: a list far longer than the 14 rows.
    s!.run(`local book = NS.recipes.book()
      local keys = {}
      for i = 1, 40 do book.names[5000 + i] = string.format("Gizmo %02d", i); keys[i] = 5000 + i end
      book.people["Ann Walker"] = { Engineering = { v = 1799990000, keys = keys } }
      GetNumGuildMembers = function() return 0 end`);
    buildPage();
    s!.run(`VIEW.expanded.Engineering = true; VIEW.browse = nil; NS.craftOrders.refresh()`);
  }
  const rows = () => s!.run(`local t = {} for _, row in ipairs(VIEW.resultRows) do if row.frame.shown then t[#t + 1] = row.text.text end end return table.concat(t, "\\n")`).split("\n");

  it("shows a window of the list and scrolls with the wheel and the page buttons", () => {
    withMany();
    expect(rows()).toHaveLength(14);
    expect(rows()[0]).toContain("- Engineering (40)");
    expect(s!.run("return VIEW.more.text")).toBe("Showing 1-14 of 42. Scroll with the mouse wheel.");
    expect(s!.run("return tostring(VIEW.scrollDown.shown)")).toBe("true");
    // The wheel moves three items; it cannot pass the top or the end of the list.
    s!.run(`local f = VIEW.resultRows[1].frame; f.scripts.OnMouseWheel(f, -1)`);
    expect(rows()[0]).toContain("Gizmo 03");
    s!.run(`local f = VIEW.resultRows[1].frame; f.scripts.OnMouseWheel(f, 1); f.scripts.OnMouseWheel(f, 1)`);
    expect(rows()[0]).toContain("- Engineering");
    s!.run("for i = 1, 4 do VIEW.scrollDown.scripts.OnClick(VIEW.scrollDown) end");
    expect(rows()[13]).toContain("Tailoring");
    expect(s!.run("return VIEW.more.text")).toBe("Showing 29-42 of 42. Scroll with the mouse wheel.");
    s!.run("VIEW.scrollUp.scripts.OnClick(VIEW.scrollUp)");
    expect(rows()[0]).toContain("Gizmo 1");
  });

  it("a row far down the list is reachable and picks its recipe", () => {
    withMany();
    s!.run("VIEW.scrollBy(30)");
    const index = rows().findIndex((r) => r.includes("Gizmo 35"));
    expect(index).toBeGreaterThanOrEqual(0);
    s!.run(`local f = VIEW.resultRows[${index + 1}].frame; f.scripts.OnClick(f)`);
    expect(s!.run("return VIEW.dTitle.text")).toContain("Gizmo 35");
    expect(s!.run("return VIEW.sel.key")).toBe("5035");
  });

  it("the Fav button keeps the recipe without picking the row, and a short list has no scroll buttons", () => {
    withMany();
    s!.run("VIEW.scrollBy(2)");
    s!.run(`local r = VIEW.resultRows[1]; r.star.scripts.OnClick(r.star)`);
    expect(s!.run("return #NS.craftOrders.favourites()")).toBe("1");
    expect(s!.run("return tostring(VIEW.sel == nil)")).toBe("true");
    search("gizmo 07");
    expect(s!.run("return tostring(VIEW.scrollDown.shown)")).toBe("false");
    expect(s!.run("return tostring(VIEW.more.shown)")).toBe("false");
  });

  it("filters as you type, resets the scroll, and keeps more than the visible rows of matches", () => {
    withMany();
    s!.run("VIEW.scrollBy(20)");
    s!.run(`VIEW.box:SetText("gizmo"); VIEW.box.scripts.OnTextChanged(VIEW.box, true)`);
    expect(rows()).toHaveLength(14);
    expect(rows()[0]).toContain("Gizmo 01");
    expect(s!.run("return VIEW.more.text")).toContain("of 40");
    s!.run(`VIEW.box:SetText("gizmo 3"); VIEW.box.scripts.OnTextChanged(VIEW.box, true)`);
    expect(rows().some((r) => r.includes("Gizmo 01"))).toBe(false);
    // The Search button stays harmless: it repeats the same search.
    s!.run("VIEW.searchButton.scripts.OnClick(VIEW.searchButton)");
    expect(rows().some((r) => r.includes("Gizmo 3"))).toBe(true);
  });

  it("a wrapped title pushes the profession line down (no overlap)", () => {
    withMany();
    s!.run(`VIEW.dProf.SetPoint = function(self, _, _, _, x, y) self.y = y end`);
    search("gizmo 07");
    const oneLine = Number(s!.run("return VIEW.dProf.y"));
    s!.run(`VIEW.dTitle.GetStringHeight = function() return 36 end; NS.craftOrders.refresh()`);
    expect(Number(s!.run("return VIEW.dProf.y"))).toBeLessThan(oneLine);
  });
});
