import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

// Modules/Milestones.lua, kind "auction" (9.4): auctions sold (counted from the client's own "buyer found" system line) and profit
// (statistic 919), recorded as tiers 1-3 only; and the gold-held tiers now also read the "most gold ever owned" statistic (334).
let s: LuaSession | undefined;
afterEach(() => s?.close());

const SOLD = "A buyer has been found for your auction of %s.";

function setup(opts: { copper?: number; stats?: Record<number, string | number>; template?: string } = {}) {
  s = newLuaSession();
  const stats = Object.entries(opts.stats ?? {}).map(([id, v]) => `STATS[${id}] = ${typeof v === "number" ? v : JSON.stringify(v)}`).join("; ");
  s.run(`DB = { roster = {} }; CLOCK = 1800000000; CHAT_OUT = {}; MONEY = ${opts.copper ?? 0}; COMBAT = false; TIMERS = {}; STATS = {}; ${stats}
    ERR_AUCTION_SOLD_S = ${JSON.stringify(opts.template ?? SOLD)}
    function GetServerTime() return CLOCK end
    function GetLocale() return "enUS" end
    function UnitName() return "Kev" end; function GetRealmName() return "Realm" end
    function UnitLevel() return 5 end
    function GetMoney() return MONEY end
    function GetStatistic(id) return STATS[id] end
    function InCombatLockdown() return COMBAT end
    function GetMaxPlayerLevel() return 60 end
    function IsInGuild() return true end
    function SendChatMessage(text, channel) CHAT_OUT[#CHAT_OUT + 1] = channel .. ":" .. text end
    C_Timer = { After = function(delay, fn) TIMERS[#TIMERS + 1] = { delay = delay, fn = fn } end }
    function RUN_TIMERS() local t = TIMERS; TIMERS = {}; for _, x in ipairs(t) do x.fn() end end
    NS = { getDb = function() return DB end, util = {}, commandHandlers = {}, commandHelp = {}, message = function(text) CHAT_OUT[#CHAT_OUT + 1] = "LOCAL:" .. text end,
      isSecret = function() return false end, isGuildMember = function() return true end, isOfficerName = function() return false end, isOfficer = function() return false end }`);
  s.load("Locale.lua");
  s.load("Modules/Milestones.lua");
  return s;
}
const out = () => s!.run(`local t = {}; for _, l in ipairs(CHAT_OUT) do if l:find("^GUILD:") then t[#t + 1] = l end end; return table.concat(t, "\\n")`);
const all = () => s!.run(`return table.concat(CHAT_OUT, "\\n")`);
const done = (prefix = "auction") => s!.run(`local t = {}; for id in pairs(DB.milestones.chars["Kev-Realm"].done) do if id:find("^${prefix}:") then t[#t + 1] = id end end; table.sort(t); return table.concat(t, ",")`);
const sell = (n: number, line = "A buyer has been found for your auction of [Linen Cloth].") => s!.run(`for i = 1, ${n} do NS.milestones.onSystemMessage(${JSON.stringify(line)}) end`);

describe("auction sales", () => {
  it("matches the client's sold line in English and builds the pattern from the global in any language", () => {
    setup();
    const match = (line: string) => s!.run(`return tostring(NS.milestones.isSoldLine(${JSON.stringify(line)}))`);
    expect(match("A buyer has been found for your auction of [Linen Cloth].")).toBe("true");
    expect(match("A buyer has been found for your auction of |cff1eff00|Hitem:2589::::::::|h[Linen Cloth]|h|r.")).toBe("true");
    expect(match("Your auction of [Linen Cloth] expired.")).toBe("false");
    expect(match("A buyer has been found for your auction")).toBe("false");
    // A French-style global with magic characters (parentheses, brackets, plus, dot) is escaped, not interpreted.
    s!.run(`ERR_AUCTION_SOLD_S = "Un acheteur a ete trouve (100) pour votre vente de %s [+1]."`);
    expect(match("Un acheteur a ete trouve (100) pour votre vente de [Toile de lin] [+1].")).toBe("true");
    expect(match("Un acheteur a ete trouve 100 pour votre vente de [Toile de lin] 1")).toBe("false");
    s!.run(`ERR_AUCTION_SOLD_S = nil`);
    expect(match("A buyer has been found for your auction of [x].")).toBe("false"); // no global: nothing counts
  });

  it("starts at 0 silently, counts sold lines after the first run, and records tiers 1-3", () => {
    setup();
    s!.run(`NS.milestones.onSystemMessage("A buyer has been found for your auction of [x].")`);
    expect(s!.run(`return tostring(DB.milestones and DB.milestones.chars["Kev-Realm"] and DB.milestones.chars["Kev-Realm"].auctionSold)`)).toBe("nil"); // not watched before its first run
    s!.run(`NS.milestones.baseline()`);
    expect(done()).toBe("");
    expect(s!.run(`return DB.milestones.chars["Kev-Realm"].auctionSold`)).toBe("0");
    sell(1);
    s!.run(`RUN_TIMERS()`);
    expect(done()).toBe("auction:sold-1");
    sell(99);
    s!.run(`RUN_TIMERS()`);
    expect(done()).toBe("auction:sold-1,auction:sold-2");
    sell(900);
    s!.run(`RUN_TIMERS()`);
    expect(done()).toBe("auction:sold-1,auction:sold-2,auction:sold-3");
    expect(s!.run(`return DB.milestones.chars["Kev-Realm"].auctionSold`)).toBe("1000");
  });

  it("looks once for a burst of sales, and waits out a fight without losing the count", () => {
    setup();
    s!.run(`NS.milestones.baseline()`);
    s!.run(`COMBAT = true`);
    sell(3);
    expect(s!.run(`return #TIMERS`)).toBe("1");
    s!.run(`RUN_TIMERS()`);
    expect(done()).toBe(""); // fighting: not looked at
    expect(s!.run(`return tostring(NS.milestones.checkAuction())`)).toBe("false");
    s!.run(`COMBAT = false; RUN_TIMERS()`);
    expect(done()).toBe("auction:sold-1");
    expect(s!.run(`return DB.milestones.chars["Kev-Realm"].auctionSold`)).toBe("3");
  });

  it("only tiers leave the character: the log has refs and tier values, never a count or an amount", () => {
    setup({ stats: { 919: "12,345g 67s" } });
    s!.run(`NS.milestones.baseline()`);
    sell(100);
    s!.run(`RUN_TIMERS()`);
    expect(s!.run(`local t = {}; for _, r in ipairs(DB.milestones.chars["Kev-Realm"].log) do if r.kind == "auction" then t[#t + 1] = r.ref .. "=" .. r.value end end; table.sort(t); return table.concat(t, ",")`))
      .toBe("auction:profit-1=1,auction:profit-2=2,auction:profit-3=3,auction:sold-1=1,auction:sold-2=2");
  });
});

describe("auction profit and money statistics", () => {
  it("reads a money statistic in every shape the client uses, or nothing", () => {
    setup();
    const parse = (lua: string) => s!.run(`return tostring(NS.milestones.parseMoney(${lua}))`);
    expect(parse(`"12g 34s 56c"`)).toBe("123456");
    expect(parse(`"1,234g"`)).toBe("12340000");
    expect(parse(`"1 234 g"`)).toBe("12340000");
    expect(parse(`"|cffffd7001,500g|r 2s"`)).toBe("15000200");
    expect(parse(`"12|TInterface/MoneyFrame/UI-GoldIcon:0:0:2:0|t 34|TInterface/MoneyFrame/UI-SilverIcon:0:0:2:0|t 5|TInterface/MoneyFrame/UI-CopperIcon:0:0:2:0|t"`)).toBe("123405");
    expect(parse(`"12 po 34 pa 56 pc"`)).toBe("123456");
    expect(parse(`"5000"`)).toBe("5000");
    expect(parse(`5000`)).toBe("5000");
    expect(parse(`"--"`)).toBe("nil");
    expect(parse(`""`)).toBe("nil");
    expect(parse(`nil`)).toBe("nil");
    expect(parse(`-4`)).toBe("nil");
    expect(parse(`{}`)).toBe("nil");
  });

  it("maps profit to tiers at 100, 1,000 and 10,000 gold", () => {
    setup();
    const tier = (copper: number) => s!.run(`return NS.milestones.profitTier(${copper})`);
    expect([0, 999999, 1000000, 9999999, 10000000, 99999999, 100000000, 5e9].map(tier).map(Number)).toEqual([0, 0, 1, 1, 2, 2, 3, 3]);
    expect(Number(s!.run(`return NS.milestones.profitTier("x")`))).toBe(0);
    expect(Number(s!.run(`return NS.milestones.profitTier(nil)`))).toBe(0);
  });

  it("records the profit tiers silently at the first run, and survives a missing or '--' statistic", () => {
    setup({ stats: { 919: "20,000g" } });
    s!.run(`NS.commandHandlers.announce({ "auction", "on" })`);
    s!.run(`NS.milestones.baseline()`);
    expect(done()).toBe("auction:profit-1,auction:profit-2,auction:profit-3");
    expect(out()).toBe("");
    setup({ stats: { 919: "--" } });
    s!.run(`NS.milestones.baseline()`);
    expect(done()).toBe("");
    setup();
    s!.run(`NS.milestones.baseline()`);
    expect(done()).toBe("");
  });

  it("notices new profit after a debounced money or mail event", () => {
    setup();
    s!.run(`NS.milestones.baseline()`);
    s!.run(`STATS[919] = "150g"; NS.milestones.onMoney(); NS.milestones.onMoney()`);
    expect(s!.run(`return #TIMERS`)).toBe("1");
    s!.run(`RUN_TIMERS()`);
    expect(done()).toBe("auction:profit-1");
  });
});

describe("gold held reads the most-gold-ever statistic", () => {
  it("earns the tier from statistic 334 even when the purse is empty (tier only)", () => {
    setup({ copper: 3 * 10000, stats: { 334: "600g 12s" } });
    s!.run(`NS.milestones.baseline()`);
    expect(done("gold")).toBe("gold:1,gold:2");
    expect(s!.run(`local c = DB.milestones.chars["Kev-Realm"]; return tostring(c.money) .. tostring(c.copper) .. tostring(c.gold)`)).toBe("nilnilnil");
  });

  it("uses the larger of the purse and the statistic", () => {
    setup({ copper: 6000 * 10000, stats: { 334: "50g" } });
    s!.run(`NS.milestones.baseline()`);
    expect(done("gold")).toBe("gold:1,gold:2,gold:3,gold:4");
  });

  it("still works with no statistic at all", () => {
    setup({ copper: 600 * 10000 });
    s!.run(`GetStatistic = nil; NS.milestones.baseline()`);
    expect(done("gold")).toBe("gold:1,gold:2");
  });
});

describe("auction announcements", () => {
  it("are OFF by default, switch with /guilded announce auction, and announce only the newest tier", () => {
    setup();
    s!.run(`NS.milestones.baseline()`);
    expect(s!.run(`return tostring(NS.milestones.enabled("auction"))`)).toBe("false");
    sell(1);
    s!.run(`RUN_TIMERS()`);
    expect(done()).toBe("auction:sold-1");
    expect(out()).toBe(""); // recorded, not said
    s!.run(`NS.commandHandlers.announce({ "auction", "on" })`);
    expect(s!.run(`return tostring(NS.milestones.enabled("auction"))`)).toBe("true");
    sell(99);
    s!.run(`RUN_TIMERS()`);
    expect(out()).toBe("GUILD:Kev reached the auction house milestone: Market Regular!");
    s!.run(`NS.commandHandlers.announce({ "auction", "off" })`);
    expect(s!.run(`return tostring(NS.milestones.enabled("auction"))`)).toBe("false");
  });

  it("shows its state in /guilded announce, and an officer's guild-wide switch still wins", () => {
    setup();
    s!.run(`NS.milestones.baseline(); NS.commandHandlers.announce({})`);
    expect(all()).toContain("Auction house milestones in guild chat: OFF.");
    s!.run(`NS.commandHandlers.announce({ "auction", "on" }); NS.milestones.setEnabled(false)`);
    sell(1);
    s!.run(`RUN_TIMERS()`);
    expect(done()).toBe("auction:sold-1");
    expect(out()).toBe("");
  });
});

describe("a character from before 9.4", () => {
  it("gets the new statistics recorded once, silently, at the next login", () => {
    setup({ stats: { 919: "2,000g", 334: "700g" } });
    s!.run(`NS.milestones.baseline()`);
    // Pretend this character was baselined by an older addon: nothing recorded, no flag.
    s!.run(`local c = DB.milestones.chars["Kev-Realm"]; c.done = {}; c.log = {}; c.statsBaselined = nil; c.auctionSold = nil`);
    s!.run(`NS.commandHandlers.announce({ "auction", "on" }); NS.commandHandlers.announce({ "gold", "on" })`);
    s!.run(`fire_event("PLAYER_ENTERING_WORLD")`);
    expect(done()).toBe("auction:profit-1,auction:profit-2");
    expect(done("gold")).toBe("gold:1,gold:2");
    expect(out()).toBe("");
    expect(s!.run(`return tostring(DB.milestones.chars["Kev-Realm"].statsBaselined)`)).toBe("true");
  });
});
