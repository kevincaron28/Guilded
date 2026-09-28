import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

let session: LuaSession | undefined;
afterEach(() => { session?.close(); session = undefined; });

// Loads Modules/Council.lua with a small fake of what it needs from the addon.
// `channel` is the group the officer is in: "TEST" (a test raid), "RAID" or none.
function withCouncil(channel: "TEST" | "RAID" | "NONE", officer = true): LuaSession {
  session = newLuaSession();
  session.run(String.raw`
    SENT = {}
    -- The raid: Ann, Bob, Cy and Dee (whispers and answers only count from the group).
    MOCK_UNITS = { raid1 = { name = "Ann" }, raid2 = { name = "Bob" }, raid3 = { name = "Cy" }, raid4 = { name = "Dee" } }
    MOCK_GROUP_SIZE = 4
    function IsInRaid() return ${channel === "RAID" ? "true" : "false"} end
    function IsInGroup() return ${channel === "RAID" ? "true" : "false"} end
    C_ChatInfo = {
      SendChatMessage = function(text, ch, _, target) SENT[#SENT + 1] = "CHAT:" .. tostring(ch) .. ":" .. tostring(target) .. ":" .. text end,
      SendAddonMessage = function(_, text, ch, target) SENT[#SENT + 1] = "ADDON:" .. tostring(ch) .. ":" .. tostring(target) .. ":" .. text end,
      RegisterAddonMessagePrefix = function() return true end
    }
    RAN = {}
    PR = { Ann = 5, Bob = 9, Cy = 1 }
    NS = {
      L = function(t) return t end,
      isOfficer = function() return ${officer} end,
      isOfficerName = function(n) return n == "Boss" end,
      isSecret = function() return false end,
      normalizeName = function(n) return (string.gsub(n or "", "%-.*", "")) end,
      playerName = function() return "Me" end,
      message = function(text) CHAT_LOG = CHAT_LOG or {}; CHAT_LOG[#CHAT_LOG + 1] = text end,
      getActiveRaid = function() return ${channel === "TEST" ? "{ test = true }" : "nil"} end,
      getStanding = function(n) return PR[n] and { pr = PR[n], ep = 0, gp = 0 } or nil end,
      runCommand = function(line) RAN[#RAN + 1] = line end,
      SIM_NAMES = { "Testalpha", "Testbravo", "Testcharlie", "Testdelta", "Testecho" },
      commandHandlers = {}, commandHelp = {}
    }
  `);
  session.load("Modules/Council.lua");
  return session;
}

const council = (s: LuaSession, line: string) =>
  s.run(`local a = {}; for w in string.gmatch(${JSON.stringify(line)}, "%S+") do a[#a + 1] = w end; NS.commandHandlers["council"](a)`);
const addon = (s: LuaSession, from: string, text: string) =>
  s.run(`fire_event("CHAT_MSG_ADDON", "GuildedLC", ${JSON.stringify(text)}, "RAID", ${JSON.stringify(from)})`);
const whisper = (s: LuaSession, from: string, text: string) =>
  s.run(`fire_event("CHAT_MSG_WHISPER", ${JSON.stringify(text)}, ${JSON.stringify(from)})`);
const order = (s: LuaSession) => s.run(`local t = {}; for _, r in ipairs(NS.council.ranked()) do t[#t + 1] = r.name .. ":" .. r.tier end; return table.concat(t, ",")`);
const count = (s: LuaSession, pattern: string) =>
  s.run(`local n = 0; for _, m in ipairs(SENT) do if m:find(${JSON.stringify(pattern)}) then n = n + 1 end end; return n`);

describe("Council.lua officer side", () => {
  it("refuses outside a group and for non-officers", () => {
    let s = withCouncil("NONE");
    council(s, "start Sword");
    expect(s.run("return tostring(NS.council.current)")).toBe("nil");
    s.close();
    s = withCouncil("RAID", false);
    council(s, "start Sword");
    expect(s.run("return tostring(NS.council.current)")).toBe("nil");
  });

  it("opens with one raid message and one raid chat line", () => {
    const s = withCouncil("RAID");
    council(s, "start Big Sword 45");
    expect(s.run("return NS.council.current.item")).toBe("Big Sword");
    expect(s.run("return NS.council.current.seconds")).toBe("45");
    expect(s.run("return #SENT")).toBe("2");
    expect(s.run("return tostring(SENT[1]:match('^ADDON:RAID:nil:OPEN|%d+|45|Big Sword$') ~= nil)")).toBe("true");
  });

  it("ranks BiS above upgrade above off-spec, then by PR, and leaves passes out", () => {
    const s = withCouncil("RAID");
    council(s, "start Sword");
    s.run(`NS.council.addResponse("Ann", "os")`);
    s.run(`NS.council.addResponse("Bob", "up")`);
    s.run(`NS.council.addResponse("Cy", "bis")`);
    s.run(`NS.council.addResponse("Dee", "up")`); // no standing: PR 0, after Bob
    s.run(`NS.council.addResponse("Eve", "pass")`);
    expect(order(s)).toBe("Cy:bis,Bob:up,Dee:up,Ann:os");
    expect(s.run("return tostring(NS.council.statusText():match('1 passed') ~= nil)")).toBe("true");
  });

  it("puts a player who soft-reserved the item first and says so", () => {
    const s = withCouncil("RAID");
    s.run(`NS.reserve = { isReserved = function(name) return name == "Cy" end }`);
    council(s, "start Sword");
    s.run(`NS.council.addResponse("Bob", "bis")`);
    s.run(`NS.council.addResponse("Cy", "os")`);
    expect(order(s)).toBe("Cy:os,Bob:bis");
    expect(s.run("return tostring(NS.council.statusText():match('reserved') ~= nil)")).toBe("true");
  });

  it("takes a changed answer instead of a second one", () => {
    const s = withCouncil("RAID");
    council(s, "start Sword");
    s.run(`NS.council.addResponse("Ann", "os")`);
    s.run(`NS.council.addResponse("Ann", "bis")`);
    expect(order(s)).toBe("Ann:bis");
  });

  it("takes answers from addon messages and whispers, and confirms them", () => {
    const s = withCouncil("RAID");
    council(s, "start Sword");
    const id = s.run("return NS.council.current.id");
    addon(s, "Ann-Realm", `RESP|${id}|bis|Old Blade (60)`);
    whisper(s, "Bob-Realm", "Upgrade");
    whisper(s, "Cy", "OS");
    whisper(s, "Cy", "give it to me please");
    addon(s, "Dee", "RESP|999|bis|"); // another session
    expect(order(s)).toBe("Ann:bis,Bob:up,Cy:os");
    expect(s.run("return NS.council.ranked()[1].gear")).toBe("Old Blade (60)");
    expect(count(s, "^ADDON:WHISPER:Ann%-Realm:ACK|")).toBe("1");
    expect(count(s, "^CHAT:WHISPER:Bob%-Realm:")).toBe("1");
  });

  it("closes with nobody, then clears the session", () => {
    const s = withCouncil("RAID");
    council(s, "start Sword");
    council(s, "close");
    expect(s.run("return tostring(NS.council.current)")).toBe("nil");
  });

  it("awards the top pick with the normal loot command, for 0 GP", () => {
    const s = withCouncil("RAID");
    council(s, "start |cffa335ee|Hitem:1234|h[Big Sword]|h|r");
    s.run(`NS.council.addResponse("Ann", "up")`);
    s.run(`NS.council.addResponse("Bob", "bis")`);
    council(s, "award");
    expect(s.run("return #RAN")).toBe("1");
    expect(s.run("return RAN[1]")).toBe("loot Bob Big Sword 0");
    expect(s.run("return tostring(NS.council.current)")).toBe("nil");
    expect(s.run("return tostring(SENT[#SENT - 1]:match('AWARD|%d+|Bob$') ~= nil)")).toBe("true");
  });

  it("awards a named player and charges GP when a price is given", () => {
    const s = withCouncil("RAID");
    council(s, "start Sword");
    s.run(`NS.council.addResponse("Ann", "up")`);
    council(s, "award Cy 15");
    expect(s.run("return RAN[1]")).toBe("loot Cy Sword 15");
    expect(s.run("return RAN[2]")).toBe("gp Cy 15 Council: Sword");
  });

  it("does not guess a winner when nobody answered", () => {
    const s = withCouncil("RAID");
    council(s, "start Sword");
    council(s, "award");
    expect(s.run("return #RAN")).toBe("0");
  });

  it("cancels without awarding", () => {
    const s = withCouncil("RAID");
    council(s, "start Sword");
    s.run(`NS.council.addResponse("Ann", "bis")`);
    council(s, "cancel");
    expect(s.run("return tostring(NS.council.current)")).toBe("nil");
    expect(s.run("return #RAN")).toBe("0");
  });

  it("runs alone in a test raid: fake answers, award, nothing sent", () => {
    const s = withCouncil("TEST");
    council(s, "start Sword");
    s.run("NS.simulateCouncil()");
    council(s, "award");
    expect(s.run("return #RAN")).toBe("1");
    expect(s.run("return RAN[1]:sub(1, 5)")).toBe("loot ");
    expect(s.run("return #SENT")).toBe("0");
  });
});

describe("Council.lua raider side", () => {
  it("shows the popup for an officer's session and ignores anyone else", () => {
    const s = withCouncil("RAID", false);
    addon(s, "Rando", "OPEN|55|60|Sword");
    expect(s.run("return tostring(NS.council.incoming)")).toBe("nil");
    addon(s, "Boss", "OPEN|55|60|Sword");
    expect(s.run("return NS.council.incoming.item")).toBe("Sword");
  });

  it("sends the chosen answer to the officer and keeps the confirmation", () => {
    const s = withCouncil("RAID", false);
    addon(s, "Boss", "OPEN|55|60|Sword");
    s.run(`NS.commandHandlers["council"]({ "up" })`);
    expect(s.run("return SENT[1]")).toBe("ADDON:WHISPER:Boss:RESP|55|up|");
    addon(s, "Boss", "ACK|55|up");
    expect(s.run("return NS.council.incoming.mine")).toBe("up");
  });

  it("closes and clears the popup on award", () => {
    const s = withCouncil("RAID", false);
    addon(s, "Boss", "OPEN|55|60|Sword");
    addon(s, "Boss", "AWARD|55|Me");
    expect(s.run("return tostring(NS.council.incoming)")).toBe("nil");
    expect(s.run("return CHAT_LOG[#CHAT_LOG]")).toBe("You got Sword.");
  });

  it("does nothing while the module is off", () => {
    const s = withCouncil("RAID", false);
    s.run(`NS.moduleActive = function() return false end`);
    addon(s, "Boss", "OPEN|55|60|Sword");
    expect(s.run("return tostring(NS.council.incoming)")).toBe("nil");
  });
});

describe("Council.lua EPGP priority", () => {
  it("opens at a set price, with its own message and chat line", () => {
    const s = withCouncil("RAID");
    council(s, "priority 250 Big Sword 45");
    expect(s.run("return NS.council.current.kind")).toBe("priority");
    expect(s.run("return NS.council.current.price")).toBe("250");
    expect(s.run("return tostring(SENT[1]:match('^ADDON:RAID:nil:OPENP|%d+|45|250|Big Sword$') ~= nil)")).toBe("true");
    expect(s.run("return SENT[2]")).toContain("costs 250 GP");
  });

  it("wants it or passes only, and ranks by PR alone", () => {
    const s = withCouncil("RAID");
    council(s, "priority 250 Sword");
    s.run(`NS.council.addResponse("Ann", "want")`);
    s.run(`NS.council.addResponse("Cy", "want")`);
    s.run(`NS.council.addResponse("Bob", "want")`);
    s.run(`NS.council.addResponse("Dee", "bis")`); // a council answer: not taken
    s.run(`NS.council.addResponse("Eve", "pass")`);
    expect(order(s)).toBe("Bob:want,Ann:want,Cy:want");
  });

  it("uses the core's own pool for PR when the loot module says so", () => {
    const s = withCouncil("RAID");
    s.run(`NS.loot = { prFor = function(name) return ({ Ann = 9, Bob = 2 })[name] or 0 end }`);
    council(s, "priority 100 Sword");
    s.run(`NS.council.addResponse("Ann", "want")`);
    s.run(`NS.council.addResponse("Bob", "want")`);
    expect(order(s)).toBe("Ann:want,Bob:want");
  });

  it("awards the highest PR by itself when time is up, and charges the set price", () => {
    const s = withCouncil("RAID");
    council(s, "priority 250 Sword");
    s.run(`NS.council.addResponse("Ann", "want")`);
    s.run(`NS.council.addResponse("Bob", "want")`);
    council(s, "close");
    expect(s.run("return RAN[1]")).toBe("loot Bob Sword 250");
    expect(s.run("return RAN[2]")).toBe("gp Bob 250 Priority: Sword");
    expect(s.run("return tostring(NS.council.current)")).toBe("nil");
    expect(s.run("return tostring(SENT[#SENT - 1]:match('AWARD|%d+|Bob$') ~= nil)")).toBe("true");
    expect(s.run("return SENT[#SENT]")).toContain("Sword goes to Bob for 250 GP.");
  });

  it("does nothing when nobody wants it", () => {
    const s = withCouncil("RAID");
    council(s, "priority 250 Sword");
    s.run(`NS.council.addResponse("Eve", "pass")`);
    council(s, "close");
    expect(s.run("return #RAN")).toBe("0");
    expect(s.run("return tostring(NS.council.current)")).toBe("nil");
  });

  it("takes whispers from players without the addon", () => {
    const s = withCouncil("RAID");
    council(s, "priority 250 Sword");
    whisper(s, "Ann-Realm", "want");
    whisper(s, "Cy", "bis");
    expect(order(s)).toBe("Ann:want");
  });

  it("needs a price, and officers only", () => {
    const s = withCouncil("RAID");
    council(s, "priority Sword");
    expect(s.run("return tostring(NS.council.current)")).toBe("nil");
    const m = withCouncil("RAID", false);
    council(m, "priority 250 Sword");
    expect(m.run("return tostring(NS.council.current)")).toBe("nil");
  });

  it("a priority popup opens for an officer's OPENP and the answer goes back", () => {
    const s = withCouncil("RAID", false);
    s.run(`NS.isOfficerName = function(n) return n == "Boss" end`);
    s.run(`fire_event("CHAT_MSG_ADDON", "GuildedLC", "OPENP|55|45|250|Sword", "RAID", "Rando")`);
    expect(s.run("return tostring(NS.council.incoming)")).toBe("nil");
    s.run(`fire_event("CHAT_MSG_ADDON", "GuildedLC", "OPENP|55|45|250|Sword", "RAID", "Boss")`);
    expect(s.run("return NS.council.incoming.kind .. ':' .. NS.council.incoming.price")).toBe("priority:250");
    s.run(`NS.commandHandlers["council"]({ "want" })`);
    expect(s.run("return SENT[1]")).toBe("ADDON:WHISPER:Boss:RESP|55|want|");
  });
});
