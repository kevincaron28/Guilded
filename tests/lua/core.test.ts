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
  it("allows an author to void a recovered entry without voiding another officer's award", () => {
    const s = loggedIn();
    s.run(`
      GuildedDB.epgp.Kev = { ep = 17, gp = 0, ledger = {
        { id = "Kev-1800000000-1", by = "Kev", fromPeer = "Alice", epAmount = 10, gpAmount = 0, pending = true },
        { id = "Alice-1800000000-2", by = "Alice", fromPeer = "Alice", epAmount = 7, gpAmount = 0, pending = true }
      } }
      SlashCmdList.GUILDED("void Kev")
    `);
    expect(s.run('return tostring(GuildedDB.epgp.Kev.ledger[1].voided ~= nil)')).toBe("true");
    expect(s.run('return tostring(GuildedDB.epgp.Kev.ledger[2].voided == nil)')).toBe("true");
    expect(s.run('return GuildedDB.epgp.Kev.ep')).toBe("7");
  });

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

  it("an automatic check right after login waits for the gear instead of recording empty slots", () => {
    const s = loggedIn();
    // As on WoW Forever right after login: no slot reports anything yet.
    s.run(`
      TIMERS = {}
      C_Timer = { After = function(_, fn) TIMERS[#TIMERS + 1] = fn end }
      LINKS = {}
      GetInventoryItemLink = function(_, slot) return LINKS[slot] end
      GetInventoryItemID = function(_, slot) return LINKS[slot] and tonumber(string.match(LINKS[slot], "item:(%d+)")) end
      GetInventoryItemDurability = function() return 90, 100 end
      GuildedDB.readiness["Kev"] = nil
      SENT = {}
      fire_event("SKILL_LINES_CHANGED")
      TIMERS[#TIMERS]()   -- the 1 s delay after the skill event: gear still empty, so it waits
    `);
    expect(s.run(`return tostring(GuildedDB.readiness["Kev"])`)).toBe("nil");
    expect(s.run(`local n = 0; for _, m in ipairs(SENT) do if string.find(m.text, "^READINESS|") then n = n + 1 end end; return n`)).toBe("0");
    withGear(s);
    s.run(`TIMERS[#TIMERS]()`);   // 5 s later the gear is there
    expect(s.run(`return GuildedDB.readiness["Kev"].status`)).not.toBe("NOT_READY");
  });

  it("automatic gear checks tell the guild only when something changed (plus a 10-minute heartbeat)", () => {
    const s = loggedIn();
    withGear(s);
    s.run(`
      T = os.time() + 100000; time = function() return T end
      SENT = {}
      function digests() local n = 0; for _, m in ipairs(SENT) do if string.find(m.text, "^READINESS|") then n = n + 1 end end; return n end
      fire_event("UNIT_INVENTORY_CHANGED", "player")          -- first check: sent
      T = T + 30; fire_event("UNIT_INVENTORY_CHANGED", "player") -- looting, nothing changed: not sent
      T = T + 30; fire_event("UNIT_INVENTORY_CHANGED", "player")
    `);
    expect(s.run(`return digests()`)).toBe("1");
    s.run(`LINKS[1] = nil; T = T + 30; fire_event("UNIT_INVENTORY_CHANGED", "player")`); // took the helm off: sent
    expect(s.run(`return digests()`)).toBe("2");
    s.run(`T = T + 601; fire_event("UNIT_INVENTORY_CHANGED", "player")`);                // heartbeat
    expect(s.run(`return digests()`)).toBe("3");
    // An officer's request is always answered, even with nothing new.
    s.load("Modules/Ready.lua"); s.run(`function UnitIsGroupLeader(unit) return unit == "Amy" end; GetServerTime = function() return 9000 end; fire_event("CHAT_MSG_ADDON", "Guilded", "READYREQ|1", "RAID", "Amy-Realm")`);
    expect(s.run(`local n = 0; for _, m in ipairs(SENT) do if string.find(m.text, "^READINESS|") and m.target == "RAID" then n = n + 1 end end; return n`)).toBe("1");
  });

  it("a bare /guilded opens the window; /guilded help still lists the commands", () => {
    const s = loggedIn();
    s.run(`OPENED = 0; NS.commandHandlers["menu"] = function() OPENED = OPENED + 1 end; CHAT_LOG = {}`);
    s.run(`SlashCmdList["GUILDED"]("")`);
    expect(s.run(`return OPENED`)).toBe("1");
    expect(s.run(`return #CHAT_LOG`)).toBe("0");
    s.run(`SlashCmdList["GUILDED"]("help")`);
    expect(Number(s.run(`return #CHAT_LOG`))).toBeGreaterThan(5);
    expect(s.run(`return OPENED`)).toBe("1");
  });

  it("roster attendance says why it cannot run: no core, an empty local core, or a Discord core without a roster", () => {
    const s = loggedIn();
    s.run(`SlashCmdList["GUILDED"]("start Test"); CHAT_LOG = {}; NS.loot = { core = function() return nil end, rosterCheck = function() end }; SlashCmdList["GUILDED"]("attendance roster")`);
    expect(s.run(`return CHAT_LOG[#CHAT_LOG]`)).toContain("Choose a raid core first");
    s.run(`NS.loot.core = function() return { name = "Team", localOnly = true, roster = {} } end; SlashCmdList["GUILDED"]("attendance roster")`);
    expect(s.run(`return CHAT_LOG[#CHAT_LOG]`)).toContain("Team has no raiders yet");
    s.run(`NS.loot.core = function() return { name = "Les Aggros", roster = {} } end; SlashCmdList["GUILDED"]("attendance roster")`);
    expect(s.run(`return CHAT_LOG[#CHAT_LOG]`)).toContain("Les Aggros has no roster from Discord yet");
  });

  it("raid templates, notes, roster attendance, undo, discard and the raid history", () => {
    const s = loggedIn();
    s.run(`
      CORE_CMDS = {}
      NS.runCommand = function(line) CORE_CMDS[#CORE_CMDS + 1] = line end
      NS.loot = {
        core = function() return { id = "local:1", name = "Tuesday MC", roster = { { name = "Amy" }, { name = "Bob" }, { name = "Cy" } } } end,
        rosterCheck = function() return { present = { { name = "Kev" }, { name = "Amy" } }, missing = { { name = "Bob" } }, bench = { { name = "Cy" } }, fillIns = {} } end,
      }
      SlashCmdList["GUILDED"]("template save tue Tuesday Molten Core")
    `);
    expect(s.run(`return GuildedDB.raidTemplates.tue.title .. ":" .. GuildedDB.raidTemplates.tue.coreId`)).toBe("Tuesday Molten Core:local:1");
    s.run(`SlashCmdList["GUILDED"]("start tue")`);
    expect(s.run(`return GuildedDB.raids[#GuildedDB.raids].title`)).toBe("Tuesday Molten Core");
    expect(s.run(`return CORE_CMDS[1]`)).toBe("core local:1");
    // A raid with nothing in it can be discarded; one with attendance cannot.
    s.run(`SlashCmdList["GUILDED"]("raid discard")`);
    expect(s.run(`return #GuildedDB.raids`)).toBe("0");
    s.run(`SlashCmdList["GUILDED"]("start tue"); SlashCmdList["GUILDED"]("attendance roster")`);
    const id = s.run(`return GuildedDB.raids[#GuildedDB.raids].id`);
    expect(s.run(`local a = GuildedDB.attendance["${id}"]; return a.Amy.status .. ":" .. a.Bob.status .. ":" .. tostring(a.Cy)`)).toBe("PRESENT:ABSENT:nil");
    s.run(`SlashCmdList["GUILDED"]("raid discard")`);
    expect(s.run(`return #GuildedDB.raids`)).toBe("1");
    s.run(`SlashCmdList["GUILDED"]("note Rag wipe at 10%"); SlashCmdList["GUILDED"]("award Amy 10 On time"); SlashCmdList["GUILDED"]("undo")`);
    expect(s.run(`return tostring(GuildedDB.epgp.Amy.ledger[1].voided ~= nil)`)).toBe("true");
    s.run(`CHAT_LOG = {}; SlashCmdList["GUILDED"]("end")`);
    expect(s.run(`return table.concat(CHAT_LOG, "\\n")`)).toContain("Note: Rag wipe at 10%");
    s.run(`CHAT_LOG = {}; SlashCmdList["GUILDED"]("raids")`);
    expect(s.run(`return table.concat(CHAT_LOG, "\\n")`)).toMatch(/Tuesday Molten Core: 2 attended, 0 boss\(es\), \+0 EP, 0 loot/); // Kev and Amy
  });

  it("/guilded raids report: each player's attendance, lates, loot and EP over the last raids", () => {
    const s = loggedIn();
    s.run(`
      SlashCmdList["GUILDED"]("start Molten Core")
      SlashCmdList["GUILDED"]("attendance Amy PRESENT")
      SlashCmdList["GUILDED"]("attendance Bob LATE")
      SlashCmdList["GUILDED"]("award Amy 10 On time")
      SlashCmdList["GUILDED"]("loot Amy Felheart Gloves 40")
      SlashCmdList["GUILDED"]("end")
      -- A week later (raid ids include the server time).
      GetServerTime = function() return 1800000000 + 7 * 86400 end
      SlashCmdList["GUILDED"]("start Onyxia")
      SlashCmdList["GUILDED"]("attendance Amy PRESENT")
      SlashCmdList["GUILDED"]("attendance Bob ABSENT")
      SlashCmdList["GUILDED"]("end")
      CHAT_LOG = {}
      SlashCmdList["GUILDED"]("raids report")
    `);
    const out = s.run(`return table.concat(CHAT_LOG, "\\n")`);
    expect(out).toContain("Attendance over the last 2 raid(s) on this PC");
    expect(out).toContain("Amy: 2/2 (100%), 1 loot, +10 EP");
    expect(out).toContain("Bob: 1/2 (50%), 1 late, 1 absent");
    // Best attendance first; Kev (the officer, in the group) was seen but never marked.
    expect(out.indexOf("Amy:")).toBeLessThan(out.indexOf("Bob:"));
    expect(out).toMatch(/Kev: 0\/2 \(0%\), 2 seen, not marked/);
    // Only the last raid when asked for 1.
    s.run(`CHAT_LOG = {}; SlashCmdList["GUILDED"]("raids report 1")`);
    expect(s.run(`return table.concat(CHAT_LOG, "\\n")`)).toContain("Bob: 0/1 (0%), 1 absent");
  });

  it("a template saved from the Raid page as tuesday-mc starts from its full name too", () => {
    const s = loggedIn();
    s.run(`
      NS.loot = { core = function() return { id = "local:2", name = "Les Aggros", roster = {} } end }
      NS.runCommand = function() end
      SlashCmdList["GUILDED"]("template save tuesday-mc Tuesday MC")
      SlashCmdList["GUILDED"]("start Tuesday MC")
    `);
    expect(s.run(`return GuildedDB.raids[#GuildedDB.raids].title .. ":" .. tostring(GuildedDB.raids[#GuildedDB.raids].coreId)`)).toBe("Tuesday MC:local:2");
  });

  it("ending a raid prints a summary of what was recorded; /guilded summary shows it again", () => {
    const s = loggedIn();
    s.run(`
      SlashCmdList["GUILDED"]("start Molten Core")
      SlashCmdList["GUILDED"]("attendance Amy PRESENT")
      SlashCmdList["GUILDED"]("attendance Bob LATE")
      SlashCmdList["GUILDED"]("boss Lucifron")
      SlashCmdList["GUILDED"]("award Amy 10 On time")
      SlashCmdList["GUILDED"]("loot Amy Felheart Gloves 40")
      CHAT_LOG = {}
      SlashCmdList["GUILDED"]("end")
    `);
    const out = s.run(`return table.concat(CHAT_LOG, "\\n")`);
    expect(out).toContain("Attendance (marked by officers): 1 present, 1 late, 0 absent.");
    expect(out).toContain("Bosses (marked by hand): Lucifron");
    expect(out).toContain("+10 EP");
    expect(out).toContain("Felheart Gloves -> Amy (40 GP)");
    s.run(`CHAT_LOG = {}; SlashCmdList["GUILDED"]("summary")`);
    expect(s.run(`return table.concat(CHAT_LOG, "\\n")`)).toContain("Molten Core");
  });

  it("below level 60 empty slots are a note, not 'Not ready'; /guilded slots level changes it", () => {
    const s = loggedIn();
    withGear(s);
    s.run(`LINKS[1] = nil; LINKS[3] = nil; UnitLevel = function() return 18 end; SlashCmdList["GUILDED"]("inspect")`);
    expect(s.run(`return GuildedDB.readiness["Kev"].status`)).not.toBe("NOT_READY");
    const codes = () => s.run(`local f = {}; for _, x in ipairs(GuildedDB.readiness["Kev"].findings) do f[#f + 1] = x.code .. ":" .. x.severity end; return table.concat(f, ",")`);
    expect(codes()).toContain("EMPTY_SLOTS_LOW_LEVEL:INFO");
    s.run(`SlashCmdList["GUILDED"]("slots level 1"); SlashCmdList["GUILDED"]("inspect")`);
    expect(s.run(`return GuildedDB.readiness["Kev"].status`)).toBe("NOT_READY");
    expect(codes()).toContain("MISSING_HEAD:ERROR");
  });

  it("a manual check still records a character with no gear at once", () => {
    const s = loggedIn();
    s.run(`GetInventoryItemLink = function() return nil end; GetInventoryItemID = function() return nil end; SlashCmdList["GUILDED"]("inspect")`);
    expect(s.run(`return GuildedDB.readiness["Kev"].status`)).toBe("NOT_READY");
  });

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

  it("shares the item level as the first flag, for the officers' Gear page", () => {
    const s = loggedIn();
    withGear(s);
    s.run(`GetAverageItemLevel = function() return 58.4, 57.6 end; MOCK_RAID = true; MOCK_UNITS = { player = { name = "Kev", buffs = { "Blessing of Kings" } } }; SENT = {}; SlashCmdList["GUILDED"]("inspect")`);
    expect(s.run(`return SENT[#SENT].text`)).toContain("|F:IL:58,NOFLASK,NOFOOD,ENCH:");
    // A guildmate's IL flag is kept with the rest of their flags.
    s.run(`fire_event("CHAT_MSG_ADDON", "Guilded", "READINESS|Amy|READY|0|100||F:IL:61", "GUILD", "Amy-Realm")`);
    expect(s.run(`return GuildedDB.peerRoster["Amy"].flags`)).toBe("IL:61");
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

  it("picks up a guild joined mid-session without a roster update or /reload", () => {
    const s = loggedIn();
    s.run(`TIMERS = {}; C_Timer.After = function(_, fn) TIMERS[#TIMERS + 1] = fn end`);
    // Just invited: the client fires PLAYER_GUILD_UPDATE before GetGuildInfo knows the name.
    s.run(`function GetGuildInfo() return nil end; fire_event("PLAYER_GUILD_UPDATE")`);
    expect(s.run(`return tostring(GuildedDB.guildKey)`)).toBe("nil");
    expect(s.run(`return #TIMERS`)).toBe("3");
    inGuild(s, "Alpha");
    s.run(`for _, fn in ipairs(TIMERS) do fn() end`);
    expect(s.run(`return GuildedDB.guildKey`)).toBe("Alpha-TestRealm");
  });

  it("/guilded diag shows which guild the data belongs to", () => {
    const s = loggedIn();
    inGuild(s, "Alpha");
    s.run(`fire_event("GUILD_ROSTER_UPDATE"); SlashCmdList["GUILDED"]("diag")`);
    expect(s.chat().join("\n")).toContain("Saved data belongs to guild: Alpha-TestRealm");
  });
});

describe("a realm rename is not a different guild", () => {
  it("keeps same-name realm and edition ledgers separate across A to B to A logins", () => {
    session = newLuaSession(); const s = session;
    s.run(`GuildedDB=nil; NS={}; MOCK_UNITS={player={name="Kev"}};
      REALM="RealmA"; EDITION="retail";
      function GetGuildInfo() return "Alpha", "Officer", 1 end
      function GetRealmName() return REALM end`);
    const login = () => {
      s.run("FRAMES={}; NS={}"); s.load("Core.lua"); s.load("Compat.lua");
      s.run(`NS.util.gameEdition=function() return EDITION end; fire_event("PLAYER_LOGIN"); fire_event("GUILD_ROSTER_UPDATE")`);
    };
    login(); s.run("GuildedDB.epgp.Bob={ep=50,gp=0,ledger={}}; REALM='RealmB'");
    login();
    expect(s.run("return tostring(GuildedDB.epgp.Bob)")).toBe("nil");
    s.run("GuildedDB.epgp.Bob={ep=7,gp=0,ledger={}}; REALM='RealmA'"); login();
    expect(s.run("return GuildedDB.epgp.Bob.ep")).toBe("50");
    s.run("EDITION='classic-era'"); login();
    expect(s.run("return tostring(GuildedDB.epgp.Bob)")).toBe("nil");
    s.run("GuildedDB.epgp.Bob={ep=9,gp=0,ledger={}}; EDITION='retail'"); login();
    expect(s.run("return GuildedDB.epgp.Bob.ep")).toBe("50");
    expect(s.run("return GuildedDB.otherGuilds['retail@Alpha-RealmB'].epgp.Bob.ep")).toBe("7");
    expect(s.run("return GuildedDB.otherGuilds['classic-era@Alpha-RealmA'].epgp.Bob.ep")).toBe("9");
  });
  it("only renames a Forever realm with an explicit local alias", () => {
    session = newLuaSession();
    const t = session;
    t.run(`
      GuildedDB = { version = 4, guildKey = "Alpha-Classic Beta PvP", epgp = { Bob = { ep = 50, gp = 0, ledger = {} } }, roster = { Bob = {} }, settings = { officers = {}, guildRealmAliases = { ["Alpha-Classic Beta PvP"] = "Alpha-TestRealm" } } }
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

describe("diagnostics put Guilded's own problems first (6.3)", () => {
  it("counts other addons' errors and lists them only with diag all", () => {
    const s = loggedIn();
    s.run(`GuildedDB.diagnostics = {
      { at = "2026-10-03", kind = "ADDON_ACTION_BLOCKED", detail = "RXPGuides tried to call", foreign = true },
      { at = "2026-10-06", kind = "LUA_ERROR", detail = "Details: no LibOpenRaid", foreign = true },
      { at = "2026-10-07", kind = "LUA_ERROR", detail = "Guilded window nil", count = 2 } }`);
    s.run(`SlashCmdList["GUILDED"]("diag")`);
    let chat = s.chat().join("\n");
    expect(chat).toContain("Last 1 Guilded problem(s):");
    expect(chat).toContain("Guilded window nil");
    expect(chat).toContain("2 problem(s) from other addons were also recorded");
    expect(chat).not.toContain("RXPGuides");
    s.run(`CHAT_LOG = {}; SlashCmdList["GUILDED"]("diag all")`);
    chat = s.chat().join("\n");
    expect(chat).toContain("RXPGuides tried to call");
    s.run(`CHAT_LOG = {}; GuildedDB.diagnostics = {}; SlashCmdList["GUILDED"]("diag")`);
    expect(s.chat().join("\n")).toContain("No Guilded problems recorded.");
  });
});
