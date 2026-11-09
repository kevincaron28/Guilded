import { afterEach, describe, expect, it } from "vitest";
import { standingsToLua } from "../../companion/standings-format.mjs";
import { newLuaSession, type LuaSession } from "./harness.js";

// Dungeon stats (Modules/DungeonStats.lua): per-dungeon detail and guild comparison, computed
// from saved runs, shown on the season cards, a detail page and the guild board.
const sessions: LuaSession[] = [];
afterEach(() => { for (const s of sessions) s.close(); sessions.length = 0; });

const board = { id: "S2", season: "Season 2", status: "ACTIVE", ratingVersion: 6, detailsAvailable: false,
  rows: [{ name: "Officer", points: 1200 }, { name: "Tester", points: 900 }, { name: "Third", points: 300 }] };

// RFC runs: two counted for Tester (one completed, one abandoned), a faster one by Officer, and
// runs that must not count (a guest, an invalid run, another game edition, a run Tester barely saw).
const RUNS = `
  DB.dungeon = { runs = {
    r1 = { state="COMPLETED", name="Ragefire Chasm", durationSec=1200, startedAt=1000, endedAt=2200,
      encounters={ {id=1,name="Oggleflint",success=true,at=1300}, {id=2,name="Taragaman",success=true,at=1900} },
      players={ Tester={presentSec=1200,deaths=2}, Officer={presentSec=1200,deaths=0} } },
    r2 = { state="COMPLETED", name="Ragefire Chasm", durationSec=900, startedAt=5000, endedAt=5900,
      encounters={ {id=1,name="Oggleflint",success=true,at=5200}, {id=2,name="Taragaman",success=true,at=5800} },
      players={ Officer={presentSec=900,deaths=1}, Guest={presentSec=900} } },
    r3 = { state="COMPLETED", name="Ragefire Chasm", durationSec=600, startedAt=7000, endedAt=7600,
      encounters={ {id=1,name="Oggleflint",success=true,at=7100} }, players={ Guest={presentSec=600} } },
    r4 = { state="ABANDONED", name="Ragefire Chasm", startedAt=8000, endedAt=8300, players={ Tester={presentSec=300,deaths=1} } },
    r5 = { state="INVALID", name="Ragefire Chasm", durationSec=100, startedAt=9000, endedAt=9100, players={ Tester={deaths=9} } },
    r6 = { state="COMPLETED", name="Ragefire Chasm", gameEdition="classic-era", durationSec=500, startedAt=9500, endedAt=10000, players={ Tester={presentSec=500} } },
    r7 = { state="COMPLETED", name="Ragefire Chasm", durationSec=1000, startedAt=11000, endedAt=12000, players={ Tester={presentSec=100} } },
  } }`;

function setup(lang = "en") {
  const s = newLuaSession(); sessions.push(s);
  s.run(`NS={}; GuildedDB=nil; function UnitLevel() return 25 end`);
  for (const file of ["Core.lua", "Locale.lua", "Modules/Scores.lua", "Modules/SeasonDetails.lua", "Modules/DungeonStats.lua", "Modules/DungeonScorePanel.lua"]) s.load(file);
  s.run(`fire_event("PLAYER_LOGIN"); DB=NS.getDb()
    NS.getSettings = function() return { language = "${lang}" } end
    DB.roster.Officer={inGuild=true}; DB.roster.Third={inGuild=true}; DB.roster.Guest={inGuild=false}
    ${RUNS}`);
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
      f.SetWidth = function(self, w) self.width = w end
      f.Show = function(self) self.shown = true end
      f.Hide = function(self) self.shown = false end
      f.IsShown = function(self) return self.shown end
      f.GetFrameLevel = function() return 1 end
      return f
    end
    TIP = {}
    GameTooltip = { SetOwner=function() TIP = {} end, Show=function() end, Hide=function() end,
      AddLine=function(_, t) TIP[#TIP+1]=t end, AddDoubleLine=function(_, a, b) TIP[#TIP+1]=a..": "..b end }
    P = NS.dungeonScorePanel.build(UIParent); P.mode = "season"; P:Refresh()
    -- The card frame showing a dungeon (turning to its page first).
    function CARD(name)
      local model = NS.dungeonScorePanel.model("Tester")
      for i, row in ipairs(model.cards) do
        if row.name == name then P.page = math.ceil(i / 8); P:Refresh(); return P.cards[(i - 1) % 8 + 1] end
      end
    end`);
  return s;
}

describe("dungeon stats", () => {
  it("computes your record and the guild's per dungeon from counted runs only", () => {
    const s = setup();
    s.run(`D = NS.dungeonStats.compute("Tester").list[1]`);
    expect(s.run("return D.name .. ' ' .. D.runs .. ' ' .. D.completed .. ' ' .. D.best .. ' ' .. math.floor(D.average)")).toBe("Ragefire Chasm 3 1 1200 1200");
    // Deaths: 2 + 1 over the two runs where your addon counted them.
    expect(s.run("return D.deaths .. '/' .. D.deathRuns")).toBe("3/2");
    // Guild: Officer 15:00 (the guest's 10:00 run does not count), you 20:00.
    expect(s.run("return D.guildBest.name .. ' ' .. D.guildBest.sec .. ' ' .. math.floor(D.guildAverage) .. ' #' .. D.rank .. '/' .. D.members .. ' ' .. D.topPercent")).toBe("Officer 900 1050 #2/2 100");
    expect(s.run("local t = {} for _, b in ipairs(D.bosses) do t[#t+1] = b.name .. '=' .. b.mine .. '/' .. b.guild end return table.concat(t, ',')"))
      .toBe("Oggleflint=300/200,Taragaman=900/800");
    expect(s.run("local t = NS.dungeonStats.compute('Tester').totals return t.runs .. ' ' .. t.completed .. ' ' .. t.dungeons")).toBe("3 1 1");
  });

  it("colours scores on the item-quality ladder and compares you with the board", () => {
    const s = setup();
    expect(s.run("return NS.dungeonStats.colorize(95, 0.95) .. NS.dungeonStats.colorize(10, 0.1)")).toBe("|cffff800095|r|cff9d9d9d10|r");
    expect(s.run("return NS.dungeonStats.boardLine(NS.dungeonStats.boardSummary(DB.dungeonBoard.rows, 'Tester'))"))
      .toBe("You: #2 of 3 (top 67%)  |  Guild best: Officer 1200  |  Average: 800");
    expect(s.run("return P.summary.text")).toContain("(#2 of 3, top 67%)");
  });

  it("puts runs and rank on the card and the full record in its tooltip", () => {
    const s = setup();
    s.run(`C = CARD("Ragefire Chasm")`);
    expect(s.run("return C.extra.text")).toBe("3 runs  #2/2");
    s.run(`C:GetScript("OnEnter")(C)`);
    const tip = s.run("return table.concat(TIP, '|')");
    expect(tip).toContain("Your runs: 3 (1 completed)");
    expect(tip).toContain("Best time: 20:00  (avg 20:00)");
    expect(tip).toContain("Deaths per run: 1.5");
    expect(tip).toContain("Guild best: 15:00 (Officer)");
    expect(tip).toContain("Your rank: #2 / 2");
    expect(tip).toContain("Click for details.");
  });

  it("opens a dungeon's detail page on click with tiles, bars and boss splits", () => {
    const s = setup();
    s.run(`C = CARD("Ragefire Chasm"); C:GetScript("OnMouseUp")(C, "LeftButton")`);
    expect(s.run("return tostring(P.detail.shown) .. ' ' .. P.detail.title.text")).toBe("true Ragefire Chasm");
    expect(s.run("return P.detail.tiles.best.value.text .. ' ' .. P.detail.tiles.runs.value.text .. ' ' .. P.detail.tiles.deaths.value.text")).toBe("20:00 1 / 3 1.5");
    expect(s.run("return P.detail.rank.text")).toBe("Your best is #2 of 2 guild members (top 100%).");
    // Bars: shorter is faster; the slowest of the three fills the track.
    expect(s.run("local b = P.detail.bars return (b.you.fill.width == b.you.width and 'full' or 'part') .. ' ' .. b.best.value.text .. ' ' .. b.average.value.text")).toBe("full 15:00 Officer 17:30");
    expect(s.run("local r = P.detail.splits[1] return r.name.text .. ' ' .. r.mine.text .. ' ' .. r.guild.text .. ' ' .. r.delta.text")).toBe("Oggleflint 5:00 3:20 |cffff6060+1:40|r");
    expect(s.run("return tostring(P.detail.splits[3].shown)")).toBe("false");
    // Cards are covered; Back (or another tab) returns to them.
    expect(s.run("return tostring(C.shown)")).toBe("false");
    s.run(`P.detail.back:GetScript("OnClick")(P.detail.back)`);
    expect(s.run("return tostring(P.detail.shown) .. ' ' .. tostring(C.shown)")).toBe("false true");
    s.run(`P.openDetail(C.row); P.setTab("board")`);
    expect(s.run("return tostring(P.detail.shown) .. ' ' .. tostring(P.detailCard)")).toBe("false false");
  });

  it("draws the guild board as bars with your row lit and the comparison line", () => {
    const s = setup();
    s.run(`P.setTab("board")`);
    expect(s.run("return NS.dungeonScorePanel.boardText(P)")).toBe("1. Officer - 1200\n2. Tester - 900\n3. Third - 300");
    const rows = "P.rankings.rows";
    expect(s.run(`return tostring(${rows}[1].lit.shown) .. tostring(${rows}[2].lit.shown) .. ' ' .. tostring(${rows}[1].fill.width == ${rows}[1].barWidth) .. ' ' .. ${rows}[2].fill.width / ${rows}[2].barWidth`)).toBe("falsetrue true 0.75");
    expect(s.run(`return tostring(${rows}[4].shown)`)).toBe("false");
    expect(s.run("return P.nextLine.text")).toBe("You: #2 of 3 (top 67%)  |  Guild best: Officer 1200  |  Average: 800");
  });

  it("is translated in French, German and Spanish", () => {
    for (const [lang, title, back] of [["fr", "Temps par boss", "Retour"], ["de", "Bosszeiten", "Zurück"], ["es", "Tiempos por jefe", "Volver"]]) {
      const s = setup(lang);
      expect(s.run("return P.detail.splitTitle.text")).toBe(title);
      expect(s.run("return P.detail.back.text")).toBe(back);
    }
  });
});
