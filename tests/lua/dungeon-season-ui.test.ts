import { afterEach, describe, expect, it } from "vitest";
import { standingsToLua } from "../../companion/standings-format.mjs";
import { newLuaSession, type LuaSession } from "./harness.js";

// The dungeon season page (Modules/DungeonScorePanel.lua, 9.1 layout): three tabs (My season,
// Guild board, Runs), two or three actions in view on each, and the rarer ones in the More menu.
const sessions: LuaSession[] = [];
afterEach(() => { for (const s of sessions) s.close(); sessions.length = 0; });

const brackets = [{ key: "15-29", min: 15, max: 29, bestCount: 5 }, { key: "30-44", min: 30, max: 44, bestCount: 5 }];
const season = (name: string, status: string) => ({ id: name, season: name, status, ratingVersion: 6, detailsAvailable: false, brackets,
  rows: [{ name: "Tester", points: 900, bracket: "15-29" }, { name: "Officer", points: 700, bracket: "15-29" }] });
const board = { ...season("Season 2", "ACTIVE"), history: [season("Season 1", "ENDED")],
  week: { startsAt: "2026-11-10T15:00:00.000Z", endsAt: "2026-11-17T15:00:00.000Z",
    rows: [{ name: "Officer", points: 300, bracket: "15-29" }, { name: "Tester", points: 200, bracket: "15-29" }] } };

function panel(lang = "en") {
  const s = newLuaSession(); sessions.push(s);
  s.run(`NS={}; GuildedDB=nil; function UnitLevel() return 25 end; function GetLocale() return "enUS" end
    DUNGEON_CALLS = {}`);
  for (const file of ["Core.lua", "Locale.lua", "Modules/Scores.lua", "Modules/SeasonDetails.lua", "Modules/DungeonScorePanel.lua"]) s.load(file);
  s.run(`fire_event("PLAYER_LOGIN"); DB=NS.getDb(); DB.settings = DB.settings or {}
    NS.getSettings = function() return { language = "${lang}" } end
    DB.roster.Officer={inGuild=true}; DB.roster.Tester={inGuild=true}
    NS.isOfficer=function() return false end; NS.isOfficerName=function(n) return n=="Officer" end
    NS.commandHandlers = NS.commandHandlers or {}
    NS.commandHandlers.dungeon = function(args) DUNGEON_CALLS[#DUNGEON_CALLS + 1] = args[1] end`);
  s.run(standingsToLua({ updatedAt: "stamp", standings: [], dungeonBoard: board }));
  s.run(`DB.dungeonBoard=GuildedDungeonBoard
    local oldCreate = CreateFrame
    function CreateFrame(...)
      local f = oldCreate(...)
      f.shown = true
      f.CreateFontString = function() return CreateFrame() end
      f.CreateTexture = function() return CreateFrame() end
      f.SetText = function(self, text) self.text = text end
      f.GetText = function(self) return self.text end
      f.Show = function(self) self.shown = true end
      f.Hide = function(self) self.shown = false end
      f.IsShown = function(self) return self.shown end
      f.LockHighlight = function(self) self.lit = true end
      f.UnlockHighlight = function(self) self.lit = false end
      f.GetFrameLevel = function() return 1 end
      return f
    end
    P = NS.dungeonScorePanel.build(UIParent); P.mode = "season"; P:Refresh()
    function CLICK(b) b:GetScript("OnClick")(b) end
    function MENU() local t = {} for _, b in ipairs(P.more.items) do if b.wanted then t[#t + 1] = b.text end end return table.concat(t, ",") end`);
  return s;
}

describe("dungeon season page layout", () => {
  it("opens on My season with the score on top and the tab lit", () => {
    const s = panel();
    expect(s.run("return NS.dungeonScorePanel.tabOf(P)")).toBe("season");
    expect(s.run("return tostring(P.seasonTab.lit) .. tostring(P.rankingToggle.lit) .. tostring(P.runTab.lit)")).toBe("truefalsefalse");
    expect(s.run("return P.summary.text")).toContain("Your season score: 900");
    // The board's week switch belongs to the Guild board tab, not this one.
    expect(s.run("return tostring(P.periodButton.shown)")).toBe("false");
  });

  it("keeps bracket and older seasons in the More menu, and they still work", () => {
    const s = panel();
    expect(s.run("return tostring(P.moreButton.shown)")).toBe("true");
    expect(s.run("return MENU()")).toBe("Levels 15-29,Older season");
    s.run("CLICK(P.moreButton)");
    expect(s.run("return tostring(P.more.shown)")).toBe("true");
    // A bracket change keeps the menu open (more than one click is normal); a season change closes it.
    s.run("CLICK(P.bracketButton)");
    expect(s.run("return P.bracket .. ' ' .. tostring(P.more.shown)")).toBe("30-44 true");
    s.run("CLICK(P.olderButton)");
    expect(s.run("return P.seasonIndex .. ' ' .. tostring(P.more.shown) .. ' ' .. P.seasonTitle.text")).toBe("2 false Past season: Season 1");
    expect(s.run("return MENU()")).toBe("Levels 15-29,Newer season");
  });

  it("shows the guild board with its week switch as the primary action", () => {
    const s = panel();
    s.run("CLICK(P.rankingToggle)");
    expect(s.run("return NS.dungeonScorePanel.tabOf(P) .. ' ' .. tostring(P.rankings.shown) .. ' ' .. tostring(P.periodButton.shown)")).toBe("board true true");
    expect(s.run("return P.rankings.text")).toBe("1. Tester - 900\n2. Officer - 700");
    s.run("CLICK(P.periodButton)");
    expect(s.run("return P.periodButton.text .. ' | ' .. P.rankings.text")).toBe("This week | 1. Officer - 300\n2. Tester - 200");
    // Back on My season: the month view and the cards again.
    s.run("CLICK(P.seasonTab)");
    expect(s.run("return P.period .. ' ' .. tostring(P.rankings.shown) .. ' ' .. NS.dungeonScorePanel.tabOf(P)")).toBe("month false season");
  });

  it("puts run corrections behind More with a second click for Complete and Abandon", () => {
    const s = panel();
    s.run("CLICK(P.runTab)");
    expect(s.run("return tostring(P.runView.shown) .. ' ' .. MENU()")).toBe("true Start now,Complete,Abandon");
    expect(s.run("return P.runView.last.text .. ' | ' .. P.runView.timer.text")).toBe("Last result | Live timer: off");
    s.run("CLICK(P.moreButton); CLICK(P.completeButton)");
    expect(s.run("return P.completeButton.text .. ' ' .. tostring(P.more.shown) .. ' ' .. #DUNGEON_CALLS")).toBe("Click again true 0");
    s.run("CLICK(P.completeButton)");
    expect(s.run("return table.concat(DUNGEON_CALLS, ',') .. ' ' .. tostring(P.more.shown) .. ' ' .. P.completeButton.text")).toBe("complete false Complete");
    s.run("CLICK(P.runView.last)");
    expect(s.run("return table.concat(DUNGEON_CALLS, ',')")).toBe("complete,results");
  });

  it("is translated in French, German and Spanish", () => {
    for (const [lang, tab, more] of [["fr", "Ma saison", "Plus"], ["de", "Meine Saison", "Mehr"], ["es", "Mi temporada", "Más"]]) {
      const s = panel(lang);
      expect(s.run("return P.seasonTab.text")).toBe(tab);
      expect(s.run("return P.moreButton.text")).toBe(more);
    }
  });
});
