import { afterEach, describe, expect, it } from "vitest";
import { standingsToLua } from "../../companion/standings-format.mjs";
import { newLuaSession, type LuaSession } from "./harness.js";
const sessions: LuaSession[] = [];
afterEach(() => { for (const s of sessions) s.close(); sessions.length = 0; });

const brackets = [{ key: "15-29", min: 15, max: 29, bestCount: 5 }, { key: "30-44", min: 30, max: 44, bestCount: 5 }];
const board = { id: "s1", season: "Season 1 · November 2026", status: "ACTIVE", ratingVersion: 6, brackets,
  rows: [{ name: "Tester", points: 900, bracket: "15-29" }, { name: "Officer", points: 700, bracket: "15-29" }],
  week: { startsAt: "2026-11-10T15:00:00.000Z", endsAt: "2026-11-17T15:00:00.000Z",
    rows: [{ name: "Officer", points: 300, bracket: "15-29" }, { name: "Tester", points: 200, bracket: "15-29" }] } };

function panel(level = 25) {
  const s = newLuaSession(); sessions.push(s);
  s.run(`NS={}; GuildedDB=nil; CLOCK=100; function GetTime() return CLOCK end; function UnitLevel() return ${level} end`);
  for (const file of ["Core.lua", "Modules/Scores.lua", "Modules/SeasonDetails.lua", "Modules/DungeonScorePanel.lua"]) s.load(file);
  s.run(`fire_event("PLAYER_LOGIN"); DB=NS.getDb()
    DB.roster.Officer={inGuild=true}; DB.roster.Tester={inGuild=true}
    NS.isOfficer=function() return false end; NS.isOfficerName=function(n) return n=="Officer" end`);
  return s;
}

describe("weekly board in the addon", () => {
  it("writes the week through the companion; older boards without it stay month-only", () => {
    const s = panel();
    s.run(standingsToLua({ updatedAt: "stamp", standings: [], dungeonBoard: board }));
    s.run("DB.dungeonBoard=GuildedDungeonBoard");
    expect(s.run("return GuildedDungeonBoard.week.startsAt .. ' ' .. #GuildedDungeonBoard.week.rows .. GuildedDungeonBoard.week.rows[1].bracket")).toBe("2026-11-10T15:00:00.000Z 215-29");
    expect(s.run('local m=NS.dungeonScorePanel.model("Tester",1,nil,"week"); return m.period .. " " .. m.rows[1].name .. " " .. m.weekOwn')).toBe("week Officer 200");
    expect(s.run('local m=NS.dungeonScorePanel.model("Tester",1); return m.period .. " " .. m.rows[1].name')).toBe("month Tester");
    const old = panel();
    old.run(standingsToLua({ updatedAt: "stamp", standings: [], dungeonBoard: { ...board, week: undefined } }));
    old.run("DB.dungeonBoard=GuildedDungeonBoard");
    expect(old.run('local m=NS.dungeonScorePanel.model("Tester",1,nil,"week"); return m.period .. tostring(m.hasWeek)')).toBe("monthfalse");
  });

  it("toggles Week / Month next to the bracket switch", () => {
    const s = panel();
    s.run(standingsToLua({ updatedAt: "stamp", standings: [], dungeonBoard: board }));
    s.run(`DB.dungeonBoard=GuildedDungeonBoard
      local oldCreate = CreateFrame
      function CreateFrame(...)
        local f = oldCreate(...)
        f.CreateFontString = function() return CreateFrame() end
        f.CreateTexture = function() return CreateFrame() end
        f.SetText = function(self, text) self.text = text end
        f.GetFrameLevel = function() return 1 end
        return f
      end
      P = NS.dungeonScorePanel.build(UIParent); P.mode = "season"; P:Refresh()`);
    expect(s.run("return P.periodButton.text")).toBe("This month");
    s.run('P.periodButton:GetScript("OnClick")()');
    expect(s.run("return P.periodButton.text")).toBe("This week");
    expect(s.run("return P.summary.text")).toContain("Your score this week: 200");
    expect(s.run("return P.rankings.text")).toBe("1. Officer - 300\n2. Tester - 200");
    s.run('P.periodButton:GetScript("OnClick")()');
    expect(s.run("return P.period")).toBe("month");
  });
});

describe("weekly board sync between guildmates", () => {
  function sync() {
    const s = newLuaSession(); sessions.push(s);
    s.run("NS = {}; GuildedDB = nil");
    s.load("Core.lua"); s.load("Compat.lua"); s.load("Modules/SeasonSync.lua");
    s.run(`fire_event("PLAYER_LOGIN"); NS.isGuildMember = function(name) return name ~= "Stranger" end
      NS.isOfficerName = function(name) return name == "Officer" end
      NS.util.tooFarAhead = function() return false end`);
    return s;
  }
  const stamp = "2026-11-12T10:00:00Z";
  const send = (s: LuaSession, text: string, from = "Officer") => s.run(`fire_event("CHAT_MSG_ADDON", "GuildedSeason", ${JSON.stringify(text)}, "GUILD", "${from}")`);
  const week = `WEEK|${stamp}|1|1|W;2026-11-10T15:00:00Z\nR;Ann;15-29;300\nR;Bob;;120`;

  it("adds the week to the board it kept (from its sender only) and passes it on", () => {
    const s = sync();
    send(s, `BOARD|${stamp}|1|1|S;Season 1;ACTIVE\nR;Ann;800`);
    send(s, week, "Stranger");
    expect(s.run("return tostring(NS.getDb().dungeonBoard.week)")).toBe("nil");
    send(s, week);
    expect(s.run("local w=NS.getDb().dungeonBoard.week; return w.startsAt .. ' ' .. w.rows[1].name .. w.rows[1].bracket .. w.rows[1].points .. ' ' .. tostring(w.rows[2].bracket)")).toBe("2026-11-10T15:00:00Z Ann15-29300 nil");
    s.run(`NOW = 1800000000; time = function() return NOW end; NS.isOfficer = function() return true end
      C_Timer = { After = function(_, fn) fn() end }; SENT = {}`);
    s.run(`fire_event("CHAT_MSG_ADDON", "GuildedSeason", "REQUEST|0", "GUILD", "Amy")`);
    expect(s.run('for _, m in ipairs(SENT) do if string.find(m.text, "^WEEK|") then return m.text end end')).toBe(week);
  });

  it("refuses malformed week lines, and older-style boards ignore WEEK", () => {
    const s = sync();
    send(s, `BOARD|${stamp}|1|1|S;Season 1;ACTIVE\nR;Ann;800`);
    send(s, `WEEK|${stamp}|1|1|W;tuesday\nR;Ann;15-29;300`);
    send(s, `WEEK|${stamp}|1|1|W;2026-11-10T15:00:00Z\nR;Ann;BAD;300`);
    send(s, `WEEK|${stamp}|1|1|R;Ann;15-29;300`);
    expect(s.run("return tostring(NS.getDb().dungeonBoard.week)")).toBe("nil");
    // The BOARD itself is unchanged by the week message.
    expect(s.run("return #NS.getDb().dungeonBoard.rows")).toBe("1");
  });
});
