import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";
let session: LuaSession | undefined;
afterEach(() => session?.close());
describe("end of dungeon run summary", () => {
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
      encounters={{success=true},{success=true},{success=true},{success=true}},
      players={Highpriest={class="PRIEST",role="HEALER",deaths=0},Guest={class="HUNTER",role="DPS"}}})`);
    const rendered = session.run('return table.concat(LABELS, "\\n")');
    expect(rendered).toContain("RUN COMPLETE");
    expect(rendered).toContain("22:25");
    expect(rendered).toContain("PRIEST / Healer");
    expect(rendered).toContain("deaths unknown");
    expect(rendered).toContain("Type /reload or log out");
    expect(session.run("return RELOADS")).toBe("0");
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
