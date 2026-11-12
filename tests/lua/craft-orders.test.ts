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
const forMe = () => s!.run(`local t = {} for _, row in ipairs(VIEW.forMeRows) do if row.frame.shown then t[#t + 1] = row.text.text end end return table.concat(t, "\\n")`);
const mine = () => s!.run(`local t = {} for _, row in ipairs(VIEW.mineRows) do if row.frame.shown then t[#t + 1] = row.text.text end end return table.concat(t, "\\n")`);
const found = () => s!.run(`local t = {} for _, row in ipairs(VIEW.resultRows) do if row.frame.shown then t[#t + 1] = row.text.text end end return table.concat(t, "\\n")`);
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
      expect(s!.run("return VIEW.optionsButton.text")).not.toBe("More options");
      expect(s!.run("return VIEW.searchButton.text")).not.toBe("Search");
      expect(s!.run("return VIEW.shareButton.text")).not.toBe("Share my recipes");
      expect(s!.run("return VIEW.mineHeader.text")).not.toContain("My requests");
      s!.close(); s = undefined;
    }
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
    expect(found()).toBe("");
    search("shirt");
    expect(found()).toContain("|cffffd100Brown Linen Shirt|r");
    expect(found()).toMatch(/you, Ann Walker/);
    search("linen");
    expect(found().split("\n")).toHaveLength(2);
    // A shift-clicked link finds the item by its id.
    search("|cff1eff00|Hitem:7026::::::::60:|h[Linen Belt]|h|r");
    expect(found().split("\n")).toHaveLength(1);
    expect(found()).toContain("Linen Belt");
    // Nobody known: still requestable by name.
    search("Mooncloth Bag");
    expect(found()).toContain("Mooncloth Bag");
    expect(found()).toContain("nobody known");
  });

  it("sends one request on GUILD, keeps it, and lists it under My requests", () => {
    withCrafters();
    search("shirt");
    s!.run("VIEW.resultRows[1].button.scripts.OnClick(VIEW.resultRows[1].button)");
    const request = s!.run(`local t = {} for _, v in pairs(NS.getDb().craftOrders.requests) do t[#t + 1] = v.ref .. "|" .. v.item .. "|" .. v.key .. "|" .. v.qty .. "|" .. v.character end return t[1]`);
    expect(request).toMatch(/^g[0-9a-f]+\|Brown Linen Shirt\|2580\|1\|/);
    const ref = request.split("|")[0];
    expect(sent("NEW")).toBe(`NEW|${ref}|2580|1|0|1800000000|Tailoring||Brown Linen Shirt|`);
    expect(s!.run("return MESSAGES[#MESSAGES]")).toContain("Asked the guild for 1x Brown Linen Shirt");
    expect(mine()).toContain("Brown Linen Shirt");
    expect(mine()).toContain("Sent. Discord gets it with the next sync.");
    expect(s!.run("return VIEW.mineHeader.text")).toBe("My requests (1)");
    // The same item again right away is refused, and nothing more is sent.
    s!.run("VIEW.resultRows[1].button.scripts.OnClick(VIEW.resultRows[1].button)");
    expect(s!.run("return MESSAGES[#MESSAGES]")).toBe("You just asked for that.");
    expect(sent("NEW").split("\n")).toHaveLength(1);
  });

  it("takes quantity, a note and one asked crafter from More options, and drops an asked name that cannot craft it", () => {
    withCrafters();
    s!.run("VIEW.optionsButton.scripts.OnClick(VIEW.optionsButton)");
    expect(s!.run("return tostring(VIEW.qtyBox.shown) .. tostring(VIEW.askButton.shown)")).toBe("truetrue");
    search("linen");   // Brown Linen Shirt (Ann can make it) and Linen Belt (only you)
    s!.run(`VIEW.qtyBox:SetText("3"); VIEW.noteBox:SetText("Tip | 5g")
      VIEW.askButton.scripts.OnClick(VIEW.askButton)`);
    expect(s!.run("return VIEW.askButton.text")).toBe("Ask: Ann Walker");
    // Asking Ann for an item she cannot make leaves it open to anyone.
    s!.run("VIEW.resultRows[2].button.scripts.OnClick(VIEW.resultRows[2].button)");
    expect(sent("NEW")).toMatch(/\|7026\|3\|0\|1800000000\|Tailoring\|\|Linen Belt\|Tip {3}5g$/);
    // The options are for that one request: quantity, note and the asked crafter start over.
    expect(s!.run("return VIEW.qtyBox.text .. '|' .. VIEW.noteBox.text .. '|' .. VIEW.askButton.text")).toBe("1||Ask: anyone");
    s!.run(`VIEW.askButton.scripts.OnClick(VIEW.askButton)
      VIEW.resultRows[1].button.scripts.OnClick(VIEW.resultRows[1].button)`);
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
    expect(base).toBeGreaterThan(200);
    s!.run("VIEW.optionsButton.scripts.OnClick(VIEW.optionsButton)");
    const withOptions = Number(s!.run("return VIEW.height()"));
    expect(withOptions).toBeGreaterThan(base);
    search("linen");
    expect(Number(s!.run("return VIEW.height()"))).toBeGreaterThan(withOptions);
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
    expect(s!.run(`local c = NS.craftOrders.decode(NS.craftOrders.encode(NS.craftOrders.current())); return c.orders[2].item .. "|" .. tostring(c.orders[2].mats) .. "|" .. c.orders[4].status`))
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
    expect(s!.run("return #VIEW.mineRows")).toBe("5");
    expect(mine()).not.toContain("Sent.");
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
    expect(requests()).toBe(1);
    s!.run(`${FEED_LATER}; NS.craftOrders.refresh()`);
    expect(requests()).toBe(0);
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
    s!.run("VIEW.resultRows[1].button.scripts.OnClick(VIEW.resultRows[1].button)");
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
    expect(mine()).toContain("Sent.");                       // still my own pending row
    expect(s!.run("return #NS.craftOrders.heardForMe()")).toBe("1");   // Ann's request is still listed
    expect(s!.run(`return tostring(NS.craftOrders.isMyRequest({ ref = REF, by = "Mallory Evil" }))`)).toBe("false");
  });

  it("cuts text on character boundaries and keeps the asked crafter's full name", () => {
    withMe();
    const accented = `a${"\\195\\169".repeat(40)}`;   // 81 bytes: a, then 40 two-byte letters
    const row = s!.run(`local r = NS.craftOrders.submit({ item = "${accented}" }); return r.item .. "|" .. #r.item`);
    expect(row.endsWith("|59")).toBe(true);                  // cut before the half character, not in it
    search("shirt");
    s!.run("VIEW.optionsButton.scripts.OnClick(VIEW.optionsButton); VIEW.askButton.scripts.OnClick(VIEW.askButton)");
    s!.run("VIEW.resultRows[1].button.scripts.OnClick(VIEW.resultRows[1].button)");
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
    expect(count("Bo Dee")).toBe(1);
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
});
