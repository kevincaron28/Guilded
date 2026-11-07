import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";
import { rosterPrelude } from "./roster-tools.test.js";

let s: LuaSession;
afterEach(() => s?.close());

// RosterTools + RosterProfessions + OfficerNotes on the fake guild: Boss (rank 0, you), Amy and Bob (rank 3 of 0-4).
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
const only = (keys: string[]) => s.run(`for _,k in ipairs({"professions","epgp","promote","greet"}) do NS.officerNotes.set(k,false) end for _,k in ipairs({${keys.map((k) => `"${k}"`).join(",")}}) do NS.officerNotes.set(k,true) end`);

describe("note text", () => {
  it("keeps a main/alt marker and fits 31 bytes", () => {
    setup();
    const note = (current: string, skills: string) => s.run(`return tostring(NS.officerNotes.publicNote(${JSON.stringify(current)}, NS.rosterProfessions.parse(${JSON.stringify(skills)})))`);
    expect(note("", "Alchemy:300,Herbalism:300")).toBe("Alch300 Herb300");
    expect(note("Main", "Alchemy:300,Herbalism:300")).toBe("Main Alch300 Herb300");
    expect(note("Alt of Kevin", "Alchemy:300")).toBe("Alt of Kevin Alch300");
    expect(note("Main Alch100", "Alchemy:300")).toBe("Main Alch300");
    // unchanged -> nothing to write; no skills -> never wipe
    expect(note("Main Alch300 Herb300", "Alchemy:300,Herbalism:300")).toBe("nil");
    expect(note("Main", "")).toBe("nil");
    // shortened to fit, never longer than 31
    const long = s.run(`return NS.officerNotes.publicNote("Main of the raid", NS.rosterProfessions.parse("Alchemy:300,Herbalism:300,Mining:300,Skinning:300,Cooking:300"))`);
    expect(long.length).toBeLessThanOrEqual(31);
    expect(long.startsWith("Main of the raid ")).toBe(true);
    // the existing text alone leaves no room: leave the note alone
    expect(note("x".repeat(28), "Alchemy:300")).toBe("nil");
  });
  it("writes EP,GP after any existing text and only when it changed", () => {
    setup();
    const note = (current: string, ep: number, gp: number) => s.run(`return tostring(NS.officerNotes.officerNote(${JSON.stringify(current)}, ${ep}, ${gp}))`);
    expect(note("", 1000, 150)).toBe("1000,150");
    expect(note("1000,100", 1000, 150)).toBe("1000,150");
    expect(note("on loot ban", 1000, 150)).toBe("on loot ban 1000,150");
    expect(note("1000,150", 1000, 150)).toBe("nil");
    expect(note("", 0, 0)).toBe("nil");
    expect(note("5,5", 0, 0)).toBe("0,0");
    expect(note("y".repeat(28), 1000, 150)).toBe("nil");
  });
});

describe("professions in public notes", () => {
  it("writes one note per interval, keeps text, then goes quiet", () => {
    setup(); only(["professions"]);
    expect(tick(100)).toBe("true");
    expect(calls()).toBe("2=old Alch300 Herb225"); // Amy: existing text kept
    // the same moment again: paced, nothing more is sent
    expect(tick(100)).toBe("false");
    expect(tick(105)).toBe("false");
    s.run('ROWS[2].public="old Alch300 Herb225"; CLOCK=106; fire_event("GUILD_ROSTER_UPDATE")');
    expect(tick(113)).toBe("true");
    expect(calls()).toBe("2=old Alch300 Herb225|3=Mine150");
    s.run('ROWS[3].public="Mine150"; CLOCK=114; fire_event("GUILD_ROSTER_UPDATE")');
    expect(tick(130)).toBe("false"); // nothing changed any more
    expect(calls()).toBe("2=old Alch300 Herb225|3=Mine150");
  });
  it("does nothing when switched off, for a non-officer, in combat, or when the note already matches", () => {
    setup(); only([]);
    expect(tick(100)).toBe("false");
    only(["professions"]); s.run('ROWS[2].public="Alch300 Herb225"; ROWS[3].public="Mine150"');
    expect(tick(120)).toBe("false");
    s.run('ROWS[3].public=""; COMBAT=true');
    expect(tick(190)).toBe("false");
    s.run("COMBAT=false; OFFICER=false");
    expect(tick(250)).toBe("false");
    expect(calls()).toBe("");
  });
  it("never touches yourself or a rank above you", () => {
    setup(); only(["professions"]);
    s.run('DB.peerRoster["Boss-Realm"] = { professions = "Mining:300" }; ROWS[3].rank = 0; ROWS[3].guid = "bob0"; fire_event("GUILD_ROSTER_UPDATE")');
    tick(100);
    expect(calls()).toBe("2=old Alch300 Herb225");
  });
});

describe("EP/GP in officer notes", () => {
  it("writes the standing from the ledger, falling back to the bot's standings", () => {
    setup(); only(["epgp"]);
    s.run('DB.epgp = { ["Amy-Realm"] = { ep = 1000.7, gp = 150 } }; GuildedStandings = { players = { { name = "Bob-Realm", ep = 20, gp = 5 } } }; ROWS[2].officer=""');
    expect(tick(100)).toBe("true");
    expect(calls()).toBe("2=1000,150");
    s.run('ROWS[2].officer="1000,150"; CLOCK=101; fire_event("GUILD_ROSTER_UPDATE")');
    expect(tick(113)).toBe("true");
    expect(calls()).toBe("2=1000,150|3=20,5");
  });
  it("cannot read or write officer notes without that permission", () => {
    setup(); only(["epgp"]);
    s.run('DB.epgp = { ["Amy-Realm"] = { ep = 1, gp = 1 } }; PRIVATE=false; fire_event("GUILD_ROSTER_UPDATE")');
    expect(tick(100)).toBe("false");
    expect(calls()).toBe("");
  });
});

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

describe("greeting", () => {
  it("welcomes a joiner once, in the guild language, with an off switch", () => {
    setup(); only(["greet"]);
    s.run('fire_event("CHAT_MSG_SYSTEM", "Zed has joined the guild.")');
    expect(s.run("return #SAID .. ':' .. SAID[1][2]")).toBe("1:GUILD");
    expect(s.run("return SAID[1][1]")).toContain("Welcome to the guild, Zed");
    s.run('fire_event("CHAT_MSG_SYSTEM", "Zed has joined the guild.")');
    expect(s.run("return #SAID")).toBe("1");
    s.run('NS.officerNotes.command({"officer","auto","lang","fr"}); fire_event("CHAT_MSG_SYSTEM", "Yan has joined the guild.")');
    expect(s.run("return SAID[2][1]")).toContain("Bienvenue dans la guilde, Yan");
    s.run('NS.officerNotes.command({"officer","auto","greet","off"}); fire_event("CHAT_MSG_SYSTEM", "Xia has joined the guild.")');
    expect(s.run("return #SAID")).toBe("2");
  });
  it("is silent for non-officers, for yourself, and when another officer already greeted", () => {
    setup(); only(["greet"]);
    s.run('OFFICER=false; fire_event("CHAT_MSG_SYSTEM", "Zed has joined the guild.")');
    expect(s.run("return #SAID")).toBe("0");
    s.run('OFFICER=true; fire_event("CHAT_MSG_SYSTEM", "Boss-Realm has joined the guild.")');
    expect(s.run("return #SAID")).toBe("0");
    s.run('NS.officerNotes.onAddonMessage("GREETED|1|Vic", "Other-Realm"); fire_event("CHAT_MSG_SYSTEM", "Vic has joined the guild.")');
    expect(s.run("return #SAID")).toBe("0");
  });
});

describe("off switches", () => {
  it("the command turns each job off and on and reports the state", () => {
    setup();
    expect(s.run('return tostring(NS.officerNotes.enabled("epgp"))')).toBe("true"); // on by default
    s.run('NS.officerNotes.command({"officer","auto","epgp","off"})');
    expect(s.run('return tostring(NS.officerNotes.enabled("epgp")) .. tostring(NS.officerNotes.enabled("greet"))')).toBe("falsetrue");
    s.run('NS.officerNotes.command({"officer","auto","all","off"})');
    expect(s.run('return tostring(NS.officerNotes.enabled("greet"))')).toBe("false");
    s.run('NS.officerNotes.command({"officer","auto","all","on"})');
    expect(s.run('return tostring(NS.officerNotes.enabled("promote"))')).toBe("true");
  });
});
