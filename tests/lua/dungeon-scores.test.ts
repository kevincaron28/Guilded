import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

let session: LuaSession;
afterEach(() => session?.close());
function setup() {
  session = newLuaSession();
  session.run(`NS = {}; GuildedDB = nil`);
  session.load("Core.lua");
  session.load("Modules/Scores.lua");
  session.load("Modules/SeasonDetails.lua");
  session.load("Modules/DungeonScorePanel.lua");
  session.run(`fire_event("PLAYER_LOGIN")
    DB = NS.getDb()
    DB.dungeonBoard={season="Current",status="ACTIVE",rows={{name="Tester",points=100},{name="Friend",points=100}}}
    DB.roster.Friend = { inGuild = true }
    DB.roster.Guest = { inGuild = false }
    DB.roster.Legacy = {}
    RUN = { state="COMPLETED", name="Stratholme", durationSec=1800,
      players={Tester={presentSec=1800},Friend={presentSec=1800},Guest={presentSec=1800},Legacy={presentSec=1800}} }
    NS.scores.learn(RUN)`);
  return session;
}

describe("guild-only dungeon scores", () => {
  it("does not learn outsiders or unconfirmed legacy roster entries", () => {
    const s = setup();
    expect(s.run("return #NS.scores.ranking()")).toBe("2");
    expect(s.run("return tostring(DB.scores.bests.Guest)")).toBe("nil");
    expect(s.run("return tostring(DB.scores.bests.Legacy)")).toBe("nil");
  });
  it("filters already saved outsiders without erasing history or affecting guild records", () => {
    const s = setup();
    s.run(`DB.scores.bests.Guest = { strat = {sec=100,deaths=0} }
      DB.scores.board.Guest = {score=4999,n=40}
      DB.scores.board.Legacy = {score=4998,n=40}`);
    expect(s.run('return NS.scores.compute("Tester")')).toBe("120");
    expect(s.run('return NS.scores.topText(10)')).not.toMatch(/Guest|Legacy/);
    expect(s.run('return tostring(NS.scores.scoreOf("Guest"))')).toBe("nil");
    expect(s.run('return DB.scores.bests.Guest.strat.sec')).toBe("100");
    s.run('DB.roster.Friend.inGuild=false');
    expect(s.run('return #NS.scores.ranking()')).toBe("1");
    s.run('function IsInGuild() return false end');
    expect(s.run('return #NS.scores.ranking()')).toBe("0");
  });
  it("rejects outside senders and malformed shared scores", () => {
    const s = setup();
    s.run(`NS.scores.receive("S|400|4", "Guest-Realm")
      NS.scores.receive("S|400|4garbage", "Friend-Realm")`);
    expect(s.run('return tostring(DB.scores.board.Guest)..tostring(DB.scores.board.Friend)')).toBe("nilnil");
    s.run('NS.scores.receive("S|400|4", "Friend-Realm")');
    expect(s.run('return NS.scores.scoreOf("Friend")')).toBe("100"); // Old self-reported scores cannot override the season.
  });
  it("relearns saved runs after the guild roster becomes available", () => {
    const s = setup();
    s.run(`DB.dungeon = {runs = {r=RUN}}
      DB.roster.Guest.inGuild=true
      fire_event("GUILD_ROSTER_UPDATE")`);
    expect(s.run('return NS.scores.compute("Guest")')).toBe("120");
  });
  it("shows unrun and custom dungeons and filters current/past snapshots without changing them", () => {
    const s = setup();
    s.run(`RUN.name="Hall of Thanes"; NS.scores.learn(RUN)
      DB.dungeonBoard={season="Autumn",status="ACTIVE",detailsAvailable=true,ratingVersion=2,
        profiles={{name="Tester",points=200,details={{instanceId=3065,name="Hall of Thanes",points=100,speedBonus=0,durationSec=1800},{instanceId=329,name="Stratholme",points=100,speedBonus=0,durationSec=1800}}}},
        catalog={{instanceId=3065,name="Hall of Thanes"},{instanceId=329,name="Stratholme"}},rows={{name="Guest",points=900},{name="Tester",points=200}},
        history={{season="Summer",status="ENDED",rows={{name="Friend",points=100},{name="Guest",points=500}}}}}
      M=NS.dungeonScorePanel.model("Tester",1)`);
    expect(s.run('return #M.cards')).toBe("20");
    expect(s.run('return M.own')).toBe("200");
    expect(s.run('return #M.rows')).toBe("1");
    expect(s.run('return #DB.dungeonBoard.rows')).toBe("2");
    expect(s.run('local m=NS.dungeonScorePanel.model("Tester",99); return m.season.season..":"..#m.rows..":"..tostring(m.own)')).toBe("Summer:1:nil");
    s.run('DB.dungeonBoard=nil');
    expect(s.run('return tostring(NS.dungeonScorePanel.model("Tester").season)')).toBe("nil");
  });
  it("attaches once after load-on-demand, defers in combat, and leaves native handlers intact", () => {
    const s = setup();
    // Rich enough frame values to exercise the actual rendering and clicks.
    s.run(`local oldCreate=CreateFrame
      function CreateFrame(...)
        local f=oldCreate(...)
        f.CreateFontString=function() return CreateFrame() end
        f.CreateTexture=function() return CreateFrame() end
        f.SetText=function(self,text) self.text=text end
        f.IsShown=function(self) return self.shown or false end
        f.Show=function(self) self.shown=true; if self.scripts.OnShow then self.scripts.OnShow(self) end end
        f.Hide=function(self) self.shown=false end
        return f
      end
      PVEFrame=CreateFrame(); NATIVE=function() end; PVEFrame:SetScript("OnShow",NATIVE)
      COMBAT=true; function InCombatLockdown() return COMBAT end
      fire_event("ADDON_LOADED")`);
    expect(s.run('return tostring(NS.dungeonScorePanel.tab)')).toBe("nil");
    s.run('COMBAT=false; fire_event("PLAYER_REGEN_ENABLED"); TAB=NS.dungeonScorePanel.tab; fire_event("ADDON_LOADED")');
    expect(s.run('return tostring(TAB==NS.dungeonScorePanel.tab and PVEFrame:GetScript("OnShow")==NATIVE)')).toBe("true");
    s.run('TAB:GetScript("OnClick")()');
    expect(s.run('return NS.dungeonScorePanel.pane.summary.text')).toContain("Your season score: 100");
    s.run('TAB:GetScript("OnClick")()');
    expect(s.run('return tostring(NS.dungeonScorePanel.pane:IsShown())')).toBe("false");
  });
});
