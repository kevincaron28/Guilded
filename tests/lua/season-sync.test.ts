import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";
let session: LuaSession | undefined;
afterEach(() => session?.close());
function setup() {
  session = newLuaSession(); session.run("NS = {}; GuildedDB = nil");
  session.load("Core.lua"); session.load("Compat.lua"); session.load("Modules/SeasonSync.lua");
  session.run(`fire_event("PLAYER_LOGIN"); NS.isGuildMember = function() return true end
    NS.isOfficerName = function(name) return name == "Officer" or name == "SecondOfficer" end
    NS.util.tooFarAhead = function() return false end`);
  return session;
}
describe("official season relay for addon-only members", () => {
  it("accepts an officer snapshot with current and past seasons, ignores outsiders and older data", () => {
    const s = setup();
    const text = "BOARD|2026-09-30T10:00:00Z|1|1|S;Season 2;ACTIVE\nR;Ann;50\nS;Season 1;ENDED\nR;Bob%3BAlt;80";
    s.run(`fire_event("CHAT_MSG_ADDON", "GuildedSeason", ${JSON.stringify(text)}, "GUILD", "Stranger")`);
    expect(s.run("return tostring(GuildedDungeonBoard)")).toBe("nil");
    s.run(`fire_event("CHAT_MSG_ADDON", "GuildedSeason", ${JSON.stringify(text)}, "GUILD", "Officer")`);
    expect(s.run("return GuildedDungeonBoard.rows[1].points")).toBe("50");
    expect(s.run("return GuildedDungeonBoard.history[1].rows[1].name")).toBe("Bob;Alt");
    s.run(`fire_event("CHAT_MSG_ADDON", "GuildedSeason", "BOARD|2026-09-29T10:00:00Z|1|1|S;Old;ACTIVE", "GUILD", "Officer")`);
    expect(s.run("return GuildedDungeonBoard.season")).toBe("Season 2");
  });
  it("does not combine chunks from different senders or accept out-of-range parts", () => {
    const s = setup();
    s.run(`fire_event("CHAT_MSG_ADDON", "GuildedSeason", "BOARD|2026-09-30T10:00:00Z|1|2|S;Season 2;ACTIVE\\n", "GUILD", "Officer")
      fire_event("CHAT_MSG_ADDON", "GuildedSeason", "BOARD|2026-09-30T10:00:00Z|2|2|R;Ann;50", "GUILD", "SecondOfficer")
      fire_event("CHAT_MSG_ADDON", "GuildedSeason", "BOARD|2026-09-30T10:00:00Z|3|2|R;Ann;50", "GUILD", "Officer")`);
    expect(s.run("return tostring(GuildedDungeonBoard)")).toBe("nil");
    s.run(`fire_event("CHAT_MSG_ADDON", "GuildedSeason", "BOARD|2026-09-30T10:00:00Z|2|2|R;Ann;50", "GUILD", "Officer")`);
    expect(s.run("return GuildedDungeonBoard.rows[1].points")).toBe("50");
  });
});

describe("season board sharing between officers", () => {
  // An officer holding the 30 September board. Timers wait until a test runs them: answers to
  // REQUEST are delayed by a few seconds.
  function officer() {
    const s = setup();
    s.run(`NOW = 1800000000; time = function() return NOW end
      NS.isOfficer = function() return true end
      TIMERS = {}
      C_Timer = { After = function(delay, fn) TIMERS[#TIMERS + 1] = { delay = delay, fn = fn } end }
      function run_replies()
        local due = {}
        for i = #TIMERS, 1, -1 do if TIMERS[i].delay <= 6 then table.insert(due, 1, table.remove(TIMERS, i)) end end
        for _, timer in ipairs(due) do timer.fn() end
      end
      function boards() local n = 0; for _, m in ipairs(SENT or {}) do if string.find(m.text, "^BOARD|") then n = n + 1 end end; return tostring(n) end
      NS.getDb().dungeonBoard = { season = "Season 2", status = "ACTIVE", updatedAt = "2026-09-30T10:00:00Z", rows = { { name = "Ann", points = 50 } } }
      SENT = {}`);
    return s;
  }
  const request = (from: string) => `fire_event("CHAT_MSG_ADDON", "GuildedSeason", "REQUEST|0", "GUILD", "${from}")`;
  const heard = (stamp: string) => `fire_event("CHAT_MSG_ADDON", "GuildedSeason", "BOARD|${stamp}|1|2|S;Season 2;ACTIVE", "GUILD", "Officer")`;

  it("answers a burst of requests once, a few seconds later, and keeps the one-minute cooldown", () => {
    const s = officer();
    s.run(`${request("Amy")}; ${request("Bob")}; ${request("Cid")}`);
    expect(s.run("return boards()")).toBe("0");
    expect(s.run("return #TIMERS")).toBe("1");
    expect(Number(s.run("return TIMERS[1].delay"))).toBeGreaterThanOrEqual(1);
    expect(Number(s.run("return TIMERS[1].delay"))).toBeLessThanOrEqual(5);
    s.run("run_replies()");
    expect(s.run("return boards()")).toBe("1");
    expect(s.run("return SENT[1].text")).toBe("BOARD|2026-09-30T10:00:00Z|1|1|S;Season 2;ACTIVE\nR;Ann;50");
    s.run(`NOW = NOW + 30; ${request("Dee")}; run_replies()`);
    expect(s.run("return boards()")).toBe("1");
    s.run(`NOW = NOW + 31; ${request("Dee")}; run_replies()`);
    expect(s.run("return boards()")).toBe("2");
  });

  it("stays quiet while another officer is already sending the same or a newer board", () => {
    const s = officer();
    s.run(`${request("Amy")}; ${heard("2026-09-30T10:00:00Z")}; run_replies()`);
    expect(s.run("return boards()")).toBe("0");
    s.run(`NOW = NOW + 61; ${heard("2026-10-01T10:00:00Z")}; ${request("Bob")}; run_replies()`);
    expect(s.run("return boards()")).toBe("0");
    // A minute later nobody else has sent anything: this officer answers.
    s.run(`NOW = NOW + 61; ${request("Cid")}; run_replies()`);
    expect(s.run("return boards()")).toBe("1");
  });

  it("answers when the only board heard in the last minute is older than its own", () => {
    const s = officer();
    s.run(`${heard("2026-09-30T10:00:00Z")}; NOW = NOW + 61; ${heard("2026-09-29T10:00:00Z")}; ${request("Amy")}; run_replies()`);
    expect(s.run("return boards()")).toBe("1");
  });

  it("answers at once without C_Timer, and members never answer", () => {
    const s = officer();
    s.run(`NS.isOfficer = function() return false end; ${request("Amy")}`);
    expect(s.run("return #TIMERS .. boards()")).toBe("00");
    s.run(`NS.isOfficer = function() return true end; C_Timer = nil; ${request("Amy")}`);
    expect(s.run("return boards()")).toBe("1");
  });
});
