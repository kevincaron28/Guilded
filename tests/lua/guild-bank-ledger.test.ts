import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

// 9.0 guild bank ledger: Modules/GuildBank.lua keeps the game's item and money logs (full Forever
// names, deduplicated across reads) and a gold history for the companion.
let s: LuaSession | undefined;
afterEach(() => { s?.close(); s = undefined; });

function setup() {
  s = newLuaSession();
  s.run(`CLOCK = 1800000000
    function GetServerTime() return CLOCK end
    MAX_GUILDBANK_TABS = 6
    function GetNumGuildBankTabs() return 2 end
    function GetGuildBankItemLink() return nil end
    function GetGuildBankItemInfo() return nil end
    function GetGuildBankMoney() return GOLD end
    GOLD = 5000000
    ITEM_LOG = { [1] = {
      { "deposit", "Dude Lebowski", "|cffffffff|Hitem:13444::::|h[Major Mana Potion]|h|r", 5, 1, nil, 0, 0, 1, 2 },
      { "withdraw", "Walter Sobchak", "|cffffffff|Hitem:12360::::|h[Arcanite Bar]|h|r", 2, 1, nil, 0, 0, 0, 3 },
      { "deposit", "Bad|Name", "|cffffffff|Hitem:1::::|h[X]|h|r", 1, 1, nil, 0, 0, 0, 1 }
    }, [2] = {} }
    MONEY_LOG = { { "deposit", "Dude Lebowski", 250000, 0, 0, 0, 5 }, { "repair", "Walter Sobchak", 1200, 0, 0, 0, 1 } }
    function GetNumGuildBankTransactions(tab) return #(ITEM_LOG[tab] or {}) end
    function GetGuildBankTransaction(tab, i) return unpack(ITEM_LOG[tab][i]) end
    function GetNumGuildBankMoneyTransactions() return #MONEY_LOG end
    function GetGuildBankMoneyTransaction(i) return unpack(MONEY_LOG[i]) end
    QUERIED = {}
    C_Timer = { After = function(_, fn) fn() end }
    function QueryGuildBankLog(tab) QUERIED[#QUERIED + 1] = tab end
    DB = {}
    NS = { getDb = function() return DB end, isSecret = function() return false end, now = function() return "2026-11-04T20:00:00Z" end,
      playerName = function() return "Dude Lebowski" end,
      normalizeName = function(n) if type(n) ~= "string" or n:find("|", 1, true) then return nil end return n end }`);
  s.load("Modules/GuildBank.lua");
  return s;
}
const value = (expr: string) => s!.run(`return tostring(${expr})`);

describe("guild bank ledger capture", () => {
  it("keeps who deposited or withdrew what, and the gold moves, with times from the game's ages", () => {
    const lua = setup();
    expect(value(`NS.guildBank.readLogs()`)).toBe("4");
    expect(value(`#DB.guildBankLog.items`)).toBe("2");
    expect(lua.run(`local l = DB.guildBankLog.items[1] return l.type .. "|" .. l.name .. "|" .. l.item .. "|" .. l.itemName .. "|" .. l.count .. "|" .. l.tab .. "|" .. l.at`))
      .toBe(`deposit|Dude Lebowski|13444|Major Mana Potion|5|1|${1800000000 - (24 + 2) * 3600}`);
    expect(lua.run(`local l = DB.guildBankLog.money[1] return l.type .. "|" .. l.name .. "|" .. l.amount .. "|" .. l.at`))
      .toBe(`deposit|Dude Lebowski|250000|${1800000000 - 5 * 3600}`);
  });

  it("the same lines read again an hour later are kept once", () => {
    const lua = setup();
    lua.run(`NS.guildBank.readLogs()`);
    // An hour later the game shows every line one hour older: the same lines.
    lua.run(`CLOCK = CLOCK + 3600
      for _, line in ipairs(ITEM_LOG[1]) do line[10] = line[10] + 1 end
      for _, line in ipairs(MONEY_LOG) do line[7] = line[7] + 1 end`);
    expect(value(`NS.guildBank.readLogs()`)).toBe("0");
    expect(value(`#DB.guildBankLog.items + #DB.guildBankLog.money`)).toBe("4");
  });

  it("asks the server for every tab's log and the money log when the bank opens, and notes the gold", () => {
    const lua = setup();
    lua.run(`NS.guildBank.onOpened()`);
    expect(lua.run(`return table.concat(QUERIED, ",")`)).toBe("1,2,7");
    lua.run(`NS.guildBank.scan()`);
    expect(value(`DB.guildBankLog.gold[1].money`)).toBe("5000000");
    lua.run(`GOLD = 5100000; CLOCK = CLOCK + 60; NS.guildBank.scan()`);
    expect(value(`#DB.guildBankLog.gold .. ":" .. DB.guildBankLog.gold[1].money`)).toBe("1:5100000"); // one point per visit
    lua.run(`GOLD = 4900000; CLOCK = CLOCK + 3600; NS.guildBank.scan()`);
    expect(value(`#DB.guildBankLog.gold`)).toBe("2");
  });

  it("a client without the log API records nothing and does not fail", () => {
    const lua = setup();
    lua.run(`GetNumGuildBankTransactions = nil; GetNumGuildBankMoneyTransactions = nil; QueryGuildBankLog = nil`);
    expect(value(`NS.guildBank.readLogs()`)).toBe("0");
    lua.run(`NS.guildBank.onOpened()`);
  });
});
