import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

// The 7.5.0 launch-week officer tools, each real module file against a mocked game: loot imports,
// the consumable penalty (with the real Core.lua), recruiting, the guild log, the guild bank,
// main names in chat, the pug check and the speed recorder.
const sessions: LuaSession[] = [];
afterEach(() => { for (const s of sessions) s.close(); sessions.length = 0; });

// A bare namespace like the other module tests use: Kev is an officer unless told otherwise.
function bare(options: { officer?: boolean; lua?: string } = {}): LuaSession {
  const s = newLuaSession(); sessions.push(s);
  s.run(String.raw`
    local T = 0
    function GetTime() T = T + 10; return T end
    WHISPERS = {}
    C_ChatInfo = {
      SendChatMessage = function(text, ch, _, target) WHISPERS[#WHISPERS + 1] = tostring(ch) .. ":" .. tostring(target) .. ":" .. text end,
      SendAddonMessage = function(_, text, ch, target) SENT = SENT or {}; SENT[#SENT + 1] = tostring(ch) .. ":" .. text end,
      RegisterAddonMessagePrefix = function() return true end
    }
    DB = { settings = {} }
    NS = {
      L = function(t) return t end,
      getDb = function() return DB end, playerName = function() return "Kev" end,
      normalizeName = function(n) if not n then return nil end return (string.gsub(n, "%-.*", "")) end,
      isSecret = function() return false end, isOfficer = function() return ${options.officer === false ? "false" : "true"} end,
      isOfficerName = function(n) return n == "Kev" or n == "Boss" end,
      isGuildMember = function(n) return n == "Guildie" end,
      now = function() return "2026-11-04T20:00:00Z" end,
      message = function(text) CHAT_LOG = CHAT_LOG or {}; CHAT_LOG[#CHAT_LOG + 1] = text end,
      showCopyText = function(text, title) COPIED = { text = text, title = title } end,
      showPasteBox = function(title, help, onImport) PASTE = { title = title, help = help, onImport = onImport } end,
      commandHandlers = {}, commandHelp = {}
    }
    ${options.lua ?? ""}
  `);
  return s;
}

const run = (s: LuaSession, command: string, line = "") =>
  s.run(`local a = {}; for w in string.gmatch(${JSON.stringify(line)}, "%S+") do a[#a + 1] = w end; NS.commandHandlers[${JSON.stringify(command)}](a)`);
const lastChat = (s: LuaSession) => s.chat().at(-1) ?? "";
// Pastes text into the paste window the last command opened and presses Import.
const paste = (s: LuaSession, text: string) =>
  s.run(`local ok, message = PASTE.onImport(${JSON.stringify(text)}); return tostring(ok) .. ": " .. tostring(message)`);

// The game's base64/zlib/JSON, faked: a packed export decodes to the table in UNPACKED.
const ENCODING = String.raw`
  C_EncodingUtil = {
    DecodeBase64 = function(text) return "raw:" .. text end,
    DecompressString = function(raw) return "json:" .. raw end,
    DeserializeJSON = function(text) return UNPACKED end
  }
`;

describe("softres.it and That's My BiS imports (LootImports.lua)", () => {
  function withImports(officer = true): LuaSession {
    const s = bare({ officer, lua: "function IsInGuild() return true end; function IsInRaid() return false end; function IsInGroup() return false end" });
    s.load("Modules/Reserve.lua");
    s.load("Modules/LootImports.lua");
    return s;
  }

  it("turns a softres.it CSV into the shared reserve list, kept by the importing officer", () => {
    const s = withImports();
    run(s, "import", "softres");
    expect(s.run("return PASTE.title")).toBe("Import softres.it");
    const csv = [
      "ItemId,Name,Class,Note,Plus",
      '19364,Boss,Warrior,"BiS, really",0',
      "17063,Ray,Rogue,,0",
      '17063,"Ann-Realm",Mage,,1',
      "19364,Boss,Warrior,,0",
      "not-a-number,Ray,Rogue,,0"
    ].join("\r\n");
    expect(paste(s, csv)).toBe("true: Imported 3 reserve(s) for 3 player(s). The list is open and shared with the guild; lock it when the raid starts.");
    expect(s.run("return table.concat(DB.reserves.entries.Boss, ',') .. '/' .. table.concat(DB.reserves.entries.Ray, ',') .. '/' .. table.concat(DB.reserves.entries.Ann, ',')")).toBe("19364/17063/17063");
    expect(s.run("return tostring(DB.reserves.open) .. ':' .. DB.reserves.limit .. ':' .. DB.reserves.host .. ':' .. DB.reserves.title")).toBe("true:1:Kev:softres.it import");
    expect(s.run("return table.concat(NS.reserve.holders(17063), ',')")).toBe("Ann,Ray");
  });

  it("reads softres.it's Gargul export where the game can unpack it, and explains when it cannot", () => {
    const s = withImports();
    s.run("UNPACKED = { softreserves = { { name = 'Boss', items = { { id = 19364 }, { id = 17063 } } }, { name = 'Kay|x', items = { { id = 18814 } } } } }");
    run(s, "import", "softres");
    expect(paste(s, "eJyrVkrLz1eyUlAqzy8tSs5ILUpVslIqSk3OL0pRslLKSy0uSUxXslIqLkksSQUAKUgPYw==")).toBe("false: This game client cannot unpack that export. Paste the CSV export instead.");
    s.run(ENCODING);
    expect(paste(s, "eJyrVkrLz1eyUlAqzy8tSs5ILUpVslIqSk3OL0pRslLKSy0uSUxXslIqLkksSQUAKUgPYw==")).toContain("Imported 3 reserve(s) for 2 player(s)");
    // The separator in a name is dropped, so the shared "name=ids;..." messages stay intact.
    expect(s.run("return DB.reserves.limit .. ':' .. table.concat(DB.reserves.entries.Kayx, ',')")).toBe("2:18814");
  });

  it("refuses members and explains a CSV without its header", () => {
    const member = withImports(false);
    run(member, "import", "softres");
    expect(lastChat(member)).toBe("Only officers can do that.");
    expect(member.run("return tostring(PASTE)")).toBe("nil");
    const s = withImports();
    run(s, "import", "softres");
    expect(paste(s, "19364,Boss\n17063,Ray")).toBe("false: The first line must be the CSV header (with ItemId and Name).");
    expect(s.run("return tostring(DB.reserves and DB.reserves.host)")).toBe("nil");
  });

  it("shows That's My BiS priorities on tooltips, in order, from a CSV or the Gargul download", () => {
    const s = withImports();
    s.load("Modules/Tooltip.lua");
    run(s, "import", "tmb");
    expect(paste(s, "Melee:19364,Boss,Kay,Ray,Ann,Bob,Cy\n17063,Ann\n0,Nobody")).toBe("true: Imported That's My BiS priorities for 2 item(s). Item tooltips show them.");
    const link = "|cffa335ee|Hitem:19364::::::::60|h[Ashkandi]|h|r";
    expect(s.run(`return table.concat(NS.tooltip.lines("Ashkandi", "${link}"), " / ")`)).toContain("That's My BiS: 1. Boss, 2. Kay, 3. Ray, 4. Ann, 5. Bob +1");
    run(s, "tmb", "item:17063");
    expect(lastChat(s)).toBe("That's My BiS: Ann");
    s.run(ENCODING + "UNPACKED = { wishlists = { ['18814'] = { 'Kay|2|1|x', 'Boss|1|1|y', 'Ray||' } } }");
    run(s, "import", "tmb");
    expect(paste(s, "eJyrVkrLz1eyUlAqzy8tSs5ILUpVslIqSk3OL0pRslLKSy0uSUxXslIqLkksSQUAKUgPYw==")).toContain("for 1 item(s)");
    expect(s.run("return table.concat(NS.lootImports.tmbList(18814), ',')")).toBe("Boss,Kay,Ray");
    run(s, "import", "tmb clear");
    expect(s.run("return tostring(DB.tmb)")).toBe("nil");
  });
});

describe("consumable attendance penalty (Consumables.lua with Core.lua's group award)", () => {
  function raidNight(): LuaSession {
    const s = newLuaSession(); sessions.push(s);
    s.run(String.raw`
      GuildedDB = nil; NS = {}
      MOCK_RAID = true; MOCK_GROUP_SIZE = 4
      -- Cy shows no buffs at all: out of range or hidden, so unknown, never "missing".
      MOCK_UNITS = {
        player = { name = "Kev", buffs = { "Flask of the Titans", "Well Fed" } },
        raid1 = { name = "Kev", buffs = { "Flask of the Titans", "Well Fed" } },
        raid2 = { name = "Ann", buffs = { "Well Fed" } },
        raid3 = { name = "Bob", buffs = { "Blessing of Kings" } },
        raid4 = { name = "Cy", buffs = {} }
      }
      function GetRaidRosterInfo(i) local u = MOCK_UNITS["raid" .. i]; return u and u.name end
    `);
    s.load("Core.lua");
    s.load("Compat.lua");
    s.load("Modules/Consumables.lua");
    s.run(`fire_event("PLAYER_LOGIN"); SlashCmdList.GUILDED("start Molten Core")`);
    return s;
  }
  const epOf = (s: LuaSession, name: string) => s.run(`local a = GuildedDB.epgp.${name}; return a and tostring(a.ep) or "none"`);

  it("gives less EP to players this raid's scan saw without a flask or food, and says why", () => {
    const s = raidNight();
    s.run(`SlashCmdList.GUILDED("consumes penalty 50"); SlashCmdList.GUILDED("consumes"); SlashCmdList.GUILDED("award group 10 Ragnaros")`);
    expect([epOf(s, "Kev"), epOf(s, "Ann"), epOf(s, "Bob"), epOf(s, "Cy")]).toEqual(["10", "5", "5", "10"]);
    expect(s.run("return GuildedDB.epgp.Ann.ledger[1].reason")).toBe("Ragnaros; no flask at the consumable check, -50%");
    expect(s.run("return GuildedDB.epgp.Bob.ledger[1].reason")).toBe("Ragnaros; no flask/food at the consumable check, -50%");
    expect(s.chat().join("\n")).toContain("Consumable penalty applied to 2 player(s): Ann, Bob.");
  });

  it("records nothing for a full penalty, and ignores a scan from another raid or no penalty set", () => {
    const s = raidNight();
    s.run(`SlashCmdList.GUILDED("consumes penalty 100"); SlashCmdList.GUILDED("consumes"); SlashCmdList.GUILDED("award group 10 Boss")`);
    expect([epOf(s, "Kev"), epOf(s, "Ann"), epOf(s, "Bob")]).toEqual(["10", "none", "none"]);
    // The next raid has no scan of its own yet: everyone gets the full amount.
    s.run(`SlashCmdList.GUILDED("end"); function GetServerTime() return 1800007200 end
      SlashCmdList.GUILDED("start Onyxia"); SlashCmdList.GUILDED("award group 10 Onyxia")`);
    expect([epOf(s, "Ann"), epOf(s, "Bob")]).toEqual(["10", "10"]);
    s.run(`SlashCmdList.GUILDED("consumes penalty 0"); SlashCmdList.GUILDED("consumes"); SlashCmdList.GUILDED("award group 4 Trash")`);
    expect(epOf(s, "Bob")).toBe("14");
    s.run(`SlashCmdList.GUILDED("consumes penalty 150")`);
    expect(s.chat().at(-1)).toContain("/guilded consumes penalty <0-100>");
    expect(s.run("return GuildedDB.settings.consumePenalty")).toBe("0");
  });
});

describe("recruiting and the welcome whisper (Recruit.lua)", () => {
  function withRecruit(officer = true): LuaSession {
    const s = bare({ officer, lua: `ERR_GUILD_JOIN_S = "%s has joined the guild."; C_Timer = { After = function(_, fn) fn() end }` });
    s.load("Modules/Recruit.lua");
    return s;
  }
  const join = (s: LuaSession, name: string) => s.run(`fire_event("CHAT_MSG_SYSTEM", "${name} has joined the guild.")`);

  it("whispers a new member once, with the guild's message, and tells the other officers", () => {
    const s = withRecruit();
    run(s, "welcome", "on Hi {name}, welcome to {guild}!");
    join(s, "Newbie");
    join(s, "Newbie");
    expect(s.run("return table.concat(WHISPERS, ' | ')")).toBe("WHISPER:Newbie:Hi Newbie, welcome to Test Guild!");
    expect(s.run("local n = 0; for _, m in ipairs(SENT or {}) do if m:find('WELCOMED|1|Newbie', 1, true) then n = n + 1 end end; return n")).toBe("1");
  });

  it("stays quiet when another officer already welcomed them, when off, and for members", () => {
    const s = withRecruit();
    run(s, "welcome", "on");
    s.run(`fire_event("CHAT_MSG_ADDON", "GuildedRec", "WELCOMED|1|Late", "GUILD", "Boss-Realm")`);
    join(s, "Late");
    run(s, "welcome", "off");
    join(s, "Other");
    expect(s.run("return #WHISPERS")).toBe("0");
    const member = withRecruit(false);
    member.run("DB.welcome = { enabled = true }");
    join(member, "Someone");
    expect(member.run("return #WHISPERS")).toBe("0");
  });

  it("keeps a prospect list that follows invites and joins", () => {
    const s = withRecruit();
    run(s, "recruit", "add Ann met in LFG");
    run(s, "recruit", "add Bob");
    run(s, "recruit", "Bob contacted said maybe");
    expect(s.run("return DB.recruits.list.bob.status .. ':' .. DB.recruits.list.bob.note")).toBe("contacted:said maybe");
    s.run("NS.recruit.noteInvited('Bob')");
    join(s, "Ann");
    expect(s.run("return DB.recruits.list.ann.status .. ':' .. DB.recruits.list.bob.status")).toBe("joined:invited");
    run(s, "recruit", "list joined");
    expect(lastChat(s)).toContain("Ann - joined: met in LFG");
    run(s, "recruit", "remove Bob");
    expect(s.run("return tostring(DB.recruits.list.bob)")).toBe("nil");
    const member = withRecruit(false);
    run(member, "recruit", "add Ann");
    expect(lastChat(member)).toBe("Only officers can do that.");
  });
});

describe("guild event log (GuildLog.lua)", () => {
  const EVENTS = String.raw`
    LOG = {
      { "join", "Ann", nil, nil, 0, 0, 1, 2 },
      { "promote", "Kev", "Ann", "Officer", 0, 0, 0, 5 },
      { "quit", "Bob", nil, nil, 0, 0, 0, 1 },
      { "unknown", "X", nil, nil, 0, 0, 0, 0 }
    }
    function GetNumGuildEvents() return #LOG end
    function GetGuildEventInfo(i) return unpack(LOG[i]) end
  `;

  it("keeps each event once across reads, and finds a player's", () => {
    const s = bare({ lua: EVENTS });
    s.load("Modules/GuildLog.lua");
    expect(s.run("return NS.guildLog.read()")).toBe("3");
    // An hour later the game reports the same events an hour older.
    s.run(`function GetServerTime() return 1800003600 end
      for _, e in ipairs(LOG) do e[8] = e[8] + 1 end`);
    expect(s.run("return NS.guildLog.read()")).toBe("0");
    expect(s.run("return #DB.guildLog.events")).toBe("3");
    run(s, "guildlog", "ann");
    expect(s.chat().join("\n")).toContain("Kev has promoted Ann to Officer.");
    expect(s.chat().join("\n")).not.toContain("Bob");
    run(s, "guildlog", "copy");
    expect(s.run("return COPIED.text")).toMatch(/Ann has joined the guild\.[\s\S]*Bob has quit the guild\./);
  });

  it("says so on a client without the guild log", () => {
    const s = bare();
    s.load("Modules/GuildLog.lua");
    run(s, "guildlog");
    expect(lastChat(s)).toBe("This game client has no guild event log for addons.");
  });
});

describe("guild bank snapshot (GuildBank.lua)", () => {
  const BANK = String.raw`
    MAX_GUILDBANK_SLOTS_PER_TAB = 4
    SLOTS = {
      [1] = { { "|cffffffff|Hitem:13444::::|h[Major Mana Potion]|h|r", 5 }, { "|cffffffff|Hitem:13444::::|h[Major Mana Potion]|h|r", 3 }, { "|cffffffff|Hitem:12360::::|h[Arcanite Bar]|h|r", 2 } },
      [2] = { { "|cffffffff|Hitem:19019::::|h[Thunderfury]|h|r", 1 } }
    }
    function GetNumGuildBankTabs() return 2 end
    function GetGuildBankTabInfo(tab) if tab == 1 then return "Mats", 1, true end return "Officers", 2, false end
    function GetGuildBankItemLink(tab, slot) local s = SLOTS[tab] and SLOTS[tab][slot]; return s and s[1] end
    function GetGuildBankItemInfo(tab, slot) local s = SLOTS[tab] and SLOTS[tab][slot]; return 1, s and s[2] end
    function GetGuildBankMoney() return 1234567 end
  `;

  it("reads the viewable tabs and the gold, and searches or copies the snapshot", () => {
    const s = bare({ lua: BANK });
    s.load("Modules/GuildBank.lua");
    s.run("NS.guildBank.scan()");
    expect(s.run("return DB.guildBank.items .. ':' .. DB.guildBank.tabs[1].items[13444].count .. ':' .. tostring(DB.guildBank.tabs[2])")).toBe("2:8:nil");
    run(s, "gbank", "mana");
    expect(s.chat().join("\n")).toContain("Guild bank on 2026-11-04T20:00:00Z (by Kev): 2 different item(s), 123g 45s 67c.");
    expect(lastChat(s)).toBe("  Major Mana Potion x8 (Mats)");
    run(s, "gbank", "copy");
    expect(s.run("return COPIED.text")).toBe("Tab\tItem ID\tItem\tCount\nMats\t12360\tArcanite Bar\t2\nMats\t13444\tMajor Mana Potion\t8");
  });

  it("keeps the last snapshot while the server has not sent the items yet", () => {
    const s = bare({ lua: BANK });
    s.load("Modules/GuildBank.lua");
    s.run("NS.guildBank.scan(); SLOTS = {}; NS.guildBank.scan()");
    expect(s.run("return DB.guildBank.items .. ':' .. DB.guildBank.tabs[1].items[12360].count")).toBe("2:2");
  });
});

describe("main names in chat (ChatTags.lua)", () => {
  it("puts the main's name before an alt's guild chat once turned on", () => {
    const s = bare({ lua: String.raw`
      FILTERS = {}
      function ChatFrame_AddMessageEventFilter(event, fn) FILTERS[event] = fn end
      GuildedStandings = { updatedAt = "1", players = {
        { name = "Thrall", displayName = "Thrall Stormborn", main = true, account = "a1" },
        { name = "Thrallalt", main = false, account = "a1" },
        { name = "Solo", main = true, account = "a2" },
        { name = "Loose", main = false, account = "" }
      } }
    ` });
    s.load("Modules/ChatTags.lua");
    const say = (author: string) => s.run(`local _, text = FILTERS.CHAT_MSG_GUILD(nil, "CHAT_MSG_GUILD", "lfg deadmines", "${author}"); return text`);
    expect(s.run("return tostring(FILTERS.CHAT_MSG_OFFICER ~= nil)")).toBe("true");
    expect(say("Thrallalt-Realm")).toBe("lfg deadmines");
    run(s, "chattags", "on");
    expect(lastChat(s)).toBe("Main names in guild chat: on. 1 alt(s) known from the standings.");
    expect(say("Thrallalt-Realm")).toBe("|cff9d9d9d(Thrall Stormborn)|r lfg deadmines");
    expect(say("Thrall")).toBe("lfg deadmines");
    expect(say("Loose")).toBe("lfg deadmines");
  });
});

describe("pug gear check (PugCheck.lua)", () => {
  it("inspects group members from outside the guild and reports item level and missing enchants", () => {
    const s = bare({ lua: String.raw`
      NS.gearSlots = { { 1, "Head" }, { 15, "Back" }, { 16, "MainHand" }, { 17, "OffHand" }, { 5, "Chest" } }
      NS.enchantableSlots = { Back = true, MainHand = true }
      MOCK_UNITS = { party1 = { name = "Stranger" }, party2 = { name = "Guildie" } }
      GEAR = { [1] = "item:100:0:0", [15] = "item:300:0:0", [16] = "item:200:1900:0" }
      LEVELS = { ["item:100:0:0"] = 66, ["item:300:0:0"] = 60, ["item:200:1900:0"] = 77 }
      function GetInventoryItemLink(unit, slot) if unit == "party1" then return GEAR[slot] end end
      function GetDetailedItemLevelInfo(link) return LEVELS[link] end
      function CanInspect() return true end
      INSPECTED = {}
      function NotifyInspect(unit) INSPECTED[#INSPECTED + 1] = unit end
      function UnitGUID(unit) return "guid-" .. unit end
    ` });
    s.load("Modules/PugCheck.lua");
    run(s, "pugcheck", "now");
    expect(lastChat(s)).toBe("Checking 1 player(s) from outside the guild...");
    expect(s.run("return table.concat(INSPECTED, ',')")).toBe("party1");
    s.run(`fire_event("INSPECT_READY", "guid-party2")`);
    expect(lastChat(s)).toBe("Checking 1 player(s) from outside the guild...");
    s.run(`fire_event("INSPECT_READY", "guid-party1")`);
    expect(lastChat(s)).toBe("Pug check: Stranger (WARRIOR 60); item level 68; missing enchants: Back; 1 empty slot(s)");
  });
});

describe("speed recorder (Perf.lua)", () => {
  it("times Guilded's commands only while on, and reports the slow ones", () => {
    const s = newLuaSession(); sessions.push(s);
    s.run(`GuildedDB = nil; NS = {}; local T = 0; function debugprofilestop() T = T + 20; return T end`);
    s.load("Core.lua");
    s.load("Modules/Perf.lua");
    s.run(`fire_event("PLAYER_LOGIN"); SlashCmdList.GUILDED("status")`);
    expect(s.run("return #NS.perf.lines()")).toBe("1");
    s.run(`SlashCmdList.GUILDED("perf on"); SlashCmdList.GUILDED("status"); SlashCmdList.GUILDED("status")`);
    const report = s.run("return table.concat(NS.perf.lines(), '\\n')");
    expect(report).toContain("command:status: 2 x, 40.0 ms total, 20.0 ms average, 20.0 ms max");
    expect(report).toContain("Slowest moments (over 16 ms):");
    s.run(`SlashCmdList.GUILDED("perf clear")`);
    expect(s.run("return #NS.perf.lines()")).toBe("1");
  });
});
