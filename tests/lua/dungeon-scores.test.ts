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
  it("validates model 4 totals from only the best eight routes while retaining coverage", () => {
    const s = setup();
    s.run(`PAYLOAD="S;beta;4;1600;1;1"
      for i=1,9 do
        PAYLOAD=PAYLOAD.."\\nC;"..i..";Dungeon;1800;"..i..";30;30"
        PAYLOAD=PAYLOAD.."\\nR;"..i..";Dungeon;200;0;1800;1800;ref;;"..i
      end
      PARSED=NS.seasonDetails.parse(PAYLOAD)`);
    expect(s.run("return #PARSED.profile.details")).toBe("9");
    expect(s.run("return tostring(PARSED.profile.details[9].counted)")).toBe("false");
    expect(s.run('return tostring(NS.seasonDetails.parse(string.gsub(PAYLOAD,"1600","1800",1)) == nil)')).toBe("true");
    expect(s.run("return PARSED.profile.points")).toBe("1600");
  });
  it("shows only this character's recent runs without deleting another character's history", () => {
    const s = setup();
    s.run(`DB.dungeon={runs={a={name="Old",endedAt=10,players={Tester={}}},
      b={name="Other character",endedAt=30,players={Alt={}}},
      c={name="New",endedAt=20,players={["Tester-Realm"]={}}}}}
      M=NS.dungeonScorePanel.runModel()`);
    expect(s.run('return #M.recent..":"..M.recent[1].name..":"..M.recent[2].name')).toBe("2:New:Old");
    expect(s.run('return DB.dungeon.runs.b.name')).toBe("Other character");
  });
  it("orders dungeon cards by minimum level, maximum level, then name, with unknown levels last", () => {
    const s = setup();
    s.run(`DB.dungeonBoard.detailsAvailable=true; DB.dungeonBoard.provisionalTargets=true
      DB.dungeonBoard.catalog={
        {name="Unknown"},{name="Alpha high",minLevel=30,maxLevel=40},
        {name="Zulu low",minLevel=10,maxLevel=20},{name="Beta low",minLevel=10,maxLevel=20},
        {name="Early",minLevel=10,maxLevel=15}}
      M=NS.dungeonScorePanel.model("Tester")`);
    expect(s.run('local names={}; for _,c in ipairs(M.cards) do names[#names+1]=c.name end; return table.concat(names,",")'))
      .toBe("Early,Beta low,Zulu low,Alpha high,Unknown");
  });
  it("adds a fourth Forever side page and restores native pages when switching or closing", () => {
    const s = setup();
    s.run(`local oldCreate=CreateFrame
      function CreateFrame(kind,name,parent,template)
        local f=oldCreate(); f.parent=parent; f.template=template
        f.CreateFontString=function() return CreateFrame() end
        f.CreateTexture=function() return CreateFrame() end
        f.SetText=function(self,text) self.text=text end
        f.SetSize=function(self,w,h) self.width=w; self.height=h end
        f.SetPoint=function(self,...) self.point={...} end
        f.GetFrameLevel=function() return 1 end
        f.SetChecked=function(self,value) self.checked=value end
        f.SetCustomOnMouseUpHandler=function(self,fn) self.click=fn end
        f.IsShown=function(self) return self.shown or false end
        f.Show=function(self) if self.shown then return end; self.shown=true; if self.scripts.OnShow then self.scripts.OnShow(self) end end
        f.Hide=function(self) if not self.shown then return end; self.shown=false; if self.scripts.OnHide then self.scripts.OnHide(self) end end
        f.HookScript=function(self,event,fn) local original=self.scripts[event]; self.scripts[event]=function(...) if original then original(...) end; fn(...) end end
        if template=="LFGVanillaRightTabTemplate" then f.Icon=CreateFrame() end
        return f
      end
      function hooksecurefunc(object,key,fn) local original=object[key]; object[key]=function(...) original(...); fn(...) end end
      LFGParentFrameRightTabMixin={}
      PVEFrame=CreateFrame(); LFGParentFrame=CreateFrame()
      LFGParentFrame.ListingTab=CreateFrame(); LFGParentFrame.BrowsingTab=CreateFrame(); LFGParentFrame.WhoListingTab=CreateFrame()
      LFGParentFrame.UpdateTabs=function(self) self.ListingTab:SetChecked(true) end
      LFGListingFrame=CreateFrame(); LFGBrowseFrame=CreateFrame(); LFGWhoListFrame=CreateFrame()
      NATIVE_SHOWS=0; LFGBrowseFrame:SetScript("OnShow",function() NATIVE_SHOWS=NATIVE_SHOWS+1 end)
      LFGParentFrame:Show(); LFGListingFrame:Show()
      COMBAT=false; function InCombatLockdown() return COMBAT end
      fire_event("ADDON_LOADED")
      TAB=NS.dungeonScorePanel.tab; PANE=NS.dungeonScorePanel.pane
      function CLICK() TAB.click(TAB,"LeftButton",true) end`);
    expect(s.run('return TAB.template')).toBe("LFGVanillaRightTabTemplate");
    expect(s.run('return tostring(TAB.point[2]==LFGParentFrame.WhoListingTab and TAB.point[3]=="BOTTOMLEFT")')).toBe("true");
    s.run('COMBAT=true; CLICK()');
    expect(s.run('return tostring(PANE:IsShown())')).toBe("false");
    s.run('COMBAT=false; CLICK(); LFGParentFrame:UpdateTabs()');
    expect(s.run('return tostring(PANE:IsShown() and TAB.checked and not LFGParentFrame.ListingTab.checked and not LFGListingFrame:IsShown())')).toBe("true");
    expect(s.run('return PANE.width..":"..#PANE.cards')).toBe("440:4");
    s.run('NS.dungeonScorePanel.open("run"); PANE:GetScript("OnUpdate")(PANE, 1)');
    expect(s.run('return tostring(PANE.runView:IsShown() and PANE==NS.dungeonScorePanel.pane)')).toBe("true");
    s.run('NS.dungeonScorePanel.open("season"); PANE.rankingToggle:GetScript("OnClick")()');
    expect(s.run('return tostring(PANE.guildRanking and PANE.rankings:IsShown() and not PANE.runView:IsShown())')).toBe("true");
    expect(s.run('return PANE.rankings.text')).toContain("Tester - 100");
    s.run('LFGBrowseFrame:Show()');
    expect(s.run('return tostring(not PANE:IsShown() and not TAB.checked and not LFGListingFrame:IsShown() and LFGBrowseFrame:IsShown())')).toBe("true");
    expect(s.run('return NATIVE_SHOWS')).toBe("1");
    s.run('CLICK(); PANE:Hide()');
    expect(s.run('return tostring(LFGBrowseFrame:IsShown() and not NS.dungeonScorePanel.chrome:IsShown())')).toBe("true");
    s.run('CLICK(); LFGParentFrame:Hide(); LFGParentFrame:Show(); fire_event("ADDON_LOADED")');
    expect(s.run('return tostring(not PANE:IsShown() and LFGBrowseFrame:IsShown() and TAB==NS.dungeonScorePanel.tab)')).toBe("true");
  });
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
  it.each(["PVEFrame", "LFGParentFrame", "LFGFrame"])("attaches visibly to %s after load-on-demand without changing native handlers", (finderName) => {
    const s = setup();
    // Rich enough frame values to exercise the actual rendering and clicks.
    s.run(`local oldCreate=CreateFrame
      function CreateFrame(...)
        local f=oldCreate(...)
        f.CreateFontString=function() return CreateFrame() end
        f.CreateTexture=function() return CreateFrame() end
        f.SetText=function(self,text) self.text=text end
        f.ClearAllPoints=function(self) self.point=nil end
        f.SetPoint=function(self,...) self.point={...} end
        f.GetFrameLevel=function() return 1 end
        f.SetFrameStrata=function(self,value) self.strata=value end
        f.SetClampedToScreen=function(self,value) self.clamped=value end
        f.IsShown=function(self) return self.shown or false end
        f.Show=function(self) self.shown=true; if self.scripts.OnShow then self.scripts.OnShow(self) end end
        f.Hide=function(self) self.shown=false end
        return f
      end
      FINDER=CreateFrame(); ${finderName}=FINDER; NATIVE=function() end; FINDER:SetScript("OnShow",NATIVE)
      COMBAT=true; function InCombatLockdown() return COMBAT end
      fire_event("ADDON_LOADED")`);
    expect(s.run('return tostring(NS.dungeonScorePanel.tab)')).toBe("nil");
    s.run('COMBAT=false; fire_event("PLAYER_REGEN_ENABLED"); TAB=NS.dungeonScorePanel.tab; fire_event("ADDON_LOADED")');
    expect(s.run('return tostring(TAB==NS.dungeonScorePanel.tab and FINDER:GetScript("OnShow")==NATIVE and TAB.point[2]==FINDER)')).toBe("true");
    expect(s.run('return TAB.point[1]..":"..TAB.point[3]..":"..TAB.point[5]')).toBe("BOTTOM:BOTTOM:8");
    s.run('TAB:GetScript("OnClick")()');
    expect(s.run('return NS.dungeonScorePanel.pane.summary.text')).toContain("Your season score: 100");
    expect(s.run('local p=NS.dungeonScorePanel.pane; return tostring(p.point[1]=="CENTER" and p.point[2]==UIParent and p.strata=="DIALOG" and p.clamped)')).toBe("true");
    s.run('TAB:GetScript("OnClick")()');
    expect(s.run('return tostring(NS.dungeonScorePanel.pane:IsShown())')).toBe("false");
  });
});
