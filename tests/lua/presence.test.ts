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
  // (9.1.7) Availability is low-value traffic: it waits for budget headroom (4 tokens), and its guard is
  // re-checked at every attempt, so a status whose context changed while it waited is discarded, unsent.
  const WAITING = `GuildedCommBudget = { tokens = 0, at = CLOCK, rate = 4, strikes = 0, throttles = 0, refusals = 0, lastStrike = -1000, backoffUntil = 0 }
    NS.util.gameEdition=function() return EDITION end; RETRY=nil; ATTEMPTS=0; SENT={};
    C_Timer.After=function(_,fn) RETRY=fn end;
    C_ChatInfo={SendAddonMessage=function(_,text) ATTEMPTS=ATTEMPTS+1;SENT[#SENT+1]=text;return 0 end};
    P.configure("share","on")`;
  it.each([
    'P.configure("share","off")', 'GUILD="Beta"', 'EDITION="unknown"',
    'ACTIVE=false', 'P.configure("status","busy")',
    'P.configure("role","tank")', 'InCombatLockdown=nil', 'ADVANCE(5)',
  ])("discards a status that is waiting for budget when its context changes: %s", change => {
    const s = setup();
    s.load("Util.lua");
    s.run(WAITING);
    // Nothing is sent yet: the budget is empty and the status waits in the queue.
    expect(s.run('return ATTEMPTS..":"..NS.comm.pending("GuildedFree")')).toBe("0:1");
    s.run(change);
    s.run('ADVANCE(3);if RETRY then RETRY() end');
    expect(s.run('return ATTEMPTS..":"..NS.comm.pending("GuildedFree")')).toBe("0:0");
    expect(s.run("return #SENT")).toBe("0");
  });
  it("holds a waiting status in combat and sends it afterwards while it is still current", () => {
    const s = setup();
    s.load("Util.lua");
    s.run(WAITING);
    s.run('COMBAT=true; ADVANCE(1); if RETRY then RETRY() end');
    expect(s.run('return #SENT..":"..NS.comm.pending("GuildedFree")')).toBe("0:1");
    s.run('COMBAT=false; for i=1,3 do ADVANCE(1); if RETRY then RETRY() end end');
    expect(s.run('return #SENT..":"..NS.comm.pending("GuildedFree")')).toBe("1:0");
  });
  it("sends a still-current waiting status with its payload once the budget has headroom", () => {
    const s = setup();
    s.load("Util.lua");
    s.run(WAITING);
    s.run('ADVANCE(1);if RETRY then RETRY() end');
    expect(s.run('return ATTEMPTS..":"..SENT[1]')).toBe("1:1|forever|F|ANY");
  });
  it("drops a throttled status instead of retrying it", () => {
    const s = setup();
    s.load("Util.lua");
    s.run(`GuildedCommBudget = nil; NS.util.gameEdition=function() return EDITION end; ATTEMPTS=0;
      C_Timer.After=function(_,fn) end;
      C_ChatInfo={SendAddonMessage=function() ATTEMPTS=ATTEMPTS+1;return 3 end};
      P.configure("share","on")`);
    expect(s.run('return ATTEMPTS..":"..NS.comm.pending("GuildedFree")')).toBe("1:0");
    expect(Number(s.run("return NS.comm.budget().throttles"))).toBeGreaterThanOrEqual(1);
  });
  it("sends a fresh status once the back-off is over", () => {
    const s = setup(); s.load("Util.lua");
    s.run(`GuildedCommBudget = nil; NS.util.gameEdition=function() return EDITION end; ATTEMPTS=0; THROTTLE=true;
      C_Timer.After=function(_,fn) end;
      C_ChatInfo={SendAddonMessage=function(_,text) ATTEMPTS=ATTEMPTS+1;if THROTTLE then return 3 end;SENT[#SENT+1]=text;return 0 end};
      P.configure("share","on");ADVANCE(100);THROTTLE=false;NS.comm.send("GuildedFree","F|x","GUILD");ADVANCE(3);NS.comm.send("GuildedFree","F|y","GUILD")`);
    // After the back-off the restart is gentle (low-value waits for headroom), then a fresh status goes out.
    // Exactly the two statuses, in the order they were queued, each with its own payload.
    expect(s.run('return #SENT .. ":" .. table.concat(SENT, ",")')).toBe("2:F|x,F|y");
  });
  it.each(['InCombatLockdown=nil','InCombatLockdown=function() error("hidden") end','InCombatLockdown=function() return "SECRET" end'])("does not share availability when combat state is unknown: %s", change => {
    const s=setup();s.run(change);
    s.run('P.configure("share","on");P.tick()');
    expect(s.run('return P.myStatus()..":"..#SENT')).toBe('U:0');
  });

  it("filters report views without changing peers or observation totals", () => {
    const s = setup();
    s.run(`P.configure("observe", "on"); P.receive("1|forever|F|TANK", "Arden River", "GUILD"); P.receive("1|forever|B|HEALER", "Mira Stone", "GUILD")`);
    expect(s.run(`return #P.rows({ free = true, role = "TANK", name = "arden" })`)).toBe("1");
    expect(s.run(`return #P.rows({ role = "HEALER", free = true }) .. ":" .. #P.rows()`)).toBe("0:2");
    expect(s.run(`return P.describe({ name = "%" })`)).not.toContain("Arden River");
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
    expect(s.run(`EDITION = "unknown"; P.tick(); return #SENT`)).toBe("1");
    expect(s.run(`GUILD = nil; return P.describe()`)).toContain("Join a guild");
  });
  it("has no Mythic+ key sharing: never reads key APIs and refuses old Retail key packets", () => {
    const s = setup();
    expect(s.run(`C_MythicPlus = { GetOwnedKeystoneLevel = function() error("must not read") end, GetOwnedKeystoneChallengeMapID = function() error("must not read") end }; P.configure("share", "on"); return tostring(P.configure("keys", "on")) .. ":" .. SENT[1]`)).toBe("false:1|forever|F|ANY");
    s.run(`P.configure("observe", "on")`);
    expect(s.run(`return tostring(P.receive("1|forever|F|DPS|123|12", "Arden River", "GUILD"))`)).toBe("false");
    expect(s.run(`return tostring(P.receive("1|retail|F|DPS", "Arden River", "GUILD"))`)).toBe("false");
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
