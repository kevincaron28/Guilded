import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

const sessions: LuaSession[] = [];
afterEach(() => { for (const session of sessions) session.close(); sessions.length = 0; });
function client(officer = false) {
  const s = newLuaSession(); sessions.push(s);
  s.run(`
    NOW = 1800000000; GUILD = "Test Guild"; DB = { guildKey = "Test Guild-Realm", settings = {} }; SENT = {}
    IsInGuild = function() return GUILD ~= nil end
    GetGuildInfo = function() return GUILD end
    GetRealmName = function() return "Realm" end
    NS = { getDb = function() return DB end, playerName = function() return "${officer ? "Officer" : "Member"}" end,
      normalizeName = function(n) return string.match(n, "^([^%-]+)") end,
      isSecret = function() return false end, isOfficer = function() return ${officer} end,
      isOfficerName = function(n) return n == "Officer" or n == "Second" end,
      message = function(text) CHAT_LOG = CHAT_LOG or {}; CHAT_LOG[#CHAT_LOG+1] = text end,
      commandHandlers = {}, commandHelp = {},
      util = { serverTime = function() return NOW end, tooFarAhead = function(stamp) return string.find(stamp, "2099") ~= nil end },
      comm = { register = function() end, send = function(prefix, text, channel) if prefix == "GuildedBridge" then SENT[#SENT+1] = text end end }
    }
  `);
  s.load("Modules/Sync.lua"); s.load("Modules/OfficerBridge.lua");
  return s;
}
function snapshot(s: LuaSession, stamp = "2026-10-05T20:25:10.149Z") {
  s.run(`
    GuildedStandings = { updatedAt = "${stamp}", players = {} }
    GuildedLoot = { default = "EPGP", coreOnly = true, cores = { { id = "core1", name = "Weeknight", mode = "PRIORITY", pool = true, offspec = 40, minEp = 100,
      players = { { name = "Member", ep = 100, gp = 25 } }, roster = { { name = "Member", member = "Member", role = "Healer", backup = true } }, values = { ["#123"] = 20 } } } }
    GuildedNextRaid = { id = "raid1", title = "Raid | tonight", at = "2026-10-06T20:00:00Z", core = "Weeknight", coreId = "core1", players = { { name = "Member", role = "Healer" } }, maybe = {} }
    GuildedRaids = { { id = "raid1", title = "Raid | tonight", at = "2026-10-06T20:00:00Z", note = "Équipe: ; | :" } }
  `);
}
function packets(s: LuaSession) {
  return Array.from({ length: Number(s.run("return #SENT")) }, (_, i) => s.run(`return SENT[${i + 1}]`)).filter(p => p.startsWith("DATA|"));
}
function deliver(s: LuaSession, messages: string[], sender = "Officer", channel = "GUILD") {
  for (const message of messages) s.run(`fire_event("CHAT_MSG_ADDON", "GuildedBridge", ${JSON.stringify(message)}, "${channel}", "${sender}")`);
}

describe("officer companion bridge", () => {
  it("requires explicit officer opt-in and shares core pools, rosters and upcoming raids", () => {
    const officer = client(true); snapshot(officer);
    officer.run('fire_event("PLAYER_ENTERING_WORLD"); fire_event("CHAT_MSG_ADDON", "GuildedBridge", "REQ|1|0", "GUILD", "Member")');
    expect(packets(officer)).toHaveLength(0);
    officer.run('NS.commandHandlers.bridge({"on"})');
    const messages = packets(officer); expect(messages.length).toBeGreaterThan(1);
    expect(messages.every(p => Buffer.byteLength(p) <= 255)).toBe(true);
    const member = client(); deliver(member, [...messages].reverse());
    expect(member.run('return DB.lootRules.cores[1].players.Member.gp')).toBe("25");
    expect(member.run('return DB.lootRules.cores[1].roster[1].role')).toBe("Healer");
    expect(member.run('return GuildedNextRaid.players[1].name')).toBe("Member");
    expect(member.run('return GuildedRaids[1].note')).toBe("Équipe: ; | :");
    member.run('GuildedNextRaid = nil; GuildedRaids = nil; fire_event("PLAYER_ENTERING_WORLD")');
    expect(member.run('return GuildedNextRaid.id')).toBe("raid1");
  });
  it("rejects outsiders, whispers, wrong guild data, incomplete and conflicting chunks", () => {
    const officer = client(true); snapshot(officer); officer.run('NS.commandHandlers.bridge({"on"})');
    const messages = packets(officer);
    const member = client(); deliver(member, messages, "Outsider"); deliver(member, messages, "Officer", "WHISPER");
    expect(member.run('return tostring(DB.officerBridge)')).toBe("nil");
    member.run('GUILD = "Other Guild"; DB.guildKey = "Other Guild-Realm"'); deliver(member, messages);
    expect(member.run('return tostring(DB.officerBridge)')).toBe("nil");
    member.run('GUILD = "Test Guild"; DB.guildKey = "Test Guild-Realm"');
    deliver(member, messages.slice(0, -1));
    expect(member.run('return tostring(GuildedNextRaid)')).toBe("nil");
    deliver(member, messages.slice(-1), "Second");
    expect(member.run('return tostring(DB.officerBridge)')).toBe("nil");
    deliver(member, messages.slice(-1));
    expect(member.run('return GuildedNextRaid.id')).toBe("raid1");
  });
  it("keeps newer data, refuses future data, and clears cancelled raids with a fresh snapshot", () => {
    const officer = client(true); snapshot(officer); officer.run('NS.commandHandlers.bridge({"on"})');
    const old = packets(officer); const member = client(); deliver(member, old);
    officer.run('NOW = NOW + 100; SENT = {}'); snapshot(officer, "2026-10-06T20:25:10.149Z");
    officer.run('GuildedNextRaid = nil; GuildedRaids = nil; NS.commandHandlers.bridge({"on"})');
    deliver(member, packets(officer)); deliver(member, old);
    expect(member.run('return tostring(GuildedNextRaid) .. "/" .. #GuildedRaids')).toBe("nil/0");
    const fresh = client(); deliver(fresh, old.map(p => p.replace("2026-10-05", "2099-10-05")));
    expect(fresh.run('return tostring(DB.officerBridge)')).toBe("nil");
  });
  it("answers late members from cached data with a bounded guild broadcast and opt-out", () => {
    const officer = client(true); snapshot(officer); officer.run('NS.commandHandlers.bridge({"on"}); SENT = {}');
    officer.run('fire_event("CHAT_MSG_ADDON", "GuildedBridge", "REQ|1|0", "GUILD", "Member")');
    expect(packets(officer)).toHaveLength(0);
    officer.run('NOW = NOW + 100; fire_event("CHAT_MSG_ADDON", "GuildedBridge", "REQ|1|0", "GUILD", "Late")');
    const count = packets(officer).length; expect(count).toBeGreaterThan(0);
    officer.run('fire_event("CHAT_MSG_ADDON", "GuildedBridge", "REQ|1|0", "GUILD", "Other")');
    expect(packets(officer)).toHaveLength(count);
    officer.run('NS.commandHandlers.bridge({"off"}); NOW = NOW + 100; SENT = {}; fire_event("CHAT_MSG_ADDON", "GuildedBridge", "REQ|1|0", "GUILD", "Late")');
    expect(packets(officer)).toHaveLength(0);
  });
  it("members cannot enable the bridge and changing guild clears received raid globals", () => {
    const officer = client(true); snapshot(officer); officer.run('NS.commandHandlers.bridge({"on"})');
    const member = client(); member.run('fire_event("PLAYER_ENTERING_WORLD"); NS.commandHandlers.bridge({"on"})');
    expect(member.run('return tostring(DB.settings.officerBridge)')).toBe("nil");
    deliver(member, packets(officer));
    member.run('GUILD = "Other Guild"; DB = { guildKey = "Other Guild-Realm", settings = {} }; fire_event("PLAYER_GUILD_UPDATE")');
    expect(member.run('return tostring(GuildedNextRaid) .. "/" .. tostring(GuildedRaids)')).toBe("nil/nil");
  });
  it("ignores malformed/resource-abusive data without executing or overwriting a snapshot", () => {
    const member = client();
    deliver(member, [
      "DATA|1|2026-10-05T20:25:10.149Z|1|999999|aa",
      "DATA|1|2026-10-05T20:25:10.149Z|1|1|zz",
      "DATA|1|2026-10-05T20:25:10.149Z|1|1|" + Buffer.from('t999999999:').toString('hex'),
      "DATA|1|2026-10-05T20:25:10.149Z|1|1|" + Buffer.from('os.execute("bad")').toString('hex')
    ]);
    expect(member.run('return tostring(DB.officerBridge)')).toBe("nil");
  });
  it("ordinary guild updates do not discard an in-flight snapshot", () => {
    const officer = client(true); snapshot(officer); officer.run('NS.commandHandlers.bridge({"on"})');
    const member = client(); member.run('fire_event("PLAYER_ENTERING_WORLD")');
    const messages = packets(officer); deliver(member, messages.slice(0, -1));
    member.run('fire_event("PLAYER_GUILD_UPDATE")'); deliver(member, messages.slice(-1));
    expect(member.run('return GuildedNextRaid.id')).toBe("raid1");
  });
  it("keeps officer-only Discord events on the officer's PC and strips ownership IDs", () => {
    const officer = client(true); snapshot(officer);
    officer.run('GuildedLoot.cores[1].players[1].account = "private-owner-id"; table.insert(GuildedRaids, { id = "discord:123", title = "Officer meeting", at = "2026-10-06T20:00:00Z" }); GuildedNextRaid = GuildedRaids[2]; NS.commandHandlers.bridge({"on"})');
    expect(officer.run('return #GuildedRaids')).toBe("2");
    expect(officer.run('return DB.lootRules.cores[1].players.Member.account')).toBe("private-owner-id");
    const member = client(); deliver(member, packets(officer));
    expect(member.run('return #GuildedRaids')).toBe("1");
    expect(member.run('return tostring(GuildedNextRaid)')).toBe("nil");
    expect(member.run('return tostring(DB.lootRules.cores[1].players.Member.account)')).toBe("nil");
    expect(JSON.stringify(packets(officer))).not.toContain(Buffer.from("private-owner-id").toString("hex"));
  });
});
