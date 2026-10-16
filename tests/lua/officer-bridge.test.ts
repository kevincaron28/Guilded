import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

const sessions: LuaSession[] = [];
afterEach(() => { for (const session of sessions) session.close(); sessions.length = 0; });
function client(officer = false) {
  const s = newLuaSession(); sessions.push(s);
  s.run(`
    NOW = 1800000000; GUILD = "Test Guild"; DB = { guildKey = "Test Guild-Realm", settings = {} }; SENT = {}
    -- Timers wait until a test runs them: replies to REQ are delayed by a few seconds.
    TIMERS = {}
    C_Timer = { After = function(delay, fn) TIMERS[#TIMERS + 1] = { delay = delay, fn = fn } end }
    function run_replies()
      local due = {}
      for i = #TIMERS, 1, -1 do if TIMERS[i].delay <= 6 then table.insert(due, 1, table.remove(TIMERS, i)) end end
      for _, timer in ipairs(due) do timer.fn() end
    end
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
const segmentRealms = [1, 2, 3, 4, 12, 100].map(number => `Classic Beta PvP ${number}`);
function guildRealm(s: LuaSession, localRealm: string, home: string | null = null) {
  s.run(`
    GetRealmName = function() return ${JSON.stringify(localRealm)} end
    GetGuildInfo = function() return GUILD, "Officer", 1, ${home === null ? "nil" : JSON.stringify(home)} end
    DB.guildKey = GUILD .. "-" .. GetRealmName()
  `);
}

describe("officer companion bridge", () => {
  it.each(segmentRealms)("receives on %s from the home segment, including older senders and cached reloads", receiverRealm => {
    const officer = client(true); snapshot(officer);
    guildRealm(officer, "Classic Beta PvP");
    officer.run('NS.commandHandlers.bridge({"on"})');
    const member = client();
    guildRealm(member, receiverRealm, "ClassicBetaPvP");
    deliver(member, packets(officer));
    expect(member.run('return GuildedNextRaid.id')).toBe("raid1");
    member.run('GuildedNextRaid = nil; fire_event("PLAYER_ENTERING_WORLD"); NS.commandHandlers.bridge({"status"})');
    expect(member.run('return GuildedNextRaid.id')).toBe("raid1");
    expect(member.run('return CHAT_LOG[#CHAT_LOG]')).toContain("Guild data from Officer");
    // Existing cached broadcasts have no explicit guildHome field.
    officer.run('DB.officerBridge.snapshot.guildHome = nil; SENT = {}; NOW = NOW + 100; NS.commandHandlers.bridge({"on"})');
    const legacyReceiver = client();
    guildRealm(legacyReceiver, receiverRealm, "ClassicBetaPvP");
    deliver(legacyReceiver, packets(officer));
    expect(legacyReceiver.run('return GuildedNextRaid.id')).toBe("raid1");
  });
  it.each(segmentRealms)("shares from %s but rejects a same-named guild on another home", senderRealm => {
    const officer = client(true); snapshot(officer);
    guildRealm(officer, senderRealm, "ClassicBetaPvP");
    officer.run('NS.commandHandlers.bridge({"on"})');
    const member = client(); guildRealm(member, "Classic Beta PvP");
    deliver(member, packets(officer));
    expect(member.run('return GuildedNextRaid.id')).toBe("raid1");
    const outsider = client(); outsider.run('GetRealmName = function() return "Classic Beta PvE" end; DB.guildKey = "Test Guild-Classic Beta PvE"');
    deliver(outsider, packets(officer));
    expect(outsider.run('return tostring(DB.officerBridge)')).toBe("nil");
  });
  it.each([
    ["Classic Beta PvP 3", "Classic Beta PvP 4"],
    ["Classic Beta PvP 12", "Classic Beta PvP 100"]
  ])("shares between numbered segments %s and %s using the reported guild home", (senderRealm, receiverRealm) => {
    const officer = client(true); snapshot(officer);
    guildRealm(officer, senderRealm, "Classic Beta PvP");
    officer.run('NS.commandHandlers.bridge({"on"})');
    const member = client(); guildRealm(member, receiverRealm, "ClassicBetaPvP");
    deliver(member, packets(officer));
    expect(member.run('return DB.lootRules.cores[1].players.Member.gp')).toBe("25");
    expect(member.run('return GuildedNextRaid.id')).toBe("raid1");
    member.run('GuildedNextRaid = nil; fire_event("PLAYER_ENTERING_WORLD")');
    expect(member.run('return GuildedNextRaid.id')).toBe("raid1");
  });
  it("preserves meaningful numbers in guild homes instead of stripping realm suffixes", () => {
    const officer = client(true); snapshot(officer);
    guildRealm(officer, "Classic Beta PvP 3", "ClassicBetaPvP3");
    officer.run('NS.commandHandlers.bridge({"on"})');
    const messages = packets(officer);
    const member = client(); guildRealm(member, "Classic Beta PvP 4", "Classic Beta PvP 3");
    deliver(member, messages);
    expect(member.run('return GuildedNextRaid.id')).toBe("raid1");
    const outsider = client(); guildRealm(outsider, "Classic Beta PvP 3", "ClassicBetaPvP4");
    deliver(outsider, messages);
    expect(outsider.run('return tostring(DB.officerBridge)')).toBe("nil");
    expect(outsider.run('return tostring(GuildedNextRaid)')).toBe("nil");
  });
  it.each([null, ""])("waits for guild-home information (%s) instead of guessing numbered realms are equivalent", home => {
    const officer = client(true); snapshot(officer);
    guildRealm(officer, "Classic Beta PvP", "ClassicBetaPvP");
    officer.run('NS.commandHandlers.bridge({"on"})');
    const messages = packets(officer);
    const member = client(); guildRealm(member, "Classic Beta PvP 4", home);
    deliver(member, messages);
    expect(member.run('return tostring(DB.officerBridge)')).toBe("nil");
    // A later roster refresh supplies the home; the member can request the same snapshot again.
    guildRealm(member, "Classic Beta PvP 4", "ClassicBetaPvP");
    member.run('NS.commandHandlers.bridge({"refresh"})');
    expect(member.run('return SENT[#SENT]')).toBe("REQ|1|0");
    officer.run('NOW = NOW + 100; SENT = {}; fire_event("CHAT_MSG_ADDON", "GuildedBridge", "REQ|1|0", "GUILD", "Member"); run_replies()');
    deliver(member, packets(officer));
    expect(member.run('return GuildedNextRaid.id')).toBe("raid1");
  });
  it("automatically shares officer core pools, rosters and upcoming raids without opt-in", () => {
    const officer = client(true); snapshot(officer);
    officer.run('fire_event("PLAYER_ENTERING_WORLD"); fire_event("CHAT_MSG_ADDON", "GuildedBridge", "REQ|1|0", "GUILD", "Member"); run_replies()');
    expect(officer.run('return tostring(DB.settings.officerBridge.enabled)')).toBe("true");
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
  it("preserves explicit off through login and reports missing companion data", () => {
    const officer = client(true);
    officer.run('NS.commandHandlers.bridge({"status"})');
    expect(officer.run('return CHAT_LOG[#CHAT_LOG]')).toContain("needs companion data");
    snapshot(officer);
    officer.run('NS.commandHandlers.bridge({"off"}); fire_event("PLAYER_ENTERING_WORLD"); fire_event("CHAT_MSG_ADDON", "GuildedBridge", "REQ|1|0", "GUILD", "Member"); run_replies(); NS.commandHandlers.bridge({"status"})');
    expect(packets(officer)).toHaveLength(0);
    expect(officer.run('return CHAT_LOG[#CHAT_LOG]')).toContain("OFF");
  });
  it("does not automatically rebind a companion snapshot to another guild", () => {
    const officer = client(true); snapshot(officer);
    officer.run('DB.bridgeCompanionGuild = "Other Guild-Realm"; fire_event("PLAYER_ENTERING_WORLD"); fire_event("CHAT_MSG_ADDON", "GuildedBridge", "REQ|1|0", "GUILD", "Member"); run_replies(); NS.commandHandlers.bridge({"status"})');
    expect(packets(officer)).toHaveLength(0);
    expect(officer.run('return CHAT_LOG[#CHAT_LOG]')).toContain("bound to another guild");
  });
  it("lets another WoW officer receive without a personal companion connection", () => {
    const officer = client(true); snapshot(officer); officer.run('NS.commandHandlers.bridge({"on"})');
    const receiver = client(true); receiver.run('NS.playerName = function() return "Second" end');
    deliver(receiver, packets(officer)); receiver.run('NS.commandHandlers.bridge({"status"})');
    expect(receiver.run('return CHAT_LOG[#CHAT_LOG]')).toContain("Guild data from Officer");
    expect(receiver.run('return GuildedNextRaid.id')).toBe("raid1");
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
    officer.run('fire_event("CHAT_MSG_ADDON", "GuildedBridge", "REQ|1|0", "GUILD", "Member"); run_replies()');
    expect(packets(officer)).toHaveLength(0);
    officer.run('NOW = NOW + 100; fire_event("CHAT_MSG_ADDON", "GuildedBridge", "REQ|1|0", "GUILD", "Late"); run_replies()');
    const count = packets(officer).length; expect(count).toBeGreaterThan(0);
    officer.run('fire_event("CHAT_MSG_ADDON", "GuildedBridge", "REQ|1|0", "GUILD", "Other"); run_replies()');
    expect(packets(officer)).toHaveLength(count);
    officer.run('NS.commandHandlers.bridge({"off"}); NOW = NOW + 100; SENT = {}; fire_event("CHAT_MSG_ADDON", "GuildedBridge", "REQ|1|0", "GUILD", "Late"); run_replies()');
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

describe("officer bridge wire versions", () => {
  it("sends the compact DATA|2 to addons that say they read it, and DATA|1 when an older addon asks", () => {
    const officer = client(true); snapshot(officer);
    officer.run('NS.commandHandlers.bridge({"on"})');
    const compact = packets(officer);
    expect(compact.every(p => p.startsWith("DATA|2|"))).toBe(true);
    // The same snapshot in DATA|1 (hex) takes about twice the messages.
    officer.run('NOW = NOW + 100; SENT = {}; fire_event("CHAT_MSG_ADDON", "GuildedBridge", "REQ|1|0", "GUILD", "Member"); run_replies()');
    const legacy = packets(officer);
    expect(legacy.length).toBeGreaterThan(0);
    expect(legacy.every(p => p.startsWith("DATA|1|"))).toBe(true);
    expect(compact.length).toBeLessThan(legacy.length * 0.7);
    // Both arrive intact.
    for (const messages of [compact, legacy]) {
      const member = client(); deliver(member, messages);
      expect(member.run('return GuildedRaids[1].note')).toBe("Équipe: ; | :");
      expect(member.run('return DB.lootRules.cores[1].players.Member.gp')).toBe("25");
    }
  });
  it("asks with CAP|2 first, and an officer answers that requester in DATA|2", () => {
    const member = client(); member.run('NS.commandHandlers.bridge({"refresh"})');
    expect(member.run('return SENT[#SENT - 1] .. " " .. SENT[#SENT]')).toBe("CAP|2 REQ|1|0");
    const officer = client(true); snapshot(officer); officer.run('NS.commandHandlers.bridge({"on"}); NOW = NOW + 100; SENT = {}');
    officer.run('fire_event("CHAT_MSG_ADDON", "GuildedBridge", "CAP|2", "GUILD", "Member"); fire_event("CHAT_MSG_ADDON", "GuildedBridge", "REQ|1|0", "GUILD", "Member"); run_replies()');
    const answer = packets(officer);
    expect(answer.length).toBeGreaterThan(0);
    expect(answer.every(p => p.startsWith("DATA|2|"))).toBe(true);
  });
  it("does not repeat data another officer is already sending", () => {
    const officer = client(true); snapshot(officer); officer.run('NS.commandHandlers.bridge({"on"})');
    const first = packets(officer);
    const second = client(true); second.run('NS.playerName = function() return "Second" end'); snapshot(second);
    second.run('NS.commandHandlers.bridge({"on"}); NOW = NOW + 100; SENT = {}');
    // Second's own copy is the same snapshot; hearing Officer's chunks, it does not answer.
    deliver(second, first.slice(0, 1));
    second.run('fire_event("CHAT_MSG_ADDON", "GuildedBridge", "CAP|2", "GUILD", "Member"); fire_event("CHAT_MSG_ADDON", "GuildedBridge", "REQ|1|0", "GUILD", "Member"); run_replies()');
    expect(packets(second)).toHaveLength(0);
  });
  it("rejects malformed DATA|2 chunks", () => {
    const member = client();
    deliver(member, [
      "DATA|2|2026-10-05T20:25:10.149Z|1|1|t1:" + String.fromCharCode(9),
      "DATA|2|2026-10-05T20:25:10.149Z|1|1|",
      "DATA|2|2026-10-05T20:25:10.149Z|1|1|" + "a".repeat(201),
      "DATA|2|2026-10-05T20:25:10.149Z|1|1|os.execute(%22bad%22)"
    ]);
    expect(member.run('return tostring(DB.officerBridge)')).toBe("nil");
  });
});
