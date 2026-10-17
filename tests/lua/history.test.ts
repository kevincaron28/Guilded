import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

// Modules/History.lua: a member asks for their EP/GP and loot history; one officer answers.
let session: LuaSession | undefined;
afterEach(() => { session?.close(); session = undefined; });

function withHistory(me: string, officer: boolean): LuaSession {
  session = newLuaSession();
  session.run(String.raw`
    SENT = {}
    local T = 0
    function GetTime() T = T + 10; return T end
    function IsInGuild() return true end
    TIMERS = {}
    C_Timer = { After = function(_, fn) TIMERS[#TIMERS + 1] = fn end }
    C_ChatInfo = {
      SendAddonMessage = function(_, text, ch, target) SENT[#SENT + 1] = { text = text, ch = ch, target = target } end,
      RegisterAddonMessagePrefix = function() return true end
    }
    DB = {
      epgp = { Amy = { ledger = {
        { id = "Boss-1", epAmount = 10, gpAmount = 0, reason = "On time", at = "2026-10-14T20:00:00Z" },
        { id = "Boss-2", epAmount = 0, gpAmount = 40, reason = "Sword", at = "2026-10-15T20:00:00Z" },
        { id = "Boss-3", epAmount = 5, gpAmount = 0, reason = "Mistake", at = "2026-10-16T20:00:00Z", voided = "x" },
      } } },
      loot = { { player = "Amy", item = "Felheart Gloves", cost = 40, at = "2026-10-15T20:01:00Z" } }
    }
    CHAT_LOG = {}
    NS = {
      L = function(t) return t end,
      getDb = function() return DB end,
      isOfficer = function() return ${officer} end,
      isOfficerName = function(n) return n == "Boss" or n == "Kay" end,
      isSecret = function() return false end,
      normalizeName = function(n) if not n then return nil end return (string.gsub(n, "%-.*", "")) end,
      playerName = function() return "${me}" end,
      message = function(text) CHAT_LOG[#CHAT_LOG + 1] = text end,
      commandHandlers = {}, commandHelp = {}
    }
  `);
  session.load("Modules/History.lua");
  session.run(`fire_event("PLAYER_LOGIN")`);
  return session;
}
const addon = (s: LuaSession, from: string, text: string, channel = "GUILD") =>
  s.run(`fire_event("CHAT_MSG_ADDON", "GuildedHist", ${JSON.stringify(text)}, ${JSON.stringify(channel)}, ${JSON.stringify(from)})`);
const chat = (s: LuaSession) => s.run(`return table.concat(CHAT_LOG, "\\n")`);

describe("History.lua", () => {
  it("an officer reads a player's history from this PC's ledger, without voided entries", () => {
    const s = withHistory("Boss", true);
    s.run(`NS.commandHandlers.history({ "Amy" })`);
    const out = chat(s);
    expect(out).toContain("History of Amy");
    expect(out).toContain("+40 GP (Sword)");
    expect(out).toContain("+10 EP (On time)");
    expect(out).toContain("loot: Felheart Gloves (40 GP)");
    expect(out).not.toContain("Mistake");
  });

  it("an officer answers a member's own request once, by whisper, and another officer stays quiet", () => {
    const s = withHistory("Boss", true);
    addon(s, "Amy-Realm", "REQ|Amy");
    s.run(`TIMERS[#TIMERS]()`);
    expect(s.run(`local n = 0; for _, m in ipairs(SENT) do if m.ch == "WHISPER" and m.target == "Amy-Realm" then n = n + 1 end end; return n`)).toBe("3");
    expect(s.run(`local n = 0; for _, m in ipairs(SENT) do if m.text == "DONE|Amy" then n = n + 1 end end; return n`)).toBe("1");
    // Asking for someone else's history is ignored.
    s.run(`SENT = {}`); addon(s, "Amy-Realm", "REQ|Bob");
    expect(s.run(`return #TIMERS`)).toBe("1");
  });

  it("an officer who heard another officer answer does not answer again", () => {
    const s = withHistory("Kay", true);
    addon(s, "Amy-Realm", "REQ|Amy");
    addon(s, "Boss-Realm", "DONE|Amy");
    s.run(`SENT = {}; TIMERS[#TIMERS]()`);
    expect(s.run(`return #SENT`)).toBe("0");
  });

  it("a member asks the guild and shows the officer's whispered rows", () => {
    const s = withHistory("Amy", false);
    s.run(`DB = { epgp = {}, loot = {} }; NS.commandHandlers.history({})`);
    expect(s.run(`return SENT[#SENT].text .. ":" .. SENT[#SENT].ch`)).toBe("REQ|Amy:GUILD");
    addon(s, "Boss-Realm", "ROW|1|2|15/10 +40 GP (Sword)", "WHISPER");
    addon(s, "Boss-Realm", "ROW|2|2|14/10 +10 EP (On time)", "WHISPER");
    const out = chat(s);
    expect(out).toContain("from Boss's ledger");
    expect(out).toContain("+40 GP (Sword)");
    // Members cannot ask for someone else.
    s.run(`CHAT_LOG = {}; NS.commandHandlers.history({ "Bob" })`);
    expect(chat(s)).toContain("own history only");
  });

  it("rows from a non-officer are ignored", () => {
    const s = withHistory("Amy", false);
    s.run(`DB = { epgp = {}, loot = {} }; NS.commandHandlers.history({})`);
    addon(s, "Mallory-Realm", "ROW|1|1|+9999 EP (fake)", "WHISPER");
    expect(chat(s)).not.toContain("fake");
  });
});
