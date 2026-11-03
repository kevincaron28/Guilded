import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

let session: LuaSession | undefined;
afterEach(() => { session?.close(); session = undefined; });
function login(setup: string) {
  session = newLuaSession();
  session.run(`GuildedDB = nil; NS = {}; ${setup}`);
  session.load("Core.lua");
  session.run('fire_event("PLAYER_LOGIN")');
  return session;
}

describe("guild rank captured from the game", () => {
  it("records the player's own rank name and 0-based index", () => {
    const s = login('GetGuildInfo = function() return "Gold", "Officer", 1 end');
    expect(s.run("return GuildedDB.character.guildRankName .. ':' .. GuildedDB.character.guildRankIndex")).toBe("Officer:1");
  });
  it("keeps the guild master at index 0", () => {
    const s = login('GetGuildInfo = function() return "Gold", "Guild Master", 0 end');
    expect(s.run("return tostring(GuildedDB.character.guildRankIndex)")).toBe("0");
  });
  it("leaves the rank out when the client does not know the guild yet", () => {
    const s = login("GetGuildInfo = function() return nil end");
    expect(s.run("return tostring(GuildedDB.character.guildRankName) .. tostring(GuildedDB.character.guildRankIndex)")).toBe("nilnil");
  });
  it("ignores a rank outside the 0-19 range", () => {
    const s = login('GetGuildInfo = function() return "Gold", "Odd", 40 end');
    expect(s.run("return tostring(GuildedDB.character.guildRankIndex)")).toBe("nil");
  });
  it("stores each guildmate's rank from the guild roster", () => {
    const s = login("");
    s.run(String.raw`
      ROWS = { { "Kev-Realm", "Officer", 1 }, { "Ann-Realm", "Member", 4 } }
      GetNumGuildMembers = function() return #ROWS end
      GetGuildRosterInfo = function(i) return ROWS[i][1], ROWS[i][2], ROWS[i][3] end
      fire_event("GUILD_ROSTER_UPDATE")
    `);
    expect(s.run("return GuildedDB.roster.Ann.rankName .. ':' .. GuildedDB.roster.Ann.rankIndex")).toBe("Member:4");
    expect(s.run("return GuildedDB.roster.Kev.rankName .. ':' .. GuildedDB.roster.Kev.rankIndex")).toBe("Officer:1");
  });
  it("keeps the last known rank when a roster row lacks one", () => {
    const s = login("");
    s.run(String.raw`
      GetNumGuildMembers = function() return 1 end
      GetGuildRosterInfo = function() return "Ann-Realm", "Member", 4 end
      fire_event("GUILD_ROSTER_UPDATE")
      GetGuildRosterInfo = function() return "Ann-Realm", nil, nil end
      fire_event("GUILD_ROSTER_UPDATE")
    `);
    expect(s.run("return GuildedDB.roster.Ann.rankIndex")).toBe("4");
  });
});
