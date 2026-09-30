import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

// Loads the real Core.lua (plus Compat and the consumable module) against a mocked game.
let session: LuaSession | undefined;
afterEach(() => { session?.close(); session = undefined; });

function loggedIn(): LuaSession {
  session = newLuaSession();
  session.run(`
    GuildedDB = nil
    SLASH = SlashCmdList
    NS = {}
    MOCK_UNITS = { player = { name = "Kev", buffs = { "Flask of the Titans", "Well Fed" } } }
  `);
  session.load("Core.lua");
  session.load("Compat.lua");
  session.load("Modules/Consumables.lua");
  session.run(`fire_event("PLAYER_LOGIN")`);
  return session;
}

describe("Core.lua (real file, mocked game)", () => {
  it("loads, logs in, and registers /guilded", () => {
    const s = loggedIn();
    expect(s.run(`return tostring(SlashCmdList["GUILDED"] ~= nil)`)).toBe("true");
    expect(s.chat().join("\n")).toContain("Loaded.");
  });

  it("registers /guilded and the short /gd alias, and no old /qg", () => {
    const s = loggedIn();
    expect(s.run(`return SLASH_GUILDED1 .. " " .. SLASH_GUILDED2 .. " " .. tostring(SLASH_QUEBECGOLD1)`)).toBe("/guilded /gd nil");
  });

  it("adopts data saved under the old name once", () => {
    session = newLuaSession();
    session.run(`GuildedDB = nil; QuebecGoldDB = { legacyMarker = 42 }; SLASH = SlashCmdList; NS = {}`);
    session.load("Core.lua");
    session.run(`fire_event("PLAYER_LOGIN")`);
    expect(session.run(`return tostring(GuildedDB.legacyMarker) .. "|" .. tostring(QuebecGoldDB)`)).toBe("42|nil");
  });

  it("/guilded character prints the QG1 line with class and race tokens", () => {
    const s = loggedIn();
    s.run(`SlashCmdList["GUILDED"]("character")`);
    expect(s.chat().join("\n")).toContain("QG2;Kev;TestRealm;WARRIOR;NightElf;60;");
  });
});

describe("player identity (Forever has no real realms)", () => {
  it("reads name and realm from the client, and /guilded diag shows the raw values", () => {
    const s = loggedIn();
    expect(s.run(`local id = NS.compat.identity(); return id.name .. "|" .. id.realm .. "|" .. tostring(id.hasRealm)`)).toBe("Kev|TestRealm|true");
    s.run(`SlashCmdList["GUILDED"]("diag")`);
    expect(s.chat().join("\n")).toContain("Identity: name=Kev realm=TestRealm");
  });

  it("copes with a client that reports no realm at all", () => {
    const s = loggedIn();
    s.run(`GetRealmName = function() return "" end; GetNormalizedRealmName = nil`);
    expect(s.run(`local id = NS.compat.identity(); return tostring(id.hasRealm) .. "|" .. id.realm`)).toBe("false|");
    s.run(`SlashCmdList["GUILDED"]("character")`);
    expect(s.chat().join("\n")).toContain("QG2;Kev;;WARRIOR");
  });
});

describe("gear check: enchants, consumables and the peer digest", () => {
  // Item links carry the enchant id as their second field.
  const withGear = (s: LuaSession) => s.run(`
    LINKS = {
      [1] = "|cff|Hitem:100:0:0|h[Helm]|h|r", [3] = "|cff|Hitem:101:0:0|h[Spaulders]|h|r",
      [5] = "|cff|Hitem:102:1891:0|h[Chestguard]|h|r", [6] = "|cff|Hitem:103:0:0|h[Belt]|h|r",
      [7] = "|cff|Hitem:104:0:0|h[Legplates]|h|r", [8] = "|cff|Hitem:105:929:0|h[Boots]|h|r",
      [9] = "|cff|Hitem:106:0:0|h[Bracers]|h|r", [10] = "|cff|Hitem:107:0:0|h[Gloves]|h|r",
      [16] = "|cff|Hitem:108:0:0|h[Sword]|h|r", [17] = "|cff|Hitem:109:0:0|h[Shield]|h|r"
    }
    GetInventoryItemLink = function(_, slot) return LINKS[slot] end
    GetInventoryItemID = function(_, slot) return LINKS[slot] and tonumber(string.match(LINKS[slot], "item:(%d+)")) end
    GetInventoryItemDurability = function() return 90, 100 end
  `);

  it("finds equipped slots without an enchant and reports them", () => {
    const s = loggedIn();
    withGear(s);
    s.run(`SlashCmdList["GUILDED"]("inspect")`);
    const findings = s.run(`local f = {}; for _, x in ipairs(GuildedDB.readiness["Kev"].findings) do f[#f + 1] = x.code .. "=" .. x.message end; return table.concat(f, ";")`);
    // Chest and Feet have enchant ids; Legs, Wrist, Hands and MainHand do not.
    expect(findings).toContain("MISSING_ENCHANTS=Missing enchants: Legs, Wrist, Hands, MainHand.");
    expect(s.run(`return GuildedDB.readiness["Kev"].status`)).toBe("PARTIAL");
    expect(s.run(`return GuildedDB.readiness["Kev"].items[3].enchants[1].enchantId`)).toBe("1891");
  });

  it("does not check enchants below the starting level, or when switched off", () => {
    const s = loggedIn();
    withGear(s);
    s.run(`UnitLevel = function() return 30 end; SlashCmdList["GUILDED"]("inspect")`);
    expect(s.run(`return GuildedDB.readiness["Kev"].status`)).toBe("READY");
    s.run(`UnitLevel = function() return 60 end; SlashCmdList["GUILDED"]("enchants off"); SlashCmdList["GUILDED"]("inspect")`);
    expect(s.run(`return GuildedDB.readiness["Kev"].status`)).toBe("READY");
  });

  it("in a raid group with no flask or food it warns, and the digest carries reason flags", () => {
    const s = loggedIn();
    withGear(s);
    s.run(`MOCK_RAID = true; MOCK_UNITS = { player = { name = "Kev", buffs = { "Blessing of Kings" } } }; SENT = {}; SlashCmdList["GUILDED"]("inspect")`);
    const codes = s.run(`local f = {}; for _, x in ipairs(GuildedDB.readiness["Kev"].findings) do f[#f + 1] = x.code end; return table.concat(f, ",")`);
    expect(codes).toContain("NO_FLASK");
    expect(codes).toContain("NO_FOOD");
    const digest = s.run(`return SENT[#SENT].text`);
    expect(digest).toMatch(/^READINESS\|Kev\|PARTIAL\|0\|90\|/);
    expect(digest).toContain("|F:NOFLASK,NOFOOD,ENCH:Legs+Wrist+Hands+MainHand");
  });

  it("reads a peer digest whose profession field is empty (flags must not shift)", () => {
    const s = loggedIn();
    s.run(`fire_event("CHAT_MSG_ADDON", "Guilded", "READINESS|Amy|PARTIAL|0|95||F:NOFOOD", "GUILD", "Amy-Realm")`);
    expect(s.run(`return GuildedDB.peerRoster["Amy"].flags .. "|" .. GuildedDB.peerRoster["Amy"].professions`)).toBe("NOFOOD|");
    s.run(`fire_event("CHAT_MSG_ADDON", "Guilded", "READINESS|Bob|READY|0|100|Mining:300|F:NOFLASK", "GUILD", "Bob-Realm")`);
    expect(s.run(`return GuildedDB.peerRoster["Bob"].flags .. "|" .. GuildedDB.peerRoster["Bob"].professions`)).toBe("NOFLASK|Mining:300");
  });
});

describe("attendance snapshot", () => {
  it("records who is in the group with a label and keeps only the last 50", () => {
    const s = loggedIn();
    s.run(`
      MOCK_UNITS.party1 = { name = "Amy" }; MOCK_UNITS.party2 = { name = "Bob" }
      function IsInGroup() return true end
      NS.isOfficerName = function() return true end
      GuildedDB.settings.officers = { Tester = true, Kev = true }
      SlashCmdList["GUILDED"]("snapshot pre pull")
    `);
    expect(s.chat().join("\n")).toMatch(/Snapshot 'pre pull': 3 player\(s\)/);
    expect(s.run(`return GuildedDB.snapshots[1].label .. "|" .. table.concat(GuildedDB.snapshots[1].names, ",")`)).toBe("pre pull|Kev,Amy,Bob");
    s.run(`for i = 1, 60 do SlashCmdList["GUILDED"]("snapshot n" .. i) end`);
    expect(s.run(`return #GuildedDB.snapshots`)).toBe("50");
  });
});

describe("one saved-data set per WoW guild", () => {
  const inGuild = (s: LuaSession, name: string) => s.run(`function GetGuildInfo() return ${JSON.stringify(name)}, "Officer", 1 end`);

  it("claims existing data for the first guild it sees", () => {
    const s = loggedIn();
    inGuild(s, "Alpha");
    s.run(`GuildedDB.roster = { Bob = {} }; fire_event("GUILD_ROSTER_UPDATE")`);
    expect(s.run(`return GuildedDB.guildKey`)).toBe("Alpha-TestRealm");
    expect(s.run(`return tostring(GuildedDB.roster.Bob ~= nil)`)).toBe("true");
  });

  it("parks one guild's data and brings it back, never mixing ledgers", () => {
    session = newLuaSession();
    const t = session;
    // Saved variables from earlier play in guild Alpha.
    t.run(`
      GuildedDB = { version = 4, guildKey = "Alpha-TestRealm", epgp = { Bob = { ep = 50, gp = 0, ledger = {} } }, roster = { Bob = {} }, settings = { officers = {} }, raids = { r1 = { id = "r1", title = "MC" } } }
      NS = {}
      MOCK_UNITS = { player = { name = "Kev", buffs = {} } }
      function GetGuildInfo() return "Beta", "Member", 3 end
    `);
    const login = () => {
      // A /reload or new login: the addon files run again, saved variables stay.
      t.run(`FRAMES = {}; NS = {}`);
      t.load("Core.lua");
      t.load("Compat.lua");
      t.run(`fire_event("PLAYER_LOGIN"); fire_event("GUILD_ROSTER_UPDATE")`);
    };

    // Login on a character in guild Beta: it starts clean, Alpha's ledger is parked.
    login();
    expect(t.run(`return GuildedDB.guildKey`)).toBe("Beta-TestRealm");
    expect(t.run(`return tostring(next(GuildedDB.epgp)) .. tostring(next(GuildedDB.raids))`)).toBe("nilnil");
    expect(t.run(`return GuildedDB.otherGuilds["Alpha-TestRealm"].epgp.Bob.ep`)).toBe("50");
    expect(t.chat().join("\n")).toContain("Guild changed: now using the saved data for Beta-TestRealm (new)");

    // Beta gets its own ledger.
    t.run(`GuildedDB.epgp = { Bob = { ep = 7, gp = 0, ledger = {} } }`);

    // Later, a character in Alpha logs in: Alpha's data comes back, Beta's is parked.
    t.run(`function GetGuildInfo() return "Alpha", "Officer", 1 end`);
    login();
    expect(t.run(`return GuildedDB.guildKey`)).toBe("Alpha-TestRealm");
    expect(t.run(`return GuildedDB.epgp.Bob.ep`)).toBe("50");
    expect(t.run(`return GuildedDB.raids.r1.title`)).toBe("MC");
    expect(t.run(`return GuildedDB.otherGuilds["Beta-TestRealm"].epgp.Bob.ep`)).toBe("7");
    expect(t.chat().join("\n")).toContain("(restored)");
  });

  it("does nothing until the client knows the guild, or when there is no guild", () => {
    const s = loggedIn();
    s.run(`function GetGuildInfo() return nil end; fire_event("GUILD_ROSTER_UPDATE")`);
    expect(s.run(`return tostring(GuildedDB.guildKey)`)).toBe("nil");
    s.run(`function IsInGuild() return false end; function GetGuildInfo() return "Alpha", "x", 1 end; fire_event("GUILD_ROSTER_UPDATE")`);
    expect(s.run(`return tostring(GuildedDB.guildKey)`)).toBe("nil");
  });

  it("/guilded diag shows which guild the data belongs to", () => {
    const s = loggedIn();
    inGuild(s, "Alpha");
    s.run(`fire_event("GUILD_ROSTER_UPDATE"); SlashCmdList["GUILDED"]("diag")`);
    expect(s.chat().join("\n")).toContain("Saved data belongs to guild: Alpha-TestRealm");
  });
});

describe("a realm rename is not a different guild", () => {
  it("keeps the data and only renames the key when the guild name is the same", () => {
    session = newLuaSession();
    const t = session;
    t.run(`
      GuildedDB = { version = 4, guildKey = "Alpha-Classic Beta PvP", epgp = { Bob = { ep = 50, gp = 0, ledger = {} } }, roster = { Bob = {} }, settings = { officers = {} } }
      NS = {}
      MOCK_UNITS = { player = { name = "Kev", buffs = {} } }
      function GetGuildInfo() return "Alpha", "Officer", 1 end
    `);
    t.load("Core.lua");
    t.load("Compat.lua");
    t.run(`fire_event("PLAYER_LOGIN"); fire_event("GUILD_ROSTER_UPDATE")`);
    // The mocked game now reports realm "TestRealm" instead of "Classic Beta PvP".
    expect(t.run(`return GuildedDB.guildKey`)).toBe("Alpha-TestRealm");
    expect(t.run(`return GuildedDB.epgp.Bob.ep`)).toBe("50");
    expect(t.run(`return tostring(next(GuildedDB.otherGuilds))`)).toBe("nil");
    expect(t.chat().join("\n")).toContain("your saved data was kept");
  });
});

describe("the guild digest tells everyone who you are", () => {
  it("adds an I: identity field and reads it from a peer, in any field order", () => {
    const s = loggedIn();
    s.run(`GetInventoryItemLink = function() return nil end; SENT = {}; SlashCmdList["GUILDED"]("inspect")`);
    const digest = s.run(`return SENT[#SENT].text`);
    expect(digest).toContain("|I:WARRIOR,NightElf,60,");
    // A peer digest: professions, identity and flags together, then with no professions.
    s.run(`fire_event("CHAT_MSG_ADDON", "Guilded", "READINESS|Amy|READY|0|100|Mining:300|I:MAGE,Human,58,Fire|F:NOFOOD", "GUILD", "Amy-Realm")`);
    expect(s.run(`local p = GuildedDB.peerRoster["Amy"]; return p.professions .. "|" .. p.identity.class .. "|" .. p.identity.race .. "|" .. p.identity.level .. "|" .. p.identity.spec .. "|" .. p.flags`)).toBe("Mining:300|MAGE|Human|58|Fire|NOFOOD");
    s.run(`fire_event("CHAT_MSG_ADDON", "Guilded", "READINESS|Bob|READY|0|100||I:ROGUE,Gnome,30,", "GUILD", "Bob-Realm")`);
    expect(s.run(`local p = GuildedDB.peerRoster["Bob"]; return p.professions .. "|" .. p.identity.class .. "|" .. p.identity.level`)).toBe("|ROGUE|30");
  });
});

describe("slow handler timings", () => {
  it("records a slow event quietly, without printing", () => {
    session = newLuaSession();
    session.run(`
      GuildedDB = nil; NS = {}
      local ticks = { 0, 120 }
      debugprofilestop = function() return table.remove(ticks, 1) or 120 end
    `);
    session.load("Core.lua");
    session.run(`fire_event("PLAYER_LOGIN")`);
    const before = session.chat().length;
    session.run(`
      local ticks = { 0, 120 }
      debugprofilestop = function() return table.remove(ticks, 1) or 120 end
      fire_event("GROUP_ROSTER_UPDATE")
    `);
    expect(session.run(`local last = GuildedDB.diagnostics[#GuildedDB.diagnostics]; return last.kind .. ":" .. last.detail`)).toContain("SLOW:");
    expect(session.chat().slice(before).join("\n")).not.toContain("[Diagnostic]");
  });
});

describe("ready check requests", () => {
  // Requests count only from an officer, the group leader or an assistant (Modules/Ready.lua decides).
  const withReady = (s: LuaSession) => { s.load("Modules/Ready.lua"); s.run(`function UnitIsGroupLeader(unit) return unit == "Amy" end`); return s; };
  const readinessSent = (s: LuaSession) => s.run(`local n = 0; for _, m in ipairs(SENT or {}) do if string.find(m.text, "^READINESS|") and m.target == "RAID" then n = n + 1 end end; return n`);

  it("answers a request that came through the raid channel with a readiness digest, at most every 20 seconds", () => {
    const s = withReady(loggedIn());
    s.run(`GetInventoryItemLink = function() return nil end; SENT = {}; GetServerTime = function() return 1000 end; fire_event("CHAT_MSG_ADDON", "Guilded", "READYREQ|1", "RAID", "Amy-Realm")`);
    expect(readinessSent(s)).toBe("1");
    s.run(`fire_event("CHAT_MSG_ADDON", "Guilded", "READYREQ|2", "RAID", "Amy-Realm")`);
    expect(readinessSent(s)).toBe("1");
    s.run(`GetServerTime = function() return 1030 end; fire_event("CHAT_MSG_ADDON", "Guilded", "READYREQ|3", "RAID", "Amy-Realm")`);
    expect(readinessSent(s)).toBe("2");
  });

  it("ignores a request from a whisper or the guild channel, from a plain raider, and in combat", () => {
    const s = withReady(loggedIn());
    s.run(`GetInventoryItemLink = function() return nil end; SENT = {}; GetServerTime = function() return 5000 end; fire_event("CHAT_MSG_ADDON", "Guilded", "READYREQ|1", "WHISPER", "Amy-Realm"); fire_event("CHAT_MSG_ADDON", "Guilded", "READYREQ|1", "GUILD", "Amy-Realm")`);
    expect(readinessSent(s)).toBe("0");
    s.run(`GetServerTime = function() return 7000 end; fire_event("CHAT_MSG_ADDON", "Guilded", "READYREQ|1", "RAID", "Bob-Realm")`);
    expect(readinessSent(s)).toBe("0");
    s.run(`InCombatLockdown = function() return true end; GetServerTime = function() return 9000 end; fire_event("CHAT_MSG_ADDON", "Guilded", "READYREQ|1", "RAID", "Amy-Realm")`);
    expect(readinessSent(s)).toBe("0");
  });
});

describe("guild profession snapshots", () => {
  it("saves a confirmed empty list immediately after unlearning a profession", () => {
    const s = loggedIn();
    s.run('C_Timer.After = function(_, fn) fn() end; GetProfessions = function() return nil, nil end; GetProfessionInfo = function() return nil end; fire_event("SKILL_LINES_CHANGED")');
    expect(s.run('return tostring(GuildedDB.character.professionsComplete) .. ":" .. #GuildedDB.character.professions')).toBe("true:0");
    s.run('GetProfessions = nil; local _, complete = NS.collectProfessions(); return tostring(complete)');
    expect(s.run('local _, complete = NS.collectProfessions(); return tostring(complete)')).toBe("false");
  });
  it("keeps a fresh empty peer report against older or legacy digests", () => {
    const s = loggedIn();
    s.run('fire_event("CHAT_MSG_ADDON", "Guilded", "READINESS|Amy|READY|0|100||P:2000|I:MAGE,Human,60,", "GUILD", "Amy-Realm")');
    expect(s.run('return tostring(GuildedDB.peerRoster.Amy.professionsComplete) .. ":" .. GuildedDB.peerRoster.Amy.professions')).toBe("true:");
    s.run('fire_event("CHAT_MSG_ADDON", "Guilded", "READINESS|Amy|READY|0|100|Alchemy:300|P:1000", "GUILD", "Amy-Realm")');
    expect(s.run('return GuildedDB.peerRoster.Amy.professions')).toBe("");
    s.run('fire_event("CHAT_MSG_ADDON", "Guilded", "READINESS|Amy|READY|0|100|Alchemy:300", "GUILD", "Amy-Realm")');
    expect(s.run('return GuildedDB.peerRoster.Amy.professions')).toBe("");
  });
  it("answers the guild profession request while preserving raid-ready request permissions", () => {
    const s = loggedIn();
    s.run('SENT = {}; GetInventoryItemLink = function() return nil end; GetServerTime = function() return 1800000000 end; GetProfessions = function() return nil end; GetProfessionInfo = function() return nil end; fire_event("CHAT_MSG_ADDON", "Guilded", "PROFREQ|1", "GUILD", "Amy-Realm")');
    expect(s.run('local count = 0; for _, m in ipairs(SENT) do if m.target == "GUILD" and string.find(m.text, "P:1800000000", 1, true) then count = count + 1 end end; return count')).toBe("1");
  });
});
