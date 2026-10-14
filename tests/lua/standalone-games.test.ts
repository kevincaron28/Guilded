import { afterEach, describe, expect, it } from "vitest";
import { addonSource, newLuaSession, type LuaSession } from "./harness.js";
let s: LuaSession;
afterEach(() => s?.close());
function setup() {
  s = newLuaSession();
  s.run(`NS = {}; GuildedGamesDB = nil
    function IsInGroup() return true end
    MOCK_UNITS = {player={name="Host"},party1={name="Amy"},party2={name="Bob"},party3={name="Cy"}}
    RANDOM_ROLL_RESULT = "%s rolls %d (%d-%d)"
    SENT_CHAT={}; C_ChatInfo.SendChatMessage=function(text,channel) SENT_CHAT[#SENT_CHAT+1]={text,channel} end`);
  for (const file of ["Locale.lua", "Questions.lua", "Core.lua", "Window.lua"]) s.run(`loadaddon("GuildedGames", [====[${addonSource(`../GuildedGames/${file}`)}]====], NS)`);
  s.run(`fire_event("PLAYER_LOGIN")`);
}
function start(game: string, rounds = 5, teams = false) {
  s.run(`NS.start("${game}",${teams},${rounds}); NS.chat("Amy-TestRealm","1"); NS.chat("Bob-TestRealm","1"); NS.nextRound()`);
}
function roll(who: string, value: number, max = 100) { s.run(`fire_event("CHAT_MSG_SYSTEM","${who} rolls ${value} (1-${max})")`); }
describe("independent Guilded Games", () => {
  it("loads without Guilded and hosts chat-only high rolls", () => {
    setup(); start("high"); s.run(`NS.chat("Stranger","1")`);
    roll("Amy",70); roll("Amy",100); roll("Bob",70,50);
    expect(s.run(`return tostring(NS.state() ~= nil)`)).toBe("true");
    roll("Bob",70); roll("Amy",80); roll("Bob",20);
    expect(s.run(`return GuildedGamesDB.history[1].winners`)).toBe("Amy-TestRealm");
    expect(s.run(`return tostring(GuildedDB)`)).toBe("nil");
    s.run(`NS.rematch()`); expect(s.run(`return NS.state().phase`)).toBe("JOINING");
  });
  it("deathroll ties have roll-offs, never random elimination", () => {
    setup(); s.run(`NS.start("death"); NS.join("Amy"); NS.join("Bob"); NS.join("Cy"); NS.nextRound()`);
    roll("Amy",5); roll("Bob",5); roll("Cy",90);
    expect(s.run(`return tostring(NS.state().players["Amy-TestRealm"].out)`)).toBe("nil");
    roll("Cy",1); roll("Amy",10); roll("Bob",20);
    expect(s.run(`return tostring(NS.state().players["Amy-TestRealm"].out)`)).toBe("true");
    s.run(`NS.nextRound()`); roll("Bob",2,5); roll("Cy",4,5);
    expect(s.run(`return GuildedGamesDB.history[1].winners`)).toBe("Cy-TestRealm");
  });
  it("target awards equal-distance ties and keeps a multi-round score", () => {
    setup(); start("target",2); s.run(`NS.state().target=50`); roll("Amy",40); roll("Bob",60);
    expect(s.run(`return NS.state().players["Amy-TestRealm"].score`)).toBe("1");
    s.run(`NS.nextRound(); NS.state().target=50`); roll("Amy",50); roll("Bob",20);
    expect(s.run(`return GuildedGamesDB.history[1].winners`)).toBe("Amy-TestRealm");
  });
  it("trivia allows one answer, teams, skips and no repeated questions", () => {
    setup(); start("trivia",2,true);
    s.run(`NS.chat("Amy","wrong"); NS.chat("Amy",NS.state().question.a[1]); NS.chat("Bob",NS.state().question.a[1])`);
    expect(s.run(`return NS.state().players["Amy-TestRealm"].score`)).toBe("0");
    expect(s.run(`return NS.state().players["Bob-TestRealm"].score`)).toBe("1");
    s.run(`oldQuestion=NS.state().question.q; NS.nextRound()`);
    expect(s.run(`return tostring(oldQuestion ~= NS.state().question.q)`)).toBe("true");
    s.run(`NS.skip()`); expect(s.run(`return GuildedGamesDB.history[1].winners`)).toBe("B");
  });
  it("duel enforces turns and exclusive hosting", () => {
    setup(); s.run(`NS.start("duel",false,5,"Amy"); NS.nextRound()`);
    expect(s.run(`return tostring(NS.start("high"))`)).toBe("false");
    roll("Amy",1); roll("Host",30); roll("Amy",1,30);
    expect(s.run(`return GuildedGamesDB.history[1].winners`)).toBe("Host-TestRealm");
  });
  it("does not award AFK/cancelled games and discards group-change messages", () => {
    setup(); start("high"); roll("Amy",10); s.run(`NS.remove("Bob")`);
    expect(s.run(`return #GuildedGamesDB.history`)).toBe("0");
    expect(s.run(`return tostring(NS.state())`)).toBe("nil");
    start("high"); s.run(`function IsInGroup() return false end; fire_event("GROUP_ROSTER_UPDATE")
      for _,f in ipairs(FRAMES) do if f.scripts.OnUpdate then f.scripts.OnUpdate(f,2) end end`);
    expect(s.run(`return #SENT_CHAT`)).toBe("0");
  });
  it("parses French positional rolls and rejects ambiguous cross-realm names", () => {
    setup(); s.run(`RANDOM_ROLL_RESULT="%1$s obtient %2$d (%3$d-%4$d)"`);
    expect(s.run(`local n,v,a,b=NS.parseRoll("Amy obtient 42 (1-100)"); return n..":"..v..":"..a..":"..b`)).toBe("Amy:42:1:100");
    s.run(`function UnitFullName(unit) if unit=="party1" then return "Amy","One" elseif unit=="party2" then return "Amy","Two" else return UnitName(unit),"TestRealm" end end`);
    expect(s.run(`return tostring(NS.resolve("Amy"))`)).toBe("nil");
    expect(s.run(`return NS.resolve("Amy-One")`)).toBe("Amy-One");
  });
  it("bounds saved history and selects a French question pack", () => {
    setup(); s.run(`GuildedGamesDB.language="fr"; NS.start("trivia"); NS.join("Amy"); NS.join("Bob"); NS.nextRound()`);
    expect(s.run(`return tostring(NS.state().pack==NS.questions.fr)`)).toBe("true");
    s.run(`NS.cancel(); for i=1,55 do NS.start("high"); NS.join("Amy"); NS.join("Bob"); NS.nextRound(); NS.roll("Amy",90,1,100); NS.roll("Bob",1,1,100) end`);
    expect(s.run(`return #GuildedGamesDB.history`)).toBe("50");
  });
  it("keeps party games and Guilded loot rolls mutually exclusive", () => {
    setup(); s.run(`GAME_NS=NS; LOOT_NS={}`);
    s.load("Core.lua", "LOOT_NS"); s.load("Modules/LootRoll.lua", "LOOT_NS"); s.run(`fire_event("PLAYER_LOGIN")`);
    s.run(`LOOT_NS.lootRoll.start({"Amy","Bob"},{})`);
    expect(s.run(`return tostring(GAME_NS.start("high"))`)).toBe("false");
    s.run(`LOOT_NS.commandHandlers.lootroll({"cancel"}); GAME_NS.start("high")`);
    expect(s.run(`return tostring(LOOT_NS.lootRoll.start({"Amy","Bob"},{}))`)).toBe("false");
  });
});
