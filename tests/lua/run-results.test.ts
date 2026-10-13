import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";
let session: LuaSession | undefined;
afterEach(() => session?.close());
describe("end of dungeon run summary", () => {
  it("updates the boss overlay and hides it between fights or when the module is disabled", () => {
    session = newLuaSession();
    session.run(`STAMP=100; ENABLED=true; VISIBLE=false; LABEL=""; SETTINGS={}
      CURRENT={state="ACTIVE",inside=true,activeEncounter={id=1,name="First boss",startedAt=100}}
      NS={getDb=function() return {settings=SETTINGS,dungeon={current=CURRENT}} end,
        compat={serverTime=function() return STAMP end},moduleActive=function() return ENABLED end}
      local original=CreateFrame
      CreateFrame=function(kind,name,...)
        local frame=original(kind,name,...)
        if name=="GuildedBossTimer" then
          frame.Show=function() VISIBLE=true end
          frame.Hide=function() VISIBLE=false end
          frame.CreateFontString=function() return setmetatable({SetText=function(_,text) LABEL=text end},
            {__index=function() return function() end end}) end
        end
        return frame
      end
      function tick()
        for _,frame in ipairs(FRAMES) do if frame.scripts.OnUpdate then frame.scripts.OnUpdate(frame,1) end end
      end`);
    session.load("Modules/RunResults.lua");
    session.run("tick()");
    expect(session.run("return LABEL")).toBe("Boss fight: First boss - 0:00");
    session.run("STAMP=165; tick()");
    expect(session.run("return LABEL")).toContain("1:05");
    expect(session.run("return tostring(VISIBLE)")).toBe("true");
    session.run("NS.runResults.setTimerEnabled(false); tick()");
    expect(session.run("return tostring(VISIBLE)")).toBe("false");
    expect(session.run("return CURRENT.activeEncounter.startedAt")).toBe("100");
    // Saved settings survive loading the module again, as they do after /reload.
    session.run("FRAMES={}"); session.load("Modules/RunResults.lua");
    session.run("tick()");
    expect(session.run("return tostring(VISIBLE)")).toBe("false");
    session.run("NS.runResults.setTimerEnabled(true); tick()");
    expect(session.run("return tostring(VISIBLE)")).toBe("true");
    expect(session.run("return LABEL")).toContain("1:05");
    session.run("ENABLED=false; tick()");
    expect(session.run("return tostring(VISIBLE)")).toBe("false");
    session.run("ENABLED=true; CURRENT.inside=false; tick()");
    expect(session.run("return tostring(VISIBLE)")).toBe("false");
    session.run("CURRENT.inside=true; CURRENT.activeEncounter=nil; tick()");
    expect(session.run("return tostring(VISIBLE)")).toBe("false");
    session.run('CURRENT.activeEncounter={id=1,startedAt=165}; STAMP=170; tick()');
    expect(session.run("return LABEL")).toBe("Boss fight: Boss #1 - 0:05");
    session.run("CURRENT=nil; tick()");
    expect(session.run("return tostring(VISIBLE)")).toBe("false");
  });
  it("shows each attempt duration without inventing missing or invalid timings, in both languages", () => {
    session = newLuaSession(); session.run("NS={}"); session.load("Locale.lua"); session.load("Modules/RunResults.lua");
    session.run(`RUN={startedAt=100,endedAt=300,encounters={
      {id=1,name="First boss",startedAt=100,at=130,success=false},
      {id=1,name="First boss",startedAt=140,at=205,success=true},
      {id=2,at=240,success=true},
      {id=3,startedAt=260,at=250,success=true},
      {id=4,startedAt=50,at=290,success=true}}}`);
    const text = session.run("return NS.runResults.text(RUN)");
    expect(text).toContain("First boss - Failed attempt - 0:30");
    expect(text).toContain("First boss - Defeated - 1:05");
    expect(text.match(/Fight not timed/g)).toHaveLength(3);
    session.run('GetLocale=function() return "frFR" end');
    const french = session.run("return NS.runResults.fightText(RUN)");
    expect(french).toContain("Tentative manquée - 0:30");
    expect(french).toContain("Vaincu - 1:05");
    expect(french).toContain("Combat non chronométré");
  });
  it("renders the roster, completion time, and sync footer without a reload action", () => {
    session = newLuaSession();
    session.run(`NS = {}; LABELS = {}; RELOADS = 0
      ReloadUI = function() RELOADS = RELOADS + 1 end
      local original = CreateFrame
      CreateFrame = function(...)
        local frame = original(...)
        frame.CreateFontString = function()
          local label = setmetatable({}, { __index = function() return function() end end })
          label.SetText = function(_, text) LABELS[#LABELS+1] = text end
          label.GetStringHeight = function() return 240 end
          return label
        end
        return frame
      end`);
    session.load("Modules/RunResults.lua");
    session.run(`NS.runResults.show({name="The Hall of Thanes",state="COMPLETED",durationSec=1345,
      encounters={{name="First boss",startedAt=100,at=165,success=true},{success=true},{success=true},{success=true}},
      players={Highpriest={class="PRIEST",role="HEALER",deaths=0},Guest={class="HUNTER",role="DPS"}}})`);
    const rendered = session.run('return table.concat(LABELS, "\\n")');
    expect(rendered).toContain("RUN COMPLETE");
    expect(rendered).toContain("22:25");
    expect(rendered).toContain("PRIEST / Healer");
    expect(rendered).toContain("First boss - Defeated - 1:05");
    expect(rendered).toContain("deaths unknown");
    expect(rendered).toContain("Type /reload or log out");
    expect(session.run("return RELOADS")).toBe("0");
  });
  it("queues results until combat ends and keeps the compact corner window out of later fights", () => {
    session = newLuaSession();
    session.run(`NS = {}; COMBAT = true; LOCKED = false; SHOWS = 0; VISIBLE = false
      InCombatLockdown = function() return LOCKED end
      UnitAffectingCombat = function() return COMBAT end
      local original = CreateFrame
      CreateFrame = function(kind, name, ...)
        local frame = original(kind, name, ...)
        frame.CreateFontString = function()
          return setmetatable({GetStringHeight=function() return 100 end}, {__index=function() return function() end end})
        end
        if name == "GuildedRunResults" then
          RESULT_FRAME = frame
          frame.SetSize = function(_, w, h) WIDTH = w; HEIGHT = h end
          frame.SetPoint = function(_, point) ANCHOR = point end
          frame.Show = function() SHOWS = SHOWS + 1; VISIBLE = true end
          frame.Hide = function() VISIBLE = false end
          frame.IsShown = function() return VISIBLE end
        end
        return frame
      end`);
    session.load("Modules/RunResults.lua");
    session.run('NS.runResults.show({name="First",players={}}); NS.runResults.show({name="Latest",players={}})');
    expect(session.run("return tostring(RESULT_FRAME == nil)")).toBe("true");
    session.run('COMBAT = false; LOCKED = true; fire_event("PLAYER_REGEN_ENABLED")');
    expect(session.run("return SHOWS")).toBe("0");
    session.run('LOCKED = false; fire_event("PLAYER_REGEN_ENABLED"); fire_event("PLAYER_REGEN_ENABLED")');
    expect(session.run("return SHOWS")).toBe("1");
    expect(session.run("return NS.runResults.last.name")).toBe("Latest");
    expect(session.run("return WIDTH .. 'x' .. HEIGHT .. ':' .. ANCHOR")).toBe("320x280:BOTTOMRIGHT");
    session.run('COMBAT = true; fire_event("PLAYER_REGEN_DISABLED")');
    expect(session.run("return tostring(VISIBLE)")).toBe("false");
    session.run('COMBAT = false; fire_event("PLAYER_REGEN_ENABLED")');
    expect(session.run("return SHOWS")).toBe("2");
    session.run('RESULT_FRAME:Hide(); fire_event("PLAYER_REGEN_DISABLED"); fire_event("PLAYER_REGEN_ENABLED")');
    expect(session.run("return SHOWS")).toBe("2");
  });
  it("explains pending sync without claiming an upload has happened", () => {
    session = newLuaSession(); session.run("NS = {}"); session.load("Locale.lua"); session.load("Modules/RunResults.lua");
    expect(session.run('return NS.runResults.syncText({})')).toContain("Type /reload or log out");
    expect(session.run('return NS.runResults.syncText({synced=true})')).toContain("Received by Discord");
    session.run('GetLocale = function() return "frFR" end');
    expect(session.run('return NS.runResults.syncText({})')).toContain("Tapez /reload");
  });
  it("shows recorded deaths without claiming unknown players had zero deaths", () => {
    session = newLuaSession(); session.run("NS = {}"); session.load("Modules/RunResults.lua");
    const text = session.run(`return NS.runResults.text({ name = "BRD", state = "COMPLETED", durationSec = 125,
      bossCount = 2, encounters = {{success=true}}, players = { Kev = {deaths=0}, Ann = {} } })`);
    expect(text).toContain("Time: 2:05"); expect(text).toContain("Bosses defeated: 1/2");
    expect(text).toContain("Ann: deaths unknown"); expect(text).toContain("Kev: 0 deaths");
    expect(text).toContain("Discord validates the run and awards points");
  });
  it("replays recent own unsynced runs for a trusted officer, with a cooldown", () => {
    session = newLuaSession(); session.run("NS = {}; GuildedDB = nil");
    session.load("Core.lua"); session.load("Compat.lua"); session.load("Modules/Dungeon.lua");
    session.run(`fire_event("PLAYER_LOGIN"); STAMP = 2000000000; NS.compat.serverTime = function() return STAMP end
      NS.isOfficerName = function(name) return name == "Officer" end
      REPLAY = {}; NS.comm.send = function(prefix, text, channel) REPLAY[#REPLAY + 1] = text end
      GuildedDB.dungeon = { runs = {
        own = {id="own",state="COMPLETED",endedAt=STAMP-10,startedAt=STAMP-100,players={Tester={deaths=1}},encounters={}},
        synced = {id="synced",state="COMPLETED",synced=true,endedAt=STAMP-10,players={Tester={}},encounters={}},
        other = {id="other",state="COMPLETED",endedAt=STAMP-10,players={Other={}},encounters={}}
      } }
      fire_event("CHAT_MSG_ADDON", "GuildedDgn", "REQUEST|1", "GUILD", "Stranger")`);
    expect(session.run("return #REPLAY")).toBe("0");
    session.run(`fire_event("CHAT_MSG_ADDON", "GuildedDgn", "REQUEST|1", "GUILD", "Officer")`);
    expect(session.run("return REPLAY[1]")).toContain("SUM|own|");
    expect(session.run("return #REPLAY")).toBe("1");
    session.run(`fire_event("CHAT_MSG_ADDON", "GuildedDgn", "REQUEST|1", "GUILD", "Officer")`);
    expect(session.run("return #REPLAY")).toBe("1");
    session.run(`NS.onDungeonSummary = function(run) DISPLAYED = run.id end
      NS.commandHandlers.dungeon({"results"})`);
    expect(session.run("return DISPLAYED")).toBe("own");
  });
});
