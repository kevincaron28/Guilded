import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";
import { rosterPrelude } from "./roster-tools.test.js";

let s: LuaSession;
afterEach(() => s?.close());

// RosterTools + OfficerNotes (16 Nov 2026: only the ready-to-promote switch is left) on the fake guild: Boss (rank 0, you), Amy and Bob (rank 3 of 0-4).
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
const calls = () => s.run("local out={} for i,c in ipairs(CALLS) do out[i]=tostring(c[1])..'='..tostring(c[2]) end return table.concat(out,'|')");

// The promotion job itself (bot rule, one click, alts) is tested in promotion-rework.test.ts.

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
    expect(s.run("return #SAID")).toBe("0");
    expect(calls()).toBe("");
  });
});
