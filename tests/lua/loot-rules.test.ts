// SR+ follows the usual soft-reserve rule (+10 per week an item is reserved and not won), however
// many lists a week has, and a win clears the bonus whoever gives the item out (27 October 2026).
import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

let session: LuaSession | undefined;
afterEach(() => { session?.close(); session = undefined; });

const SWORD = "|cffa335ee|Hitem:19364::::::::60|h[Ashkandi]|h|r";

function withReserve(me: string): LuaSession {
  session = newLuaSession();
  session.run(String.raw`
    SENT = {}
    local T = 0
    function GetTime() T = T + 10; return T end
    NOW = 1800000000
    function GetServerTime() return NOW end
    function IsInGuild() return true end
    function IsInRaid() return false end
    function IsInGroup() return false end
    C_ChatInfo = {
      SendChatMessage = function(text) SENT[#SENT + 1] = "CHAT:" .. text end,
      SendAddonMessage = function(_, text, ch, target) SENT[#SENT + 1] = "ADDON:" .. tostring(ch) .. ":" .. tostring(target) .. ":" .. text end,
      RegisterAddonMessagePrefix = function() return true end
    }
    RAN, DB, CHAT_LOG = {}, {}, {}
    NS = {
      L = function(t) return t end,
      isOfficer = function() return true end,
      isOfficerName = function(n) return n == "Boss" or n == "Kay" end,
      isSecret = function() return false end,
      normalizeName = function(n) if not n then return nil end return (string.gsub(n, "%-.*", "")) end,
      playerName = function() return "${me}" end,
      message = function(text) CHAT_LOG[#CHAT_LOG + 1] = text end,
      getDb = function() return DB end,
      runCommand = function(line) RAN[#RAN + 1] = line end,
      commandHandlers = {},
      lootRoll = { start = function() return true end },
      commandHelp = {}
    }
  `);
  session.load("Modules/Reserve.lua");
  return session;
}
const cmd = (s: LuaSession, line: string) =>
  s.run(`local a = {}; for w in string.gmatch(${JSON.stringify(line)}, "%S+") do a[#a + 1] = w end; NS.commandHandlers["reserve"](a)`);
const addon = (s: LuaSession, from: string, text: string) =>
  s.run(`fire_event("CHAT_MSG_ADDON", "GuildedRes", ${JSON.stringify(text)}, "GUILD", ${JSON.stringify(from)})`);
const plus = (s: LuaSession, name: string, id: number) => s.run(`return NS.reserve.plusFor('${name}', ${id})`);
const nextWeek = (s: LuaSession) => s.run("NOW = NOW + 7 * 86400");

describe("SR+ counts weeks, not lists", () => {
  it("two raid nights in one week add one week, once that week is over", () => {
    const s = withReserve("Boss");
    cmd(s, "open");
    addon(s, "Ann", "ADD|19364");
    cmd(s, "open"); // Thursday, same lockout
    addon(s, "Ann", "ADD|19364");
    cmd(s, "open");
    expect(plus(s, "Ann", 19364)).toBe("0");
    nextWeek(s);
    cmd(s, "open");
    expect(plus(s, "Ann", 19364)).toBe("10");
  });

  it("keeps the bonus of every raid reserved that week (two different raids)", () => {
    const s = withReserve("Boss");
    cmd(s, "open"); // Onyxia
    addon(s, "Ann", "ADD|19364");
    cmd(s, "open"); // Molten Core, same week
    addon(s, "Ann", "ADD|17063");
    nextWeek(s);
    cmd(s, "open");
    expect(`${plus(s, "Ann", 19364)}:${plus(s, "Ann", 17063)}`).toBe("10:10");
  });

  it("a week without any reserves keeps everyone's SR+ (no raid that week)", () => {
    const s = withReserve("Boss");
    s.run(`DB.reserves = { entries = {}, names = {}, limit = 1, plus = { ["Ann:19364"] = 2 } }`);
    cmd(s, "open");
    nextWeek(s);
    cmd(s, "open");
    expect(plus(s, "Ann", 19364)).toBe("20");
  });
});

describe("an award by an officer who does not keep the list", () => {
  it("clears the winner's reserve and SR+ locally and tells the keeper", () => {
    const s = withReserve("Kay");
    s.run(`DB.reserves = { open = true, host = "Boss", hostSender = "Boss-Realm", limit = 1, names = {}, entries = { Ann = { 19364 } }, plus = { ["Ann:19364"] = 2 } }`);
    cmd(s, `award Ann ${SWORD}`);
    expect(plus(s, "Ann", 19364)).toBe("0");
    expect(s.run("return tostring(DB.reserves.entries.Ann)")).toBe("nil");
    expect(s.run("for _, m in ipairs(SENT) do if m:find('WON|', 1, true) then return m end end")).toBe("ADDON:WHISPER:Boss-Realm:WON|Ann|19364");
    nextWeek(s);
    cmd(s, "open");
    expect(plus(s, "Ann", 19364)).toBe("0");
  });

  it("the keeper takes the item off the list and the winner earns no more SR+ for it", () => {
    const s = withReserve("Boss");
    s.run(`DB.reserves = { open = true, host = "Boss", limit = 1, names = {}, entries = { Ann = { 19364 }, Bob = { 19364 } }, plus = { ["Ann:19364"] = 2, ["Bob:19364"] = 1 }, listWeek = NS.reserve.resetWeek() }`);
    addon(s, "Kay", "WON|Ann|19364");
    expect(s.run("return table.concat(NS.reserve.holders(19364), ',')")).toBe("Bob");
    nextWeek(s);
    cmd(s, "open");
    expect(`${plus(s, "Ann", 19364)}:${plus(s, "Bob", 19364)}`).toBe("0:20");
  });

  it("ignores a WON message from someone who is not an officer", () => {
    const s = withReserve("Boss");
    s.run(`DB.reserves = { open = true, host = "Boss", limit = 1, names = {}, entries = { Ann = { 19364 } }, plus = {} }`);
    addon(s, "Ray", "WON|Ann|19364");
    expect(s.run("return table.concat(NS.reserve.holders(19364), ',')")).toBe("Ann");
  });
});
