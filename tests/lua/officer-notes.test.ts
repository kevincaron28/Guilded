import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";
import { rosterPrelude } from "./roster-tools.test.js";

let s: LuaSession;
afterEach(() => s?.close());

// RosterTools + OfficerNotes (9.2: only the promotion job is left) on the fake guild: Boss (rank 0, you), Amy and Bob (rank 3 of 0-4).
function setup() {
  s = newLuaSession();
  s.run(rosterPrelude);
  s.run(String.raw`
    DB = { peerRoster = { ["Amy-Realm"] = { professions = "Alchemy:300,Herbalism:225" }, ["Bob-Realm"] = { professions = "Mining:150" } } }
    NS.getDb = function() return DB end
    NS.displayName = function(n) return n end
    NS.message = function(m) MESSAGES = MESSAGES or {}; MESSAGES[#MESSAGES + 1] = m end
    NS.isOfficerName = function() return true end
    function GetGuildRosterInfo(i) READS = READS + 1; local r = ROWS[i]; return r.name, r.rankName or "Rank", r.rank, r.level or 60, "Mage", "Zone", r.public, r.officer, true, nil, "MAGE", 0, 0, false, false, 0, r.guid end
    function GuildControlGetRankName(i) return "R" .. i end
    SAID = {}
    function SendChatMessage(text, channel) SAID[#SAID + 1] = { text, channel } end
    C_Timer = { After = function(_, fn) fn() end }
  `);
  s.load("Modules/RosterTools.lua");
  s.load("Modules/RosterProfessions.lua");
  s.load("Modules/OfficerNotes.lua");
  s.run('NS.util.gameEdition=function() return EDITION end; NS.util.address=function(n) return n end; fire_event("GUILD_ROSTER_UPDATE")');
  return s;
}
// One tick at a given time, after a fresh roster event (what the game sends between our writes).
const tick = (clock: number) => s.run(`CLOCK=${clock}; fire_event("GUILD_ROSTER_UPDATE"); return tostring(NS.officerNotes.tick())`);
const calls = () => s.run("local out={} for i,c in ipairs(CALLS) do out[i]=tostring(c[1])..'='..tostring(c[2]) end return table.concat(out,'|')");
const only = (keys: string[]) => s.run(`for _,k in ipairs({"promote"}) do NS.officerNotes.set(k,false) end for _,k in ipairs({${keys.map((k) => `"${k}"`).join(",")}}) do NS.officerNotes.set(k,true) end`);

describe("Initiate to Member", () => {
  const link = (names: string) => `GuildedPromotion = { linked = { ${names} } }`;
  it("promotes a linked member at the lowest rank by index, one rank, and logs it", () => {
    setup(); only(["promote"]);
    s.run(`ROWS[2].rank=4; ROWS[2].rankName="Whatever"; ROWS[3].rank=4; ${link('"Amy-Realm"')}; fire_event("GUILD_ROSTER_UPDATE")`);
    expect(tick(100)).toBe("true");
    expect(calls()).toBe("Amy-Realm=nil"); // GuildPromote("Amy-Realm"): Bob is not linked
    expect(s.run("return NS.officerNotes and DB.officerAuto.log[1].kind")).toBe("promote");
    expect(s.run("return MESSAGES[#MESSAGES]")).toContain("Promoted Amy-Realm");
  });
  it("never promotes the same player twice, a higher rank, or an unlinked player", () => {
    setup(); only(["promote"]);
    s.run(`ROWS[2].rank=3; ${link('"Amy-Realm","Bob-Realm"')}; fire_event("GUILD_ROSTER_UPDATE")`); // rank 3 of 0-4 is not the lowest
    expect(tick(100)).toBe("false");
    s.run('ROWS[2].rank=4; fire_event("GUILD_ROSTER_UPDATE")');
    expect(tick(170)).toBe("true");
    s.run('ROWS[2].rank=3; fire_event("GUILD_ROSTER_UPDATE")'); // the roster confirms the promotion
    expect(tick(190)).toBe("false");
    s.run('ROWS[2].rank=4; fire_event("GUILD_ROSTER_UPDATE")'); // an officer demoted them again: left alone
    expect(tick(250)).toBe("false");
    expect(calls()).toBe("Amy-Realm=nil");
  });
  it("needs the bot's list and a lowest rank that can still be promoted", () => {
    setup(); only(["promote"]);
    s.run("ROWS[2].rank=4; fire_event('GUILD_ROSTER_UPDATE')");
    expect(tick(100)).toBe("false"); // no GuildedPromotion at all
    expect(calls()).toBe("");
  });
});

describe("switches and commands", () => {
  it("the command turns the promotion job off and on and reports the state", () => {
    setup();
    expect(s.run('return tostring(NS.officerNotes.enabled("promote"))')).toBe("true"); // on by default
    s.run('NS.officerNotes.command({"officer","auto","promote","off"})');
    expect(s.run('return tostring(NS.officerNotes.enabled("promote"))')).toBe("false");
    s.run('NS.officerNotes.command({"officer","auto","all","on"})');
    expect(s.run('return tostring(NS.officerNotes.enabled("promote"))')).toBe("true");
  });
  // 9.2: the note writers and the automatic welcome were removed. Their commands explain themselves, change nothing,
  // and an old save that still has their switches, greeted names and language loads without an error.
  it("explains a removed job's command and ignores its old saved keys", () => {
    setup();
    s.run('DB.officerAuto = { off = { greet = true, epgp = true }, greeted = { Zed = 1 }, lang = "fr", log = {}, promoted = {} }');
    for (const job of ["professions", "epgp", "greet"]) {
      s.run(`NS.officerNotes.command({"officer","auto","${job}","off"})`);
      expect(s.run("return MESSAGES[#MESSAGES]")).toContain(`officer auto ${job} was removed in 9.2`);
    }
    s.run('NS.officerNotes.command({"officer","auto","lang","en"})');
    expect(s.run("return MESSAGES[#MESSAGES]")).toContain("removed in 9.2");
    expect(s.run('return tostring(NS.officerNotes.enabled("promote"))')).toBe("true");
    expect(s.run('return tostring(NS.officerNotes.set("greet", true))')).toBe("false");
    // A joiner is no longer welcomed, and no note is written, whatever the saved switches say.
    s.run('fire_event("CHAT_MSG_SYSTEM", "Zed has joined the guild.")');
    s.run('ROWS[2].public=""; fire_event("GUILD_ROSTER_UPDATE")');
    expect(tick(100)).toBe("false");
    expect(s.run("return #SAID")).toBe("0");
    expect(calls()).toBe("");
  });
});
