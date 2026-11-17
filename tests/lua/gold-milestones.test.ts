import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

// Modules/Milestones.lua, kind "gold": the tier (1-4) of the gold a character holds (100 / 500 / 1,000 / 5,000 gold), read from GetMoney at
// login and on PLAYER_MONEY (debounced, never in combat). The first run records silently; announcements are OFF until the member turns gold on.
let s: LuaSession | undefined;
afterEach(() => s?.close());

function setup(copper = 0) {
  s = newLuaSession();
  s.run(`DB = { roster = {} }; CLOCK = 1800000000; CHAT_OUT = {}; MONEY = ${copper}; COMBAT = false; TIMERS = {}
    function GetServerTime() return CLOCK end
    function GetLocale() return "enUS" end
    function UnitName() return "Kev" end; function GetRealmName() return "Realm" end
    function UnitLevel() return 5 end
    function GetMoney() return MONEY end
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
const done = () => s!.run(`local t = {}; for id in pairs(DB.milestones.chars["Kev-Realm"].done) do if id:find("^gold:") then t[#t + 1] = id end end; table.sort(t); return table.concat(t, ",")`);

describe("gold milestones", () => {
  it("maps copper to the highest tier at the thresholds, and never keeps the amount", () => {
    setup();
    const tier = (copper: number) => s!.run(`return NS.milestones.goldTier(${copper})`);
    expect([0, 999999, 1000000, 4999999, 5000000, 9999999, 10000000, 49999999, 50000000, 2e9].map(tier).map(Number)).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
    expect(Number(s!.run(`return NS.milestones.goldTier(-5)`))).toBe(0);
    expect(Number(s!.run(`return NS.milestones.goldTier("x")`))).toBe(0);
  });

  it("records what the character already holds silently at the first run, tier numbers only", () => {
    setup(12000 * 10000);
    s!.run(`NS.milestones.baseline()`);
    expect(done()).toBe("gold:1,gold:2,gold:3,gold:4");
    expect(out()).toBe("");
    expect(s!.run(`local log = DB.milestones.chars["Kev-Realm"].log; local t = {}; for _, r in ipairs(log) do if r.kind == "gold" then t[#t + 1] = r.ref .. "=" .. r.value end end; return table.concat(t, ",")`)).toBe("gold:1=1,gold:2=2,gold:3=3,gold:4=4");
    expect(s!.run(`local c = DB.milestones.chars["Kev-Realm"]; return tostring(c.money) .. tostring(c.copper) .. tostring(c.gold)`)).toBe("nilnilnil");
  });

  it("records a new tier after a debounced PLAYER_MONEY, and not while in combat", () => {
    setup(50 * 10000);
    s!.run(`NS.milestones.baseline()`);
    expect(done()).toBe("");
    s!.run(`MONEY = 600 * 10000; NS.milestones.onMoney()`);
    s!.run(`NS.milestones.onMoney(); NS.milestones.onMoney()`);
    expect(s!.run(`return #TIMERS`)).toBe("1"); // one look for a burst of coins
    expect(s!.run(`return TIMERS[1].delay`)).toBe("5");
    s!.run(`COMBAT = true; RUN_TIMERS()`);
    expect(done()).toBe(""); // fighting: waited
    expect(s!.run(`return #TIMERS`)).toBe("1");
    s!.run(`COMBAT = false; RUN_TIMERS()`);
    expect(done()).toBe("gold:1,gold:2");
  });

  it("announces nothing by default, and the newest tier only once the member turns gold on", () => {
    setup(0);
    s!.run(`NS.milestones.baseline()`);
    s!.run(`MONEY = 600 * 10000; NS.milestones.checkGold()`);
    expect(done()).toBe("gold:1,gold:2");
    expect(out()).toBe(""); // default OFF: recorded, not said
    expect(s!.run(`return tostring(NS.milestones.enabled("gold"))`)).toBe("false");
    expect(s!.run(`return tostring(NS.milestones.enabled("level"))`)).toBe("true");
    s!.run(`NS.commandHandlers.announce({ "gold", "on" })`);
    expect(s!.run(`return tostring(NS.milestones.enabled("gold"))`)).toBe("true");
    s!.run(`MONEY = 1500 * 10000; NS.milestones.checkGold(); NS.milestones.share()`);
    expect(out()).toContain("GUILD:Kev reached the gold milestone: Thousandaire!");
    expect(out()).not.toMatch(/\d{4,}/); // no amount anywhere
    s!.run(`NS.commandHandlers.announce({ "gold", "off" })`);
    expect(s!.run(`return tostring(NS.milestones.enabled("gold"))`)).toBe("false");
  });

  it("an officer's guild-wide switch and the member's master switch still win over gold on", () => {
    setup(0);
    s!.run(`NS.milestones.baseline(); NS.commandHandlers.announce({ "gold", "on" }); NS.milestones.setEnabled(false)`);
    s!.run(`MONEY = 600 * 10000; NS.milestones.checkGold()`);
    expect(done()).toBe("gold:1,gold:2");
    expect(out()).toBe("");
    expect(s!.run(`return tostring(NS.milestones.enabled("gold"))`)).toBe("false");
  });

  it("announces only the newest tier of a jump, and each tier once", () => {
    setup(0);
    s!.run(`NS.milestones.baseline(); NS.commandHandlers.announce({ "gold", "on" })`);
    s!.run(`MONEY = 6000 * 10000; NS.milestones.checkGold(); NS.milestones.checkGold(); NS.milestones.share(); NS.milestones.share()`);
    expect(done()).toBe("gold:1,gold:2,gold:3,gold:4");
    expect(out().split("\n").filter(line => line.startsWith("GUILD:"))).toEqual(["GUILD:Kev reached the gold milestone: Gold Goblin!"]);
  });

  it("tells the status of gold in /guilded announce", () => {
    setup(0);
    s!.run(`NS.milestones.baseline(); NS.commandHandlers.announce({})`);
    expect(all()).toContain("Gold milestones in guild chat: OFF.");
  });
});
