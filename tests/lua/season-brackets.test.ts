import { afterEach, describe, expect, it } from "vitest";
import { standingsToLua } from "../../companion/standings-format.mjs";
import { calculateDungeonRating, seasonDungeonCatalog } from "../../src/services/dungeon-rating.js";
import { bracketRulesFixture, novemberRun } from "../fixtures/november-routes.js";
import { newLuaSession, type LuaSession } from "./harness.js";
const sessions: LuaSession[] = [];
afterEach(() => { for (const s of sessions) s.close(); sessions.length = 0; });

// Synthetic all-level season: Tester has 800 in 15-29 (3 of 4 routes count) and 400 at 60.
const rules = bracketRulesFixture();
const rows = calculateDungeonRating([...[0, 1, 2, 3].map(i => novemberRun(i, i === 0 ? 900 : 1800, 25)), novemberRun(4, 900, 60)], rules);
const board = { id: "all", season: "All levels", status: "ACTIVE", ratingVersion: 6, detailsAvailable: true,
  brackets: rules.brackets, catalog: seasonDungeonCatalog(rules, rows),
  rows: rows.map(r => ({ name: r.name, points: r.points, bracket: r.bracket })),
  profiles: rows.map(r => ({ name: r.name, points: r.points, details: r.details, bracket: r.bracket, characters: [] })) };

function setup(officer = false, level = 60) {
  const s = newLuaSession(); sessions.push(s);
  s.run(`NS={}; GuildedDB=nil; CLOCK=100; function GetTime() return CLOCK end; function UnitLevel() return ${level} end`);
  for (const file of ["Core.lua", "Modules/Scores.lua", "Modules/SeasonDetails.lua", "Modules/DungeonScorePanel.lua"]) s.load(file);
  s.run(`fire_event("PLAYER_LOGIN"); DB=NS.getDb()
    DB.roster.Officer={inGuild=true}; DB.roster.Tester={inGuild=true}
    NS.isOfficer=function() return ${officer ? "true" : "false"} end
    NS.isOfficerName=function(n) return n=="Officer" end`);
  return s;
}

describe("level brackets in the addon", () => {
  it("writes brackets through the companion and shows the player's own bracket first", () => {
    const s = setup(false, 25);
    s.run(standingsToLua({ updatedAt: "stamp", standings: [], dungeonBoard: board }));
    s.run("DB.dungeonBoard=GuildedDungeonBoard");
    expect(s.run("return #DB.dungeonBoard.brackets .. DB.dungeonBoard.rows[1].bracket .. DB.dungeonBoard.profiles[2].bracket")).toBe("215-2960");
    expect(s.run('local m=NS.dungeonScorePanel.model("Tester",1); return m.bracket.key .. " " .. m.total .. " " .. #m.cards')).toBe("15-29 800 4");
    expect(s.run('local n=0; for _,c in ipairs(NS.dungeonScorePanel.model("Tester",1).cards) do if c.counted then n=n+1 end end; return n')).toBe("3");
    expect(s.run('local m=NS.dungeonScorePanel.model("Tester",1,"60"); return m.total .. " " .. #m.cards .. " " .. #m.rows')).toBe("400 5 1");
    // Level 60 on the same board: the 60 bracket first.
    s.run("function UnitLevel() return 60 end");
    expect(s.run('return NS.dungeonScorePanel.model("Tester",1).bracket.key')).toBe("60");
  });
  it("scores by level in tooltips and lists every bracket in /guilded score top", () => {
    const s = setup();
    s.run(standingsToLua({ updatedAt: "stamp", standings: [], dungeonBoard: board }));
    s.run("DB.dungeonBoard=GuildedDungeonBoard");
    expect(s.run('return table.concat({NS.scores.scoreOf("Tester",25)}, ",")')).toBe("800,4,15-29");
    expect(s.run('return table.concat({NS.scores.scoreOf("Tester",60)}, ",")')).toBe("400,1,60");
    expect(s.run('return (NS.scores.scoreOf("Tester"))')).toBe("800");
    expect(s.run('return #NS.scores.ranking("60") .. NS.scores.ranking("60")[1].score')).toBe("1400");
    const top = s.run("return NS.scores.topText(10)");
    expect(top).toContain("Levels 15-29 (15-29):");
    expect(top).toContain("Level 60 (60):");
    expect(s.run('return NS.scores.topText(10, "60")')).toMatch(/^ 1\. Tester +400$/);
  });
  it("switches brackets on the panel and shows the bracket's best-N", () => {
    const s = setup(false, 25);
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
    expect(s.run("return P.bracketButton.text")).toBe("Levels 15-29");
    expect(s.run("return P.note.text")).toBe("Levels 15-29: best 3 distinct routes. Verified route evidence required.");
    s.run('P.bracketButton:GetScript("OnClick")()');
    expect(s.run("return P.bracket .. ' ' .. P.bracketButton.text")).toBe("60 Level 60");
    expect(s.run("return P.summary.text")).toContain("400");
    s.run('P.bracketButton:GetScript("OnClick")()');
    expect(s.run("return P.bracket")).toBe("15-29");
  });
  it("relays one bracket to a member without a companion", () => {
    const officer = setup(true), member = setup(false, 25);
    officer.run('NS.playerName=function() return "Officer" end');
    officer.run(standingsToLua({ updatedAt: "stamp", standings: [], dungeonBoard: board }));
    officer.run("DB.dungeonBoard=GuildedDungeonBoard");
    member.run(`DB.dungeonBoard={updatedAt="stamp",season="All levels",status="ACTIVE",rows={},
      brackets={{key="15-29",min=15,max=29,bestCount=3},{key="60",min=60,max=60,bestCount=4}}}; NS.seasonDetails.request(1)`);
    officer.run(`fire_event("CHAT_MSG_ADDON","GuildedRating",${JSON.stringify(member.run("return SENT[#SENT].text"))},"GUILD","Tester")`);
    for (let i = 1; i <= Number(officer.run("return #SENT")); i++) member.run(`fire_event("CHAT_MSG_ADDON","GuildedRating",${JSON.stringify(officer.run(`return SENT[${i}].text`))},"WHISPER","Officer")`);
    expect(member.run('local p=NS.seasonDetails.get(1,"Tester").profile; return p.bracket .. " " .. p.points')).toBe("15-29 800");
    expect(member.run('local n=0; for _,d in ipairs(NS.seasonDetails.get(1,"Tester").profile.details) do if d.counted then n=n+1 end end; return n')).toBe("3");
    expect(member.run('local m=NS.dungeonScorePanel.model("Tester",1); return m.total .. " " .. #m.cards')).toBe("800 4");
    // The relay held one bracket: the other is not in it.
    expect(member.run('return tostring(NS.seasonDetails.get(1,"Tester","60").profile)')).toBe("nil");
    // An over-level penalty travels as an eleventh R field and must match the points.
    const penalised = "S;x;6;180;1;0;15-29;3\nC;90001;E;1800;90001:east;20;29;15-29\nR;90001;E;180;0;1800;1800;r;;90001:east;10";
    expect(member.run(`return NS.seasonDetails.parse(${JSON.stringify(penalised)}).profile.details[1].penaltyPercent`)).toBe("10");
    expect(member.run(`return tostring(NS.seasonDetails.parse(${JSON.stringify(penalised.replace(";10", ";20"))})==nil)`)).toBe("true");
    // Version 6 headers must name a bracket; a version 5 header must not.
    const payload = "S;x;6;200;1;0;60;4\nC;90002;S;1800;90002:service;60;60;60\nR;90002;S;200;0;1800;1800;r;;90002:service";
    expect(member.run(`return tostring(NS.seasonDetails.parse(${JSON.stringify(payload)})~=nil)`)).toBe("true");
    expect(member.run(`return tostring(NS.seasonDetails.parse(${JSON.stringify(payload.replace(";6;", ";5;"))})==nil)`)).toBe("true");
    expect(member.run(`return tostring(NS.seasonDetails.parse(${JSON.stringify(payload.replace(";60;4\n", "\n"))})==nil)`)).toBe("true");
  });
});

describe("bracket sync between guildmates", () => {
  function sync() {
    const s = newLuaSession(); sessions.push(s);
    s.run("NS = {}; GuildedDB = nil");
    s.load("Core.lua"); s.load("Compat.lua"); s.load("Modules/SeasonSync.lua");
    s.run(`fire_event("PLAYER_LOGIN"); NS.isGuildMember = function(name) return name ~= "Stranger" end
      NS.isOfficerName = function(name) return name == "Officer" end
      NS.util.tooFarAhead = function() return false end`);
    return s;
  }
  const stamp = "2026-11-04T10:00:00Z";
  const boardText = `BOARD|${stamp}|1|1|S;All levels;ACTIVE\nR;Ann;800\nR;Ann;400`;
  const send = (s: LuaSession, text: string, from = "Officer") => s.run(`fire_event("CHAT_MSG_ADDON", "GuildedSeason", ${JSON.stringify(text)}, "GUILD", "${from}")`);

  it("adds brackets to the board it kept, and sends them after the board", () => {
    const s = sync();
    send(s, boardText);
    send(s, `BRACKETS|${stamp}|1|1|B;1;15-29;15;29;3\nB;1;60;60;60;4\nK;1;1;15-29\nK;1;2;60`, "Stranger");
    expect(s.run("return tostring(GuildedDungeonBoard.brackets)")).toBe("nil");
    send(s, `BRACKETS|${stamp}|1|1|B;1;15-29;15;29;3\nB;1;60;60;60;4\nK;1;1;15-29\nK;1;2;60`);
    expect(s.run("return #NS.getDb().dungeonBoard.brackets .. NS.getDb().dungeonBoard.rows[2].bracket")).toBe("260");
    // Sharing it on carries the brackets in their own message.
    s.run(`NOW = 1800000000; time = function() return NOW end; NS.isOfficer = function() return true end
      C_Timer = { After = function(_, fn) fn() end }; SENT = {}`);
    s.run(`fire_event("CHAT_MSG_ADDON", "GuildedSeason", "REQUEST|0", "GUILD", "Amy")`);
    expect(s.run('for _, m in ipairs(SENT) do if string.find(m.text, "^BRACKETS|") then return m.text end end')).toBe(
      `BRACKETS|${stamp}|1|1|B;1;15-29;15;29;3\nB;1;60;60;60;4\nK;1;1;15-29\nK;1;2;60`);
  });
  it("refuses unknown row brackets and malformed bracket lines", () => {
    const s = sync();
    send(s, boardText);
    send(s, `BRACKETS|${stamp}|1|1|B;1;60;60;60;4\nK;1;1;15-29`);
    expect(s.run("return tostring(NS.getDb().dungeonBoard.brackets)")).toBe("nil");
    send(s, `BRACKETS|${stamp}|1|1|B;1;Bad;1;60;4`);
    expect(s.run("return tostring(NS.getDb().dungeonBoard.brackets)")).toBe("nil");
    send(s, `BRACKETS|${stamp}|1|1|B;1;60;60;60;40`);
    expect(s.run("return tostring(NS.getDb().dungeonBoard.brackets)")).toBe("nil");
  });
});
