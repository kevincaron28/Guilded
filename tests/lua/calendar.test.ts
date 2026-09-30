import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

let session: LuaSession | undefined;
afterEach(() => { session?.close(); session = undefined; });

const utc = (y: number, m: number, d: number, h: number, min = 0) => Math.floor(Date.UTC(y, m - 1, d, h, min) / 1000);

// The server clock is 3 hours ahead of UTC (it says 20:00 when it is 17:00 UTC), on 2026-10-01.
function withCalendar(options: { api?: boolean; officer?: boolean } = {}): LuaSession {
  const { api = true, officer = true } = options;
  session = newLuaSession();
  session.run(String.raw`
    NOW_UTC = ${utc(2026, 10, 1, 17)}
    function GetServerTime() return NOW_UTC end
    C_DateAndTime = { GetCurrentCalendarTime = function() return { year = 2026, month = 10, monthDay = 1, hour = 20, minute = 0 } end }
    C_Timer = { After = function(_, fn) fn() end }
    CREATED = {}
    OPENED = nil
    EVENTS = {
      [2] = {
        { title = "Molten Core", calendarType = "GUILD_EVENT", eventID = 501, startTime = { year = 2026, month = 10, monthDay = 2, hour = 21, minute = 0 },
          invites = { { name = "Ann-Realm", inviteStatus = 1 }, { name = "Bob", inviteStatus = 8 }, { name = "Cy", inviteStatus = 2 }, { name = "Dee", inviteStatus = 0 }, { name = "Eve", inviteStatus = 3 } } },
        { title = "Someone's party", calendarType = "PLAYER", startTime = { year = 2026, month = 10, monthDay = 2, hour = 22, minute = 0 }, invites = {} },
      }
    }
    if ${api} then
      C_Calendar = {
        OpenCalendar = function() end, SetAbsMonth = function() end, CanAddEvent = function() return true end,
        GetNumDayEvents = function(monthOffset, day) return monthOffset == 0 and EVENTS[day] and #EVENTS[day] or 0 end,
        GetDayEvent = function(monthOffset, day, index) return EVENTS[day][index] end,
        OpenEvent = function(monthOffset, day, index) OPENED = EVENTS[day][index] end,
        CloseEvent = function() OPENED = nil end,
        GetNumInvites = function() return OPENED and #OPENED.invites or 0 end,
        EventGetInvite = function(i) return OPENED.invites[i] end,
        CreateGuildSignUpEvent = function() CREATED = { kind = "guild" } end,
        EventSetTitle = function(t) CREATED.title = t end,
        EventSetDescription = function(t) CREATED.description = t end,
        EventSetDate = function(month, day, year) CREATED.date = year .. "-" .. month .. "-" .. day end,
        EventSetTime = function(hour, minute) CREATED.time = hour .. ":" .. minute end,
        AddEvent = function() CREATED.added = true end
      }
    end
    DB = {}
    NS = {
      L = function(t) return t end,
      isOfficer = function() return ${officer} end,
      normalizeName = function(n) return (string.gsub(n or "", "%-.*", "")) end,
      now = function() return "2026-10-01T17:00:00Z" end,
      message = function(text) CHAT_LOG = CHAT_LOG or {}; CHAT_LOG[#CHAT_LOG + 1] = text end,
      getDb = function() return DB end,
      commandHandlers = {}, commandHelp = {}
    }
  `);
  session.load("Modules/Calendar.lua");
  return session;
}

const cmd = (s: LuaSession, line: string) =>
  s.run(`local a = {}; for w in string.gmatch(${JSON.stringify(line)}, "%S+") do a[#a + 1] = w end; NS.commandHandlers["calendar"](a)`);
const last = (s: LuaSession) => s.run("return CHAT_LOG[#CHAT_LOG]");

describe("Calendar.lua time", () => {
  it("turns a server clock time into UTC and back, whatever the time zone of this PC", () => {
    const s = withCalendar();
    // 21:00 on the server (3 hours ahead of UTC) is 18:00 UTC.
    expect(s.run(`return NS.calendar.eventEpoch({ year = 2026, month = 10, monthDay = 2, hour = 21, minute = 0 })`)).toBe(String(utc(2026, 10, 2, 18)));
    const clock = s.run(`local c = NS.calendar.serverClock(${utc(2026, 10, 2, 18)}); return c.year .. "-" .. c.month .. "-" .. c.monthDay .. " " .. c.hour .. ":" .. c.minute`);
    expect(clock).toBe("2026-10-2 21:0");
  });

  it("reads Discord's ISO time", () => {
    const s = withCalendar();
    expect(s.run(`return NS.calendar.isoEpoch("2026-10-02T18:00:00.000Z")`)).toBe(String(utc(2026, 10, 2, 18)));
    expect(s.run(`return tostring(NS.calendar.isoEpoch("garbage"))`)).toBe("nil");
  });
});

describe("Calendar.lua reading the guild calendar", () => {
  it("reads guild events with who answered what, and skips other kinds of events", () => {
    const s = withCalendar();
    cmd(s, "sync");
    expect(last(s)).toContain("1 guild event(s) with 4 answer(s) read");
    expect(s.run("return #DB.calendarEvents.events")).toBe("1");
    const event = "DB.calendarEvents.events[1]";
    expect(s.run(`return ${event}.title .. "|" .. ${event}.ref .. "|" .. ${event}.startsAt`)).toBe(`Molten Core|501|${utc(2026, 10, 2, 18)}`);
    // Accepted and confirmed count as coming, tentative as maybe, declined as declined; "invited" says nothing.
    expect(s.run(`local t = {}; for _, i in ipairs(${event}.invites) do t[#t + 1] = i.name .. ":" .. i.status end; return table.concat(t, ",")`))
      .toBe("Ann:ACCEPTED,Bob:TENTATIVE,Cy:DECLINED,Eve:ACCEPTED");
    // The scratch fields used while reading are not saved.
    expect(s.run(`return tostring(${event}.monthOffset)`)).toBe("nil");
  });

  it("only officers scan by hand", () => {
    const s = withCalendar({ officer: false });
    cmd(s, "sync");
    expect(s.run("return tostring(DB.calendarEvents)")).toBe("nil");
  });
  it("reads the explicit raid identity from the opened calendar event", () => {
    const s = withCalendar();
    s.run('C_Calendar.GetEventInfo = function() return { description = "[Guilded raid:raid_core_1] Bring flasks" } end');
    cmd(s, "sync");
    expect(s.run("return DB.calendarEvents.events[1].botRaidId")).toBe("raid_core_1");
  });

  it("says so when the client has no calendar", () => {
    const s = withCalendar({ api: false });
    cmd(s, "sync");
    expect(last(s)).toContain("no calendar for addons");
    expect(s.run("return tostring(DB.calendarEvents)")).toBe("nil");
  });

  it("scans by itself for officers once in a while, quietly", () => {
    const s = withCalendar();
    s.run(`fire_event("PLAYER_LOGIN")`);
    expect(s.run("return #DB.calendarEvents.events")).toBe("1");
    s.run(`DB.calendarEvents = nil; fire_event("PLAYER_LOGIN")`); // too soon for another automatic scan
    expect(s.run("return tostring(DB.calendarEvents)")).toBe("nil");
    const m = withCalendar({ officer: false });
    m.run(`fire_event("PLAYER_LOGIN")`);
    expect(m.run("return tostring(DB.calendarEvents)")).toBe("nil");
  });
});

describe("Calendar.lua making in-game events from Discord raids", () => {
  const RAID = `GuildedRaids = { { id = "r1", title = "Blackwing Lair", at = "2026-10-03T18:00:00.000Z", core = "Tuesday MC", note = "" }, { id = "r2", title = "Molten Core", at = "2026-10-02T18:00:00.000Z", core = "", note = "" } }`;

  it("lists upcoming Discord raids soonest first and says which are already in the calendar", () => {
    const s = withCalendar();
    s.run(RAID);
    cmd(s, "sync");
    cmd(s, "list");
    const text = last(s);
    expect(text).toContain("1. Molten Core - ");
    expect(text).toContain("(in the calendar)");
    expect(text).toMatch(/2\. Blackwing Lair - [^\n]*$/);
    expect(text).not.toMatch(/Blackwing Lair[^\n]*in the calendar/);
  });

  it("creates the event on the server's clock", () => {
    const s = withCalendar();
    s.run(RAID);
    cmd(s, "create 2");
    expect(s.run("return CREATED.title .. '|' .. CREATED.date .. '|' .. CREATED.time .. '|' .. tostring(CREATED.added)")).toBe("Blackwing Lair|2026-10-3|21:0|true");
    expect(s.run("return CREATED.description")).toContain("Tuesday MC");
    expect(s.run("return CREATED.description")).toContain("[Guilded raid:r1]");
    expect(last(s)).toContain("Created the in-game event");
  });
  it("does not mistake another core's linked event for this raid with the same title and time", () => {
    const s = withCalendar();
    s.run('C_Calendar.GetEventInfo = function() return { description = "[Guilded raid:core_a]" } end');
    cmd(s, "sync");
    s.run('RAID_B = { id = "core_b", title = "Molten Core", at = 1790964000 }; RAID_B.at = DB.calendarEvents.events[1].startsAt');
    expect(s.run("return tostring(NS.calendar.alreadyInGame(RAID_B))")).toBe("false");
    s.run('RAID_B.id = "core_a"');
    expect(s.run("return tostring(NS.calendar.alreadyInGame(RAID_B))")).toBe("true");
  });

  it("imports the next missing event without needing a stale saved scan and suppresses repeated clicks", () => {
    const s = withCalendar();
    s.run(RAID);
    s.run("NS.calendar.createMissing()");
    expect(s.run("return CREATED.title")).toBe("Blackwing Lair");
    s.run("CREATED = {}; NS.calendar.createMissing()");
    expect(s.run("return tostring(CREATED.added)")).toBe("nil");
    expect(last(s)).toContain("Waiting for the calendar");
  });

  it("does not create one that is already there, or one in the past, or without the API", () => {
    const s = withCalendar();
    s.run(RAID);
    cmd(s, "sync");
    cmd(s, "create 1"); // Molten Core is in the calendar already
    expect(last(s)).toContain("already in the game calendar");
    expect(s.run("return tostring(CREATED.added)")).toBe("nil");
    s.run(`GuildedRaids = { { id = "old", title = "Old", at = "2026-09-01T18:00:00.000Z" } }`);
    cmd(s, "create");
    expect(last(s)).toContain("No upcoming Discord raid");
    const bare = withCalendar({ api: false });
    bare.run(RAID);
    cmd(bare, "create");
    expect(last(bare)).toContain("cannot create calendar events");
  });

  it("gives a clear message when the game refuses", () => {
    const s = withCalendar();
    s.run(RAID);
    s.run(`C_Calendar.AddEvent = function() error("protected") end`);
    cmd(s, "create");
    expect(last(s)).toContain("Could not create the event");
  });

  it("only officers create events, and no raid means nothing to create", () => {
    const s = withCalendar({ officer: false });
    s.run(RAID);
    cmd(s, "create");
    expect(s.run("return tostring(CREATED.added)")).toBe("nil");
    const t = withCalendar();
    cmd(t, "create");
    expect(last(t)).toContain("No upcoming Discord raid");
  });
});
