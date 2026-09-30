import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";
let session: LuaSession | undefined;
afterEach(() => session?.close());
function setup() {
  session = newLuaSession(); session.run("NS = {}; GuildedDB = nil");
  session.load("Core.lua"); session.load("Compat.lua"); session.load("Modules/SeasonSync.lua");
  session.run(`fire_event("PLAYER_LOGIN"); NS.isGuildMember = function() return true end
    NS.isOfficerName = function(name) return name == "Officer" or name == "SecondOfficer" end
    NS.util.tooFarAhead = function() return false end`);
  return session;
}
describe("official season relay for addon-only members", () => {
  it("accepts an officer snapshot with current and past seasons, ignores outsiders and older data", () => {
    const s = setup();
    const text = "BOARD|2026-09-30T10:00:00Z|1|1|S;Season 2;ACTIVE\nR;Ann;50\nS;Season 1;ENDED\nR;Bob%3BAlt;80";
    s.run(`fire_event("CHAT_MSG_ADDON", "GuildedSeason", ${JSON.stringify(text)}, "GUILD", "Stranger")`);
    expect(s.run("return tostring(GuildedDungeonBoard)")).toBe("nil");
    s.run(`fire_event("CHAT_MSG_ADDON", "GuildedSeason", ${JSON.stringify(text)}, "GUILD", "Officer")`);
    expect(s.run("return GuildedDungeonBoard.rows[1].points")).toBe("50");
    expect(s.run("return GuildedDungeonBoard.history[1].rows[1].name")).toBe("Bob;Alt");
    s.run(`fire_event("CHAT_MSG_ADDON", "GuildedSeason", "BOARD|2026-09-29T10:00:00Z|1|1|S;Old;ACTIVE", "GUILD", "Officer")`);
    expect(s.run("return GuildedDungeonBoard.season")).toBe("Season 2");
  });
  it("does not combine chunks from different senders or accept out-of-range parts", () => {
    const s = setup();
    s.run(`fire_event("CHAT_MSG_ADDON", "GuildedSeason", "BOARD|2026-09-30T10:00:00Z|1|2|S;Season 2;ACTIVE\\n", "GUILD", "Officer")
      fire_event("CHAT_MSG_ADDON", "GuildedSeason", "BOARD|2026-09-30T10:00:00Z|2|2|R;Ann;50", "GUILD", "SecondOfficer")
      fire_event("CHAT_MSG_ADDON", "GuildedSeason", "BOARD|2026-09-30T10:00:00Z|3|2|R;Ann;50", "GUILD", "Officer")`);
    expect(s.run("return tostring(GuildedDungeonBoard)")).toBe("nil");
    s.run(`fire_event("CHAT_MSG_ADDON", "GuildedSeason", "BOARD|2026-09-30T10:00:00Z|2|2|R;Ann;50", "GUILD", "Officer")`);
    expect(s.run("return GuildedDungeonBoard.rows[1].points")).toBe("50");
  });
});
