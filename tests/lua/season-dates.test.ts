import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

let session: LuaSession | undefined;
afterEach(() => session?.close());

// A board whose current season started 1 October and whose past season ran in September.
const DATED = `{ season = "Beta Best 8", status = "ACTIVE", updatedAt = "2026-10-12T10:00:00Z", startsAt = "2026-10-01T00:00:00.000Z",
  rows = { { name = "Ann", points = 50 } },
  history = { { season = "Exploration", status = "ENDED", startsAt = "2026-09-01T00:00:00Z", endsAt = "2026-10-01T00:00:00Z", rows = {} },
    { season = "Undated", status = "ENDED", rows = {} } } }`;

describe("season dates in the in-game relay (6.3)", () => {
  function setup() {
    session = newLuaSession(); session.run("NS = {}; GuildedDB = nil");
    session.load("Core.lua"); session.load("Compat.lua"); session.load("Modules/SeasonSync.lua");
    session.run(`fire_event("PLAYER_LOGIN"); NS.isGuildMember = function(name) return name ~= "Stranger" end
      NS.isOfficerName = function(name) return name == "Officer" end
      NS.isOfficer = function() return true end
      NS.util.tooFarAhead = function() return false end`);
    return session;
  }
  const send = (s: LuaSession, from: string, text: string) => s.run(`fire_event("CHAT_MSG_ADDON", "GuildedSeason", ${JSON.stringify(text)}, "GUILD", "${from}")`);

  it("sends the BOARD payload unchanged for older clients and the dates in a separate DATES message", () => {
    const s = setup();
    s.run(`NS.getDb().dungeonBoard = ${DATED}; SENT = {}; C_Timer = nil`);
    send(s, "Amy", "REQUEST|0");
    expect(s.run(`local out = {}; for _, m in ipairs(SENT) do out[#out + 1] = m.text end; return table.concat(out, "#")`)).toBe(
      "BOARD|2026-10-12T10:00:00Z|1|1|S;Beta Best 8;ACTIVE\nR;Ann;50\nS;Exploration;ENDED\nS;Undated;ENDED" +
      "#DATES|2026-10-12T10:00:00Z|1|1|D;1;2026-10-01T00:00:00Z;\nD;2;2026-09-01T00:00:00Z;2026-10-01T00:00:00Z\nD;3;;");
  });

  it("keeps the dates when a guildmate relays the board, and refuses them from anyone else", () => {
    const s = setup();
    const stamp = "2026-10-12T10:00:00Z";
    send(s, "Amy", `BOARD|${stamp}|1|1|S;Beta Best 8;ACTIVE\nR;Ann;50\nS;Exploration;ENDED`);
    send(s, "Bob", `DATES|${stamp}|1|1|D;1;2020-01-01T00:00:00Z;`);
    expect(s.run("return tostring(GuildedDungeonBoard.startsAt)")).toBe("nil");
    send(s, "Amy", `DATES|${stamp}|1|2|D;1;2026-10-01T00:00:00Z;\n`);
    send(s, "Amy", `DATES|${stamp}|2|2|D;2;2026-09-01T00:00:00Z;2026-10-01T00:00:00Z`);
    expect(s.run("return GuildedDungeonBoard.startsAt .. '|' .. tostring(GuildedDungeonBoard.endsAt)")).toBe("2026-10-01T00:00:00Z|nil");
    expect(s.run("return NS.getDb().dungeonBoard.history[1].endsAt")).toBe("2026-10-01T00:00:00Z");
    // Dates for a season the board does not have, or malformed dates, are refused whole.
    send(s, "Amy", `DATES|${stamp}|1|1|D;1;2026-10-05T00:00:00Z;\nD;9;2026-09-01T00:00:00Z;`);
    send(s, "Amy", `DATES|${stamp}|1|1|D;1;yesterday;`);
    expect(s.run("return GuildedDungeonBoard.startsAt")).toBe("2026-10-01T00:00:00Z");
    // Dates for another stamp are ignored.
    send(s, "Amy", `DATES|2026-10-11T10:00:00Z|1|1|D;1;2026-10-05T00:00:00Z;`);
    expect(s.run("return GuildedDungeonBoard.startsAt")).toBe("2026-10-01T00:00:00Z");
  });

  it("does not let a relay rewrite the dates the companion brought from Discord", () => {
    const s = setup();
    s.run(`NS.getDb().dungeonBoard = ${DATED}`);
    send(s, "Amy", "DATES|2026-10-12T10:00:00Z|1|1|D;1;2020-01-01T00:00:00Z;");
    expect(s.run("return NS.getDb().dungeonBoard.startsAt")).toBe("2026-10-01T00:00:00.000Z");
  });
});

describe("season label under Recent runs", () => {
  function setup() {
    session = newLuaSession(); session.run("NS = {}; GuildedDB = nil");
    session.load("Core.lua"); session.load("Modules/DungeonScorePanel.lua");
    session.run(`fire_event("PLAYER_LOGIN"); DB = NS.getDb(); DB.dungeonBoard = ${DATED}`);
    return session;
  }
  const seasonFor = (s: LuaSession, at: string) => s.run(`return tostring(NS.dungeonScorePanel.seasonFor(${at}))`);

  it("names the season whose dates contain the run's end, by ISO text or seconds", () => {
    const s = setup();
    expect(seasonFor(s, `"2026-10-12T18:44:00Z"`)).toBe("Beta Best 8");
    expect(seasonFor(s, `"2026-09-20T18:44:00Z"`)).toBe("Exploration");
    expect(seasonFor(s, `NS.util.isoEpoch("2026-09-20T18:44:00Z")`)).toBe("Exploration");
    // The end is exclusive: a run at the change-over belongs to the new season.
    expect(seasonFor(s, `"2026-10-01T00:00:00Z"`)).toBe("Beta Best 8");
    // Before every known season, or with an undated board: no label.
    expect(seasonFor(s, `"2026-08-20T18:44:00Z"`)).toBe("nil");
    s.run(`DB.dungeonBoard = { season = "Old board", status = "ACTIVE", rows = {} }`);
    expect(seasonFor(s, `"2026-10-12T18:44:00Z"`)).toBe("nil");
    expect(seasonFor(s, "nil")).toBe("nil");
  });

  it("adds the season after the run's date in Recent runs", () => {
    const s = setup();
    s.run(`DB.dungeon = { runs = { a = { name = "The Hall of Thanes", state = "COMPLETED", durationSec = 1345,
        endedAt = NS.util.isoEpoch("2026-10-12T18:44:00Z"), players = { Tester = {} } },
      b = { name = "Older", state = "COMPLETED", durationSec = 60, endedAt = NS.util.isoEpoch("2026-08-12T18:44:00Z"), players = { Tester = {} } } } }
      local oldCreate = CreateFrame
      function CreateFrame(...)
        local f = oldCreate(...)
        f.CreateFontString = function() return CreateFrame() end
        f.CreateTexture = function() return CreateFrame() end
        f.SetText = function(self, text) self.text = text end
        f.GetFrameLevel = function() return 1 end
        return f
      end
      P = NS.dungeonScorePanel.build(UIParent)
      P.runView:Refresh()`);
    const text = s.run("return P.runView.recent.text");
    expect(text).toMatch(/^The Hall of Thanes - 22:25 - COMPLETED - \d\d\/\d\d \d\d:\d\d - Season: Beta Best 8\n\nOlder - 1:00 - COMPLETED - \d\d\/\d\d \d\d:\d\d$/);
  });
});
