import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";
let session: LuaSession | undefined;
afterEach(() => session?.close());
describe("end of dungeon run summary", () => {
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
  });
});
