import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { feedDungeonBoard } from "../../src/services/dungeon-board-feed.js";
import { dungeonBoardToLua, ownProfileMatcher } from "../../companion/standings-format.mjs";
import { dungeonBoardToLua as dungeonBoardToLua946 } from "../fixtures/standings-format-9.4.6.mjs";
import { LUA_DUMP, sizedBoard } from "../helpers/dungeon-board-size.js";
import { newLuaSession, type LuaSession } from "./harness.js";

// 21 Nov 2026, "shrink the board": what the addon shows from the smaller Standings.lua the 9.4.7 companion writes is what it showed
// from the 9.4.6 file. Every reader of a dungeon profile runs on both files: the score panel (own character, overall and per role),
// the unit tooltip's season and role scores, /guilded score <name>, /guilded score top, the ranking the sheet export lists, and the
// officer relay.
type Board = NonNullable<Awaited<ReturnType<typeof sizedBoard>>>;
const AT = "2026-11-20T12:00:00Z";
let board: Board, fed: Board, mine: string;
const sessions: LuaSession[] = [];
beforeAll(async () => { board = await sizedBoard(); fed = feedDungeonBoard(board)!; mine = board.profiles[2]!.name; }, 120_000);
afterEach(() => { for (const s of sessions.splice(0)) s.close(); });
afterAll(() => undefined);

function game(file: string[], player: string, officer = false) {
  const s = newLuaSession(); sessions.push(s);
  s.run(`NS={}; GuildedDB=nil; CLOCK=100; function GetTime() return CLOCK end; function GetBuildInfo() return "1.15.8", "1", "Nov 1 2026", 11508 end`);
  for (const f of ["Core.lua", "Modules/Scores.lua", "Modules/SeasonDetails.lua", "Modules/DungeonScorePanel.lua"]) s.load(f);
  s.run(LUA_DUMP);
  s.run(file.join("\n"));
  s.run(`fire_event("PLAYER_LOGIN"); DB=NS.getDb(); DB.dungeonBoard=GuildedDungeonBoard
    NS.playerName=function() return NS.normalizeName(${JSON.stringify(player)}) end
    for _, p in ipairs(GuildedDungeonBoard and GuildedDungeonBoard.profiles or {}) do DB.roster[NS.normalizeName(p.name)]={inGuild=true} end
    DB.roster[NS.normalizeName("Officer One")]={inGuild=true}
    NS.isOfficer=function() return ${officer ? "true" : "false"} end
    NS.isOfficerName=function(n) return n==NS.normalizeName("Officer One") end`);
  return s;
}
// Everything a player can see that comes from the dungeon profiles, as text.
function visible(s: LuaSession): string[] {
  const out: string[] = [];
  out.push(s.run(`return NS.scores.topText(15)`));
  for (const b of board.brackets ?? []) out.push(s.run(`return NS.scores.topText(15, ${JSON.stringify(b.key)})`));
  out.push(s.run(`local t = {} for _, r in ipairs(NS.scores.ranking()) do t[#t+1] = r.name .. ":" .. r.score .. ":" .. tostring(r.n) end return table.concat(t, ";")`));
  for (const p of board.profiles) {
    const name = `NS.normalizeName(${JSON.stringify(p.name)})`;
    out.push(s.run(`local a, b, c = NS.scores.scoreOf(${name}) return tostring(a) .. "/" .. tostring(b) .. "/" .. tostring(c)`));
    out.push(s.run(`return NS.scores.detailText(${name})`));
    // The unit tooltip's role lines.
    out.push(s.run(`local snap = NS.seasonDetails.get(1, ${name}, ${JSON.stringify(p.bracket ?? null)}) local t = {}
      for _, r in ipairs(snap and snap.profile and snap.profile.roles or {}) do t[#t+1] = r.role .. "=" .. r.points end return table.concat(t, ",")`));
  }
  // The own character's score panel, overall and per role, in each bracket.
  for (const bracket of [null, ...(board.brackets ?? []).map(b => b.key)]) for (const role of [null, "TANK", "HEALER", "DAMAGER"]) {
    out.push(s.run(`local m = NS.dungeonScorePanel.model(NS.playerName(), 1, ${JSON.stringify(bracket)}, nil, ${JSON.stringify(role)})
      return DUMP({ cards = m.cards, total = m.total, count = m.count, own = m.own, role = m.role, guidance = m.guidance, available = m.available, roles = m.roles })`));
  }
  return out;
}

describe("the smaller Standings.lua shows the same", () => {
  it("for a member: every score, ranking, breakdown, tooltip role line and the own score panel", () => {
    const own = ownProfileMatcher([mine])!;
    const before = game(dungeonBoardToLua946(board, AT), mine);
    const file = dungeonBoardToLua(fed, AT, "GuildedDungeonBoard", { own, officer: false });
    const after = game(file, mine);
    const a = visible(before), b = visible(after);
    expect(b).toEqual(a);
    // Not vacuous: the panel shows runs, bosses and scenarios, the breakdowns list runs.
    expect(a.join("\n")).toContain("bosses={");
    expect(a.join("\n")).toContain("routes=");
    expect(a.some(line => line.includes("Shadowfang Keep:"))).toBe(true);
    expect(file.join("\n").length).toBeLessThan(dungeonBoardToLua946(board, AT).join("\n").length * 0.2);
  }, 120_000);

  it("for an officer: the relay answers a member without a companion exactly as before", () => {
    const asking = board.profiles[5]!.name;
    const own = ownProfileMatcher(["Officer One"])!;
    const relay = (file: string[]) => {
      const officer = game(file, "Officer One", true);
      const member = game([], asking);
      member.run(`DB.dungeonBoard={updatedAt=${JSON.stringify(AT)},season="S1",status="ACTIVE",rows={}}; NS.seasonDetails.request(1)`);
      officer.run("QUEUE={}; C_Timer.After=function(_,fn) QUEUE[#QUEUE+1]=fn end; SENT={}");
      officer.run(`fire_event("CHAT_MSG_ADDON","GuildedRating",${JSON.stringify(member.run("return SENT[#SENT].text"))},"GUILD",${JSON.stringify(asking)})`);
      officer.run("for i=1,256 do if #QUEUE==0 then break end; CLOCK=CLOCK+1; table.remove(QUEUE,1)() end");
      const sent = Number(officer.run("return #SENT"));
      const texts: string[] = [];
      for (let i = 1; i <= sent; i++) texts.push(officer.run(`return SENT[${i}].text`));
      for (const text of texts) member.run(`fire_event("CHAT_MSG_ADDON","GuildedRating",${JSON.stringify(text)},"WHISPER","Officer One")`);
      return { texts: texts.map(t => t.replace(/^D\|[^|]+\|/, "D|")), shown: member.run(`local s = NS.seasonDetails.get(1, NS.playerName()) return DUMP(s and s.profile and s.profile.details)`) };
    };
    const before = relay(dungeonBoardToLua946(board, AT));
    const after = relay(dungeonBoardToLua(fed, AT, "GuildedDungeonBoard", { own, officer: true }));
    expect(before.texts.length).toBeGreaterThan(1);
    expect(after).toEqual(before);
    expect(after.shown).toContain("runRef=");
    // A member's file (brief guildmates) in an officer-rank game answers nothing: an officer with a complete file answers instead.
    const brief = relay(dungeonBoardToLua(fed, AT, "GuildedDungeonBoard", { own, officer: false }));
    expect(brief.texts).toEqual([]);
  }, 120_000);
});
