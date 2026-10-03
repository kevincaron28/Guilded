import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

// The audit fixes: paced sending, who may bid or answer, forged or future-dated shared data,
// guild membership in the roster, dungeon run trust, sessions that survive /reload, and the
// backup undo copy. Real Core.lua (and the module under test) against the mocked game.
let session: LuaSession | undefined;
afterEach(() => { session?.close(); session = undefined; });

// Kev is logged in (an officer: rank 1). `setup` runs before the files load.
function loggedIn(files: string[], setup = ""): LuaSession {
  session = newLuaSession();
  session.run(String.raw`
    GuildedDB = nil; NS = {}
    MOCK_UNITS = { player = { name = "Kev", buffs = {} } }
    SENT = {}
    C_ChatInfo = {
      RegisterAddonMessagePrefix = function() return true end,
      SendAddonMessage = function(prefix, text, channel, target) SENT[#SENT + 1] = { prefix = prefix, text = text, channel = channel, target = target } end,
      SendChatMessage = function() end
    }
    ${setup}
  `);
  session.load("Core.lua");
  session.load("Compat.lua");
  for (const file of files) session.load(file);
  session.run(`fire_event("PLAYER_LOGIN")`);
  return session;
}

// Kev in a raid with Ann (Ann-Realm on the wire); "Stranger" is not in the group.
const RAID = String.raw`
  MOCK_RAID = true
  MOCK_GROUP_SIZE = 2
  MOCK_UNITS.raid1 = { name = "Kev" }
  MOCK_UNITS.raid2 = { name = "Ann" }
  function GetRaidRosterInfo(i) local u = MOCK_UNITS["raid" .. i]; return u and u.name end
`;

const slash = (s: LuaSession, line: string) => s.run(`SlashCmdList["GUILDED"](${JSON.stringify(line)})`);
const sentCount = (s: LuaSession) => Number(s.run("return #SENT"));

describe("Util.lua helpers", () => {
  it("cuts text without splitting a UTF-8 character", () => {
    const s = loggedIn([]);
    // "ab" + e-acute (two bytes): a 3-byte limit keeps "ab", not half of the accent.
    expect(s.run(`return NS.util.truncate("ab\\195\\169", 3)`)).toBe("ab");
    expect(s.run(`return tostring(#NS.util.truncate("ab\\195\\169", 4))`)).toBe("4");
    expect(s.run(`return NS.util.truncate("hello", 10)`)).toBe("hello");
  });

  it("refuses dates more than 10 minutes ahead of the server clock", () => {
    const s = loggedIn([]);
    expect(s.run("return tostring(NS.util.tooFarAhead(1800000000 + 599))")).toBe("false");
    expect(s.run("return tostring(NS.util.tooFarAhead(1800000000 + 601))")).toBe("true");
    expect(s.run(`return tostring(NS.util.tooFarAhead("2099-01-01T00:00:00Z"))`)).toBe("true");
    expect(s.run(`return tostring(NS.util.tooFarAhead("2026-01-01T00:00:00Z"))`)).toBe("false");
  });

  it("round-trips base64 and keeps the bot's item key rule", () => {
    const s = loggedIn([]);
    expect(s.run(`return NS.util.base64Decode(NS.util.base64Encode("Guilded|a;b"))`)).toBe("Guilded|a;b");
    expect(s.run(`return NS.util.itemKey("  Band of; Accuria ")`)).toBe("band of accuria");
  });
});

describe("paced addon messages (ns.comm)", () => {
  it("sends a burst at once, queues the rest, and keeps the order", () => {
    const s = loggedIn([]);
    s.run(`SENT = {}; for i = 1, 12 do NS.comm.send("QTest", "m" .. i, "GUILD") end`);
    expect(sentCount(s)).toBe(8);
    expect(s.run(`return tostring(NS.comm.pending("QTest"))`)).toBe("4");
    // Time passes: the queue drains first, then the new message, in order.
    s.run(`GetTime = function() return 30 end; NS.comm.send("QTest", "m13", "GUILD")`);
    expect(sentCount(s)).toBe(13);
    expect(s.run("return SENT[9].text .. ',' .. SENT[13].text")).toBe("m9,m13");
  });

  it("retries a message the game says was throttled", () => {
    const s = loggedIn([]);
    s.run(String.raw`
      SENT = {}
      local refuse = true
      C_ChatInfo.SendAddonMessage = function(prefix, text)
        if refuse then refuse = false; return 3 end
        SENT[#SENT + 1] = { text = text }
        return 0
      end
      NS.comm.send("QThrottle", "first", "GUILD")
    `);
    expect(sentCount(s)).toBe(0);
    expect(s.run(`return tostring(NS.comm.pending("QThrottle"))`)).toBe("1");
    s.run(`GetTime = function() return 30 end; NS.comm.send("QThrottle", "second", "GUILD")`);
    expect(s.run("return SENT[1].text .. ',' .. SENT[2].text")).toBe("first,second");
  });

  it("cuts an over-long message and notes it quietly in the diagnostics", () => {
    const s = loggedIn([]);
    s.run(`SENT = {}; NS.comm.send("QLong", string.rep("x", 300), "GUILD")`);
    expect(s.run("return tostring(#SENT[1].text)")).toBe("255");
    expect(s.run("local d = GuildedDB.diagnostics; return d[#d].kind")).toBe("SEND");
    expect(s.chat().join("\n")).not.toContain("[Diagnostic] SEND");
  });

  it("distinguishes client acceptance, refusal and errors without retaining payloads", () => {
    const s = loggedIn([]);
    s.run(`
      C_ChatInfo.SendAddonMessage = function() return 0 end
      NS.comm.send("QStatus", "private contents", "GUILD")
      C_ChatInfo.SendAddonMessage = function() return 2 end
      NS.comm.send("QStatus", "private contents", "GUILD")
      C_ChatInfo.SendAddonMessage = function() error("client failure") end
      NS.comm.send("QStatus", "private contents", "GUILD")
    `);
    expect(s.run(`local d = NS.comm.status("QStatus"); return d.sent..":"..d.refused..":"..d.errors..":"..d.queued..":"..d.lastResult`)).toBe("1:1:1:0:error");
    s.run(`local d = NS.comm.status("QStatus"); d.sent = 999`);
    expect(s.run(`return tostring(NS.comm.status("QStatus").sent)`)).toBe("1");
    expect(s.run(`return tostring(NS.comm.status("Unused").sent)`)).toBe("0");
    s.run(`C_ChatInfo.SendAddonMessage = function() return 8 end; NS.comm.send("QStatus", "private contents", "GUILD")`);
    expect(s.run(`local d = NS.comm.status("QStatus"); return d.throttled..":"..d.queued..":"..d.lastCode`)).toBe("1:1:8");
    expect(s.run(`local out={}; for k,v in pairs(NS.comm.status("QStatus")) do out[#out+1]=tostring(v) end; return table.concat(out,",")`)).not.toContain("private contents");
    expect(s.run(`return tostring(NS.comm.status("Guilded").refused)`)).toBe("0");
  });
});

describe("whispered bids and answers only count from the group", () => {
  it("GP bidding ignores a number whispered by someone outside the raid", () => {
    const s = loggedIn(["Locale.lua", "Modules/Bidding.lua"], RAID);
    slash(s, "bid start 10 Sword");
    s.run(`fire_event("CHAT_MSG_WHISPER", "25", "Stranger")`);
    s.run(`fire_event("CHAT_MSG_ADDON", "GuildedBid", "BID|" .. NS.bidding.current.id .. "|40", "WHISPER", "Stranger")`);
    expect(s.run("return tostring(next(NS.bidding.current.bids))")).toBe("nil");
    s.run(`fire_event("CHAT_MSG_WHISPER", "30", "Ann-Realm")`);
    expect(s.run("return tostring(NS.bidding.current.bids.Ann.amount)")).toBe("30");
  });

  it("EPGP priority ignores 'yes' from outside the raid, so nobody is charged for small talk", () => {
    const s = loggedIn(["Locale.lua", "Modules/Council.lua"], RAID);
    slash(s, "council priority 30 Sword");
    s.run(`fire_event("CHAT_MSG_WHISPER", "yes", "Stranger")`);
    expect(s.run("return tostring(next(NS.council.current.responses))")).toBe("nil");
    s.run(`fire_event("CHAT_MSG_WHISPER", "+", "Ann-Realm")`);
    expect(s.run("return NS.council.current.responses.Ann.tier")).toBe("want");
  });
});

describe("open bidding and council survive a /reload", () => {
  it("saves the auction on the server clock and picks it up again", () => {
    const s = loggedIn(["Locale.lua", "Modules/Bidding.lua"], RAID);
    slash(s, "bid start 10 Sword 60");
    s.run(`fire_event("CHAT_MSG_WHISPER", "30", "Ann-Realm")`);
    expect(s.run("return tostring(GuildedDB.biddingSession.endsAtServer)")).toBe(String(1800000000 + 60));
    // A reload forgets everything in memory; the saved session brings it back.
    s.run("NS.bidding.current = nil; NS.bidding.restore()");
    expect(s.run("return NS.bidding.current.item .. '|' .. tostring(NS.bidding.current.open) .. '|' .. NS.bidding.current.bids.Ann.amount")).toBe("Sword|true|30");
    expect(s.chat().join("\n")).toContain("Bidding on Sword was restored after the reload (60s left).");
    slash(s, "bid cancel");
    expect(s.run("return tostring(GuildedDB.biddingSession)")).toBe("nil");
  });

  it("drops a session that ran out long ago instead of awarding it by itself", () => {
    const s = loggedIn(["Locale.lua", "Modules/Council.lua"], RAID);
    slash(s, "council priority 30 Sword 60");
    s.run(`fire_event("CHAT_MSG_WHISPER", "want", "Ann-Realm")`);
    // Back three days later.
    s.run("NS.council.current = nil; GetServerTime = function() return 1800000000 + 3 * 86400 end; NS.council.restore()");
    expect(s.run("return tostring(NS.council.current) .. ',' .. tostring(GuildedDB.councilSession)")).toBe("nil,nil");
    expect(s.chat().join("\n")).toContain("ran out while you were away and was dropped");
  });

  it("does the same for a loot council session", () => {
    const s = loggedIn(["Locale.lua", "Modules/Council.lua"], RAID);
    slash(s, "council start Sword 60");
    s.run(`fire_event("CHAT_MSG_WHISPER", "bis", "Ann-Realm")`);
    s.run("NS.council.current = nil; NS.council.restore()");
    expect(s.run("return NS.council.current.item .. '|' .. NS.council.current.responses.Ann.tier")).toBe("Sword|bis");
  });
});

describe("shared data dated in the future is refused", () => {
  function withSync(): LuaSession {
    return loggedIn(["Modules/Sync.lua"], `GetAddOnMetadata = function() return "4.0.0" end`);
  }

  it("standings from an officer with a far-future date are ignored", () => {
    const s = withSync();
    s.run(`GuildedDB.settings.officers.Boss = true; fire_event("PLAYER_ENTERING_WORLD")`);
    s.run(`fire_event("CHAT_MSG_ADDON", "GuildedSync", "STAND|2099-01-01T00:00:00Z|0|1|1|Amy:10:5", "GUILD", "Boss")`);
    expect(s.run("return tostring(GuildedDB.standings)")).toBe("nil");
    s.run(`fire_event("CHAT_MSG_ADDON", "GuildedSync", "STAND|2026-12-01T00:00:00Z|0|1|1|Amy:10:5", "GUILD", "Boss")`);
    expect(s.run("return tostring(GuildedDB.standings.players.Amy.ep)")).toBe("10");
  });

  it("guild module switches dated in the future are ignored", () => {
    const s = loggedIn([]);
    expect(s.run(`return tostring(NS.applyGuildModules({ games = true }, 1800000000 + 86400, "Boss"))`)).toBe("false");
    expect(s.run(`return tostring(NS.applyGuildModules({ games = true }, 1800000000 - 60, "Boss"))`)).toBe("true");
  });
});

describe("guild roster: members, pugs and people who left", () => {
  it("keeps raid pugs out of the guild member list and marks leavers", () => {
    const s = loggedIn(["Modules/API.lua"], RAID + String.raw`
      MOCK_UNITS.raid3 = { name = "Pug" }
      MOCK_GROUP_SIZE = 3
    `);
    s.run(`GuildedDB.roster.Old = { firstSeen = "2026-01-01T00:00:00Z" }`);
    slash(s, "start Test");
    expect(s.run("return tostring(NS.isGuildMember('Pug'))")).toBe("false");
    s.run(String.raw`
      GUILD = { "Kev-Realm", "Ann-Realm" }
      GetNumGuildMembers = function() return #GUILD end
      GetGuildRosterInfo = function(i) return GUILD[i], "Rank", 3 end
      fire_event("GUILD_ROSTER_UPDATE")
    `);
    expect(s.run("return table.concat(GuildedAPI.GetRosterNames(), ',')")).toBe("Ann,Kev");
    expect(s.run("return tostring(GuildedDB.roster.Old.inGuild) .. ',' .. tostring(GuildedDB.roster.Old.leftAt ~= nil)")).toBe("false,true");
    // The pug is still remembered for attendance, just not as a member.
    expect(s.run("return tostring(GuildedDB.roster.Pug ~= nil)")).toBe("true");
  });

  it("does not conclude anyone left when the roster hides offline members", () => {
    const s = loggedIn([]);
    s.run(String.raw`
      GuildedDB.roster.Offline = { firstSeen = "x" }
      GetGuildRosterShowOffline = function() return false end
      GetNumGuildMembers = function() return 1 end
      GetGuildRosterInfo = function() return "Kev", "Rank", 3 end
      fire_event("GUILD_ROSTER_UPDATE")
    `);
    expect(s.run("return tostring(GuildedDB.roster.Offline.inGuild)")).toBe("nil");
  });

  it("takes gear digests over raid chat only from guild members", () => {
    const s = loggedIn([], RAID);
    s.run(`GuildedDB.roster.Ann = { inGuild = true }; GuildedDB.roster.Pug = { inGuild = false }`);
    s.run(`fire_event("CHAT_MSG_ADDON", "Guilded", "READINESS|Pug|READY|0|100|", "RAID", "Pug")`);
    s.run(`fire_event("CHAT_MSG_ADDON", "Guilded", "READINESS|Ann|READY|0|100|", "RAID", "Ann")`);
    s.run(`fire_event("CHAT_MSG_ADDON", "Guilded", "READINESS|Newbie|READY|0|100|", "GUILD", "Newbie")`);
    expect(s.run("return tostring(GuildedDB.peerRoster.Pug) .. ',' .. GuildedDB.peerRoster.Ann.status .. ',' .. GuildedDB.peerRoster.Newbie.status")).toBe("nil,READY,READY");
  });

  it("does not journal other players' informational messages", () => {
    const s = loggedIn([]);
    const before = s.run("return tostring(#GuildedDB.events)");
    s.run(`for i = 1, 5 do fire_event("CHAT_MSG_ADDON", "Guilded", "EPGP|Bob|10|0|x", "RAID", "Ann") end`);
    expect(s.run("return tostring(#GuildedDB.events)")).toBe(before);
    slash(s, "diag");
    expect(s.chat().join("\n")).toContain("5 addon message(s) from other players were ignored");
  });
});

describe("dungeon runs are only believed from people who were in them", () => {
  function withRun(): LuaSession {
    const s = loggedIn(["Modules/Dungeon.lua"]);
    s.run(String.raw`
      GuildedDB.dungeon = { runs = {}, current = {
        id = "QG-R1", state = "ACTIVE", recorder = "Bob", instanceId = 36, name = "The Deadmines",
        detectedAt = 1800000000 - 1800, startedAt = 1800000000 - 1700, encounters = {}, reporters = { Kev = true },
        players = { Kev = { presentSec = 0 }, Bob = { presentSec = 0 } }
      } }
    `);
    return s;
  }
  const end = (s: LuaSession, from: string, endedAt: number) =>
    s.run(`fire_event("CHAT_MSG_ADDON", "GuildedDgn", "END|QG-R1|COMPLETED|${endedAt}|final boss", "PARTY", ${JSON.stringify(from)})`);

  it("ignores an END from someone who is neither the recorder nor the leader", () => {
    const s = withRun();
    end(s, "Ann", 1800000000 - 10);
    expect(s.run("return GuildedDB.dungeon.current.state")).toBe("ACTIVE");
  });

  it("ignores an END time in the future or before the start, even from the recorder", () => {
    const s = withRun();
    end(s, "Bob", 1800000000 + 3600);
    end(s, "Bob", 1800000000 - 5000);
    expect(s.run("return GuildedDB.dungeon.current.state")).toBe("ACTIVE");
    end(s, "Bob", 1800000000 - 10);
    expect(s.run("return GuildedDB.dungeon.runs['QG-R1'].state")).toBe("COMPLETED");
  });

  it("keeps a guild-shared run summary only from someone listed in it", () => {
    const s = withRun();
    s.run(String.raw`
      local run = { id = "QG-X", state = "COMPLETED", instanceId = 36, name = "The Deadmines", startedAt = 1800000000 - 1800,
        endedAt = 1800000000 - 60, recorder = "Zed", encounters = {}, players = { Zed = { presentSec = 1700, deaths = 0 } } }
      SUMMARY = NS.dungeon.serialize(run)
      fire_event("CHAT_MSG_ADDON", "GuildedDgn", "SUM|QG-X|1|1|" .. SUMMARY, "GUILD", "Faker")
    `);
    expect(s.run("return tostring(GuildedDB.dungeon.runs['QG-X'])")).toBe("nil");
    s.run(`fire_event("CHAT_MSG_ADDON", "GuildedDgn", "SUM|QG-X|1|1|" .. SUMMARY, "GUILD", "Zed")`);
    expect(s.run("return GuildedDB.dungeon.runs['QG-X'].state")).toBe("COMPLETED");
  });
});

describe("backup undo copy", () => {
  it("is dropped after 7 days, or at once with /guilded restore forget", () => {
    const s = loggedIn(["Modules/Backup.lua"]);
    // 1800000000 is 2027-01-15T08:00:00Z.
    s.run(`GuildedDB.preRestore = { at = "2027-01-14T08:00:00Z", data = {} }`);
    expect(s.run("return tostring(NS.backup.expireUndo())")).toBe("false");
    s.run(`GuildedDB.preRestore = { at = "2027-01-01T08:00:00Z", data = {} }`);
    expect(s.run("return tostring(NS.backup.expireUndo()) .. ',' .. tostring(GuildedDB.preRestore)")).toBe("true,nil");
    s.run(`GuildedDB.preRestore = { at = "2027-01-14T08:00:00Z", data = {} }`);
    slash(s, "restore forget");
    expect(s.run("return tostring(GuildedDB.preRestore)")).toBe("nil");
  });

  it("leaves data that rebuilds itself out of the code", () => {
    const s = loggedIn(["Modules/Backup.lua"]);
    s.run(`GuildedDB.recipeBook = { people = { Bob = {} } }; GuildedDB.epgp.Bob = { ep = 5, gp = 0, ledger = {} }`);
    const code = s.run("return NS.backup.build()");
    const payload = s.run(`return NS.backup.b64decode((${JSON.stringify(code)}):match("^QGBKP1:%x+:(.+)$"))`);
    expect(payload).toContain('"epgp"');
    expect(payload).not.toContain('"recipeBook"');
  });
});
