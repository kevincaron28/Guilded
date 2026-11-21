import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

let session: LuaSession | undefined;
afterEach(() => { session?.close(); session = undefined; });

function withBidding(testRaid: boolean): LuaSession {
  session = newLuaSession();
  session.run(String.raw`
    SENT_CHAT = {}
    function IsInGroup() return false end
    C_ChatInfo = { SendChatMessage = function(text) SENT_CHAT[#SENT_CHAT + 1] = text end, SendAddonMessage = function(_, text) SENT_CHAT[#SENT_CHAT + 1] = text end, RegisterAddonMessagePrefix = function() return true end }
    RAN = {}
    NS = {
      L = function(t) return t end,
      isOfficer = function() return true end,
      playerName = function() return "Ray" end,
      message = function(text) CHAT_LOG = CHAT_LOG or {}; CHAT_LOG[#CHAT_LOG + 1] = text end,
      getActiveRaid = function() return ${testRaid ? "{ test = true }" : "nil"} end,
      runCommand = function(line) RAN[#RAN + 1] = line end,
      SIM_NAMES = { "Testalpha", "Testbravo" },
      commandHandlers = {}, commandHelp = {}
    }
  `);
  session.load("Modules/Bidding.lua");
  return session;
}

const bid = (s: LuaSession, line: string) => s.run(`local a = {}; for w in string.gmatch(${JSON.stringify(line)}, "%S+") do a[#a + 1] = w end; NS.commandHandlers["bid"](a)`);

describe("Bidding.lua solo test mode", () => {
  it("refuses to open bidding alone outside a test raid", () => {
    const s = withBidding(false);
    bid(s, "start 10 Sword");
    expect(s.run("return tostring(NS.bidding.current)")).toBe("nil");
  });

  it("in a test raid: opens, takes fake bids, awards, and sends nothing to chat", () => {
    const s = withBidding(true);
    bid(s, "start 10 Sword");
    expect(s.run("return tostring(NS.bidding.current ~= nil)")).toBe("true");
    s.run("NS.simulateBids()");
    bid(s, "award");
    expect(s.run("return #RAN")).toBe("2");
    expect(s.run("return RAN[1]:sub(1, 5)")).toBe("loot ");
    expect(s.run("return #SENT_CHAT")).toBe("0");
    expect(s.run("return tostring(NS.bidding.current)")).toBe("nil");
  });
});
