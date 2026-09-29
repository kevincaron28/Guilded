import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

// 5.0 in game: GP deduction, game rules in chat.
let session: LuaSession | undefined;
afterEach(() => { session?.close(); session = undefined; });

function loggedIn(): LuaSession {
  session = newLuaSession();
  session.run(`GuildedDB = nil; SLASH = SlashCmdList; NS = {}; MOCK_UNITS = { player = { name = "Kev" } }`);
  session.load("Core.lua");
  session.run(`fire_event("PLAYER_LOGIN")`);
  return session;
}

describe("deduct GP", () => {
  it("takes GP back as an ADJUSTMENT the bot imports, never below zero", () => {
    const s = loggedIn();
    s.run(`SlashCmdList["GUILDED"]("gp Ann 30 Sword")`);
    s.run(`SlashCmdList["GUILDED"]("gpdeduct Ann 10 Charged twice")`);
    const account = () => s.run(`local a = GuildedDB.epgp.Ann; local e = a.ledger[#a.ledger]; return a.gp .. "|" .. e.type .. "|" .. e.gpAmount .. "|" .. e.epAmount .. "|" .. e.reason`);
    expect(account()).toBe("20|ADJUSTMENT|-10|0|Charged twice");

    s.run(`SlashCmdList["GUILDED"]("gpdeduct Ann 50 Returned")`);
    expect(account()).toBe("0|ADJUSTMENT|-20|0|Returned");

    s.run(`SlashCmdList["GUILDED"]("gpdeduct Ann 5 Again")`);
    expect(s.chat().join("\n")).toContain("Ann has no GP to deduct.");
    expect(s.run(`return #GuildedDB.epgp.Ann.ledger`)).toBe("3");
  });
});

function withGames(grouped: boolean): LuaSession {
  session = newLuaSession();
  session.run(String.raw`
    function IsInGroup() return ${grouped} end
    function IsInRaid() return false end
    C_Timer = { After = function(_, fn) fn() end }
    SENT_CHAT = {}
    C_ChatInfo = { SendChatMessage = function(text, channel) SENT_CHAT[#SENT_CHAT + 1] = channel .. ":" .. text end }
    NS = {
      isSecret = function() return false end,
      normalizeName = function(n) return n end,
      playerName = function() return "Host" end,
      parseRoll = function() return nil end,
      message = function(text) CHAT_LOG = CHAT_LOG or {}; CHAT_LOG[#CHAT_LOG + 1] = text end,
      commandHandlers = {}, commandHelp = {}
    }
  `);
  session.load("Modules/Games.lua");
  return session;
}
const game = (s: LuaSession, line: string) => s.run(`local a = {}; for w in string.gmatch(${JSON.stringify(line)}, "%S+") do a[#a + 1] = w end; NS.commandHandlers["games"](a)`);
const sent = (s: LuaSession) => s.run(`return table.concat(SENT_CHAT, "\\n")`);

describe("games: explain the rules in chat", () => {
  it("posts each game's rules in party chat, with the running game's roll size", () => {
    const s = withGames(true);
    game(s, "explain deathroll");
    expect(sent(s)).toContain("PARTY:[Guilded] How Deathroll works");
    expect(sent(s)).toContain("/roll 100");
    expect(sent(s)).toContain("Last one left wins.");

    s.run(`SENT_CHAT = {}`);
    game(s, "highroll 500");
    s.run(`SENT_CHAT = {}`);
    game(s, "explain");
    expect(sent(s)).toContain("How High Roll works");
    expect(sent(s)).toContain("/roll 500");
  });

  it("uses /say when you are not grouped, and asks which game when none is named or running", () => {
    const s = withGames(false);
    game(s, "explain duel");
    expect(sent(s)).toContain("SAY:[Guilded] How a deathroll duel works");
    game(s, "explain");
    expect(s.chat().join("\n")).toContain("Which game?");
  });

  it("every rule line fits one chat message", () => {
    const s = withGames(true);
    expect(s.run(`local n = 0; for _, lines in pairs(NS.games.RULES) do for _, l in ipairs(lines) do n = math.max(n, #string.format(l, 1000000)) end end; return n`)).toSatisfy((n: string) => Number(n) <= 230);
  });
});
