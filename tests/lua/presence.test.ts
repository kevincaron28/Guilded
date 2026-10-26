import { afterEach, describe, expect, it } from "vitest";
import { addonSource, newLuaSession, type LuaSession } from "./harness.js";

let session: LuaSession | undefined;
afterEach(() => { session?.close(); session = undefined; });
function setup() {
  const s = session = newLuaSession();
  s.run(`
    CLOCK = 100; EPOCH = 1792929600; GUILD = "Alpha"; EDITION = "forever"; INSIDE = false; COMBAT = false; ACTIVE = true; SENT = {}
    function GetTime() return CLOCK end
    function GetServerTime() return EPOCH end
    function GetGuildInfo() return GUILD end
    function IsInInstance() return INSIDE end
    function InCombatLockdown() return COMBAT end
    function ADVANCE(n) CLOCK = CLOCK + n; EPOCH = EPOCH + n end
    NS = {
      util = { gameEdition = function() return EDITION end },
      normalizeName = function(name) return EDITION == "forever" and name:match("^%S+") or name end,
      playerName = function() return "Tester" end,
      isSecret = function(v) return v == "SECRET" end,
      moduleActive = function() return ACTIVE end,
      comm = { send = function(prefix, text, channel) SENT[#SENT + 1] = text; return true end, register = function() end },
      message = function(t) LAST_MESSAGE = t end,
      showCopyText = function(t) COPIED = t end
    }
  `);
  s.load("Modules/Presence.lua");
  s.run(`P = NS.presence; function SETTINGS() for _, v in pairs(GuildedPresenceDB.scopes) do if v.seen == EPOCH then return v end end end`);
  return s;
}
describe("opt-in availability and local observations", () => {
  it.each([
    'P.configure("share","off")', 'GUILD="Beta"', 'EDITION="classic-era"',
    'COMBAT=true', 'ACTIVE=false', 'P.configure("status","busy")',
    'P.configure("role","tank")', 'InCombatLockdown=nil', 'ADVANCE(5)',
  ])("discards a throttled status before retry when its context changes: %s", change => {
    const s = setup();
    s.load("Util.lua");
    s.run(`NS.util.gameEdition=function() return EDITION end; RETRY=nil; ATTEMPTS=0;
      C_Timer.After=function(_,fn) RETRY=fn end;
      C_ChatInfo={SendAddonMessage=function() ATTEMPTS=ATTEMPTS+1;return 3 end};
      P.configure("share","on")`);
    expect(s.run('return ATTEMPTS..":"..NS.comm.pending("GuildedFree")')).toBe("1:1");
    s.run(change);
    s.run('ADVANCE(1);RETRY()');
    expect(s.run('return ATTEMPTS..":"..NS.comm.pending("GuildedFree")')).toBe("1:0");
  });
  it("retries a still-current status but discards queued keys when separate consent is revoked", () => {
    const s = setup(); s.load("Util.lua");
    s.run(`NS.util.gameEdition=function() return EDITION end; EDITION="retail"; ATTEMPTS=0; THROTTLE=true;
      C_Timer.After=function(_,fn) RETRY=fn end;
      C_ChatInfo={SendAddonMessage=function(_,text) ATTEMPTS=ATTEMPTS+1;if THROTTLE then return 3 end;SENT[#SENT+1]=text;return 0 end};
      C_MythicPlus={GetOwnedKeystoneChallengeMapID=function() return 42 end,GetOwnedKeystoneLevel=function() return 12 end};
      P.configure("share","on");ADVANCE(1);THROTTLE=false;RETRY()`);
    expect(s.run('return ATTEMPTS..":"..SENT[1]')).toBe("2:1|retail|F|ANY");
    s.run('ADVANCE(5);THROTTLE=true;P.configure("keys","on");P.configure("keys","off");ADVANCE(1);THROTTLE=false;RETRY()');
    expect(s.run('return ATTEMPTS..":"..#SENT..":"..NS.comm.pending("GuildedFree")')).toBe("3:1:0");
  });
  it.each(['InCombatLockdown=nil','InCombatLockdown=function() error("hidden") end','InCombatLockdown=function() return "SECRET" end'])("does not share availability or read keys when combat state is unknown: %s", change => {
    const s=setup();s.run('EDITION="retail"; KEY_CALLS=0; C_MythicPlus={GetOwnedKeystoneLevel=function() KEY_CALLS=KEY_CALLS+1;return 12 end,GetOwnedKeystoneChallengeMapID=function() KEY_CALLS=KEY_CALLS+1;return 42 end}');s.run(change);
    s.run('P.configure("share","on");P.configure("keys","on");P.tick();P.myKey()');
    expect(s.run('return P.myStatus()..":"..#SENT..":"..KEY_CALLS')).toBe('U:0:0');
  });

  it("filters report views without changing peers or observation totals", () => {
    const s = setup();
    s.run(`EDITION = "retail"; P.configure("observe", "on"); P.receive("1|retail|F|TANK|42|12", "Arden-Realm", "GUILD"); P.receive("1|retail|B|HEALER", "Mira-Realm", "GUILD")`);
    expect(s.run(`return #P.rows({ free = true, role = "TANK", name = "arden", minKey = 10 })`)).toBe("1");
    expect(s.run(`return #P.rows({ minKey = 13 }) .. ":" .. #P.rows({ role = "HEALER", free = true }) .. ":" .. #P.rows()`)).toBe("0:0:2");
    expect(s.run(`return P.describe({ name = "%" })`)).not.toContain("Arden-Realm");
  });
  it("shows full recorded names only for the active guild and edition, without claiming live alts", () => {
    const s = setup();
    s.run(`DB = { guildKey = "Alpha-" .. GetRealmName(), myCharacters = { a = { name = "Arden", displayName = "Arden River", realm = GetRealmName(), gameEdition = "forever", capturedAt = "2026-10-25" }, b = { name = "Other", gameEdition = "retail" } } }; NS.getDb = function() return DB end`);
    expect(s.run(`return P.charactersText()`)).toContain("Arden River");
    expect(s.run(`return P.charactersText()`)).not.toContain("Other");
    expect(s.run(`GUILD = "Beta"; return P.charactersText()`)).not.toContain("Arden River");
  });
  it("defaults off and never records unsolicited guild reports", () => {
    const s = setup();
    expect(s.run(`P.tick(); return #SENT .. ":" .. tostring(P.receive("1|forever|F|TANK", "Arden River", "GUILD")) .. ":" .. #P.rows()`)).toBe("0:false:0");
    expect(s.run(`return tostring(next(SETTINGS().hours))`)).toBe("nil");
  });
  it("paces reports and status changes, auto-marks instances busy and pauses during combat", () => {
    const s = setup();
    s.run(`P.configure("share", "on"); P.tick(); P.configure("role", "tank"); INSIDE = true; ADVANCE(4); P.tick()`);
    expect(s.run(`return #SENT .. ":" .. SENT[1]`)).toBe("1:1|forever|F|ANY");
    expect(s.run(`ADVANCE(1); P.tick(); return SENT[2]`)).toBe("1|forever|B|TANK");
    expect(s.run(`COMBAT = true; ADVANCE(60); P.tick(); return #SENT`)).toBe("2");
    expect(s.run(`COMBAT = false; P.tick(); return #SENT`)).toBe("3");
  });
  it("does not claim free when instance state is unavailable or secret", () => {
    const s = setup();
    expect(s.run(`IsInInstance = nil; return P.myStatus()`)).toBe("U");
    expect(s.run(`IsInInstance = function() return "SECRET" end; return P.myStatus()`)).toBe("U");
    expect(s.run(`P.configure("status", "away"); return P.myStatus()`)).toBe("A");
  });
  it("uses actual full sender names, ignores malformed or cross-edition/non-guild packets, and expires peers", () => {
    const s = setup(); s.run(`P.configure("observe", "on")`);
    for (const [packet, channel] of [["1|retail|F|TANK", "GUILD"], ["2|forever|F|TANK", "GUILD"], ["1|forever|F|TANK|fake", "GUILD"], ["1|forever|F|TANK", "WHISPER"], ["1|forever|F|OWNER", "GUILD"]]) {
      expect(s.run(`return tostring(P.receive(${JSON.stringify(packet)}, "Arden River", ${JSON.stringify(channel)}))`)).toBe("false");
    }
    expect(s.run(`P.receive("1|forever|F|TANK", "Arden River", "GUILD"); return P.rows()[1].name`)).toBe("Arden River");
    expect(s.run(`ADVANCE(90); return #P.rows()`)).toBe("0");
  });
  it("withdraws consent without sending a final status and clears memory when both controls are off", () => {
    const s = setup();
    s.run(`P.configure("share", "on"); P.receive("1|forever|F|DPS", "Arden River", "GUILD"); P.configure("share", "off")`);
    expect(s.run(`return #P.rows() .. ":" .. #SENT`)).toBe("0:1");
    expect(s.run(`ADVANCE(5); P.tick(); return SENT[2]`)).toBe("1|forever|G|ANY");
  });
  it("keeps guild and edition consent and peers isolated", () => {
    const s = setup();
    s.run(`P.configure("share", "on"); P.receive("1|forever|F|DPS", "Arden River", "GUILD"); GUILD = "Beta"; P.tick()`);
    expect(s.run(`return #P.rows() .. ":" .. #SENT`)).toBe("0:1");
    expect(s.run(`EDITION = "retail"; P.tick(); return #SENT`)).toBe("1");
    expect(s.run(`GUILD = nil; return P.describe()`)).toContain("Join a guild");
  });
  it("preserves realm distinctions in Blizzard editions", () => {
    const s = setup();
    expect(s.run(`EDITION = "retail"; P.configure("observe", "on"); P.receive("1|retail|F|DPS", "Arden-A", "GUILD"); P.receive("1|retail|F|DPS", "Arden-B", "GUILD"); return #P.rows()`)).toBe("2");
  });
  it("shares owned keys only with separate Retail consent and clears the key when consent is withdrawn", () => {
    const s = setup();
    s.run(`EDITION = "retail"; C_MythicPlus = { GetOwnedKeystoneChallengeMapID = function() return 123 end, GetOwnedKeystoneLevel = function() return 12 end }; P.configure("share", "on")`);
    expect(s.run(`return SENT[1]`)).toBe("1|retail|F|ANY");
    expect(s.run(`ADVANCE(5); P.configure("keys", "on"); return SENT[2]`)).toBe("1|retail|F|ANY|123|12");
    expect(s.run(`return tostring(P.receive("1|retail|F|HEALER|123|12", "Arden-Realm", "GUILD")) .. ":" .. P.rows()[1].keyLevel`)).toBe("true:12");
    expect(s.run(`ADVANCE(5); P.configure("keys", "off"); return SENT[3]`)).toBe("1|retail|F|ANY");
    expect(s.run(`P.receive("1|retail|F|HEALER", "Arden-Realm", "GUILD"); return tostring(P.rows()[1].keyLevel)`)).toBe("nil");
  });
  it("never reads Mythic Plus APIs on Classic/Forever or guesses missing, hidden or invalid key values", () => {
    const s = setup();
    expect(s.run(`C_MythicPlus = { GetOwnedKeystoneLevel = function() error("must not read") end }; P.configure("share", "on"); return tostring(P.configure("keys", "on")) .. ":" .. tostring(P.myKey())`)).toBe("false:nil");
    expect(s.run(`return tostring(P.receive("1|forever|F|DPS|123|12", "Arden River", "GUILD"))`)).toBe("false");
    expect(s.run(`EDITION = "retail"; P.configure("share", "on"); P.configure("keys", "on"); C_MythicPlus.GetOwnedKeystoneChallengeMapID = function() return "SECRET" end; return tostring(P.myKey())`)).toBe("nil");
    expect(s.run(`C_MythicPlus.GetOwnedKeystoneChallengeMapID = function() return 123 end; C_MythicPlus.GetOwnedKeystoneLevel = function() return 0 / 0 end; return tostring(P.myKey())`)).toBe("nil");
    expect(s.run(`return tostring(P.receive("1|retail|F|DPS|0|12", "Arden-Realm", "GUILD"))`)).toBe("false");
  });
  it("keeps sample pacing across module reloads", () => {
    const s = setup(); s.run(`P.configure("observe", "on")`);
    s.load("Modules/Presence.lua");
    expect(s.run(`NS.presence.tick(); local n = 0; for _, v in pairs(SETTINGS().hours) do n = n + v.samples end; return n`)).toBe("1");
  });
  it("counts only observed fresh reports, never fills offline gaps or persists individual names", () => {
    const s = setup();
    s.run(`P.configure("observe", "on"); ADVANCE(300); P.receive("1|forever|F|DPS", "Arden River", "GUILD"); P.tick()`);
    expect(s.run(`local b; for _, v in pairs(SETTINGS().hours) do b = v end; return b.samples .. ":" .. b.total .. ":" .. b.free`)).toBe("2:1:1");
    expect(s.run(`local n = 0; for _ in pairs(P.heatmap()) do n = n + 1 end; return n`)).toBe("1");
    expect(s.run(`return P.activityText()`)).not.toContain("Arden");
    expect(s.run(`ADVANCE(7200); P.tick(); local n = 0; for _ in pairs(SETTINGS().hours) do n = n + 1 end; return n`)).toBe("2");
    expect(s.run(`P.configure("clear"); return tostring(next(SETTINGS().hours))`)).toBe("nil");
  });
  it("prunes history after 28 days, and bounds guild contexts", () => {
    const s = setup();
    expect(s.run(`P.configure("observe", "on"); ADVANCE(29 * 86400); P.tick(); return tostring(next(SETTINGS().hours))`)).toBe("nil");
    expect(s.run(`for i = 1, 15 do GUILD = "Guild" .. i; P.tick(); ADVANCE(1) end; local n = 0; for _ in pairs(GuildedPresenceDB.scopes) do n = n + 1 end; return n`)).toBe("10");
  });
  it("ceases recording and reporting while the module is disabled", () => {
    const s = setup();
    expect(s.run(`P.configure("share", "on"); ACTIVE = false; ADVANCE(300); P.tick(); return #SENT .. ":" .. #P.rows()`)).toBe("1:0");
  });
  it("keeps privacy storage separate from the account database and backup/export paths", () => {
    expect(addonSource("Guilded.toc")).toContain("## SavedVariablesPerCharacter: GuildedPresenceDB");
    expect(addonSource("Modules/Presence.lua")).not.toMatch(/ns\.getSettings|GuildedDB\b/);
    const s = setup();
    s.run(`DB = {}; NS.getDb = function() return DB end; P.configure("share", "on"); P.configure("observe", "on"); P.receive("1|forever|F|DPS", "Arden River", "GUILD"); ADVANCE(300); P.tick(); P.charactersText()`);
    expect(s.run(`return tostring(next(DB))`)).toBe("nil");
  });
});
