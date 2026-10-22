import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

let session: LuaSession | undefined;
afterEach(() => { session?.close(); session = undefined; });

const NOW = Date.UTC(2026, 8, 26, 12, 0, 0) / 1000;

// A raid of five: Kev (me), Amy (ready), Bob (addon says no flask, old data), Cy (offline), Dee (no addon, hidden buffs).
function withRaid(): LuaSession {
  session = newLuaSession();
  session.run(String.raw`
    NOW = ${NOW}
    GetServerTime = function() return NOW end
    MEMBERS = { "Kev", "Amy", "Bob", "Cy", "Dee" }
    ONLINE = { Kev = true, Amy = true, Bob = true, Cy = false, Dee = true }
    function IsInRaid() return true end
    function IsInGroup() return true end
    function GetNumGroupMembers() return #MEMBERS end
    -- raid1..raidN and party1..party4 (party n is member n + 1) both resolve to the same five people.
    function SLOT(unit) local r = tonumber(string.match(unit, "^raid(%d+)$")); if r then return r end local p = tonumber(string.match(unit, "^party(%d+)$")); return p and p + 1 or nil end
    function UnitExists(unit) local i = SLOT(unit); return i ~= nil and MEMBERS[i] ~= nil end
    function UnitName(unit) if unit == "player" then return "Kev" end local i = SLOT(unit); return i and MEMBERS[i] end
    function UnitIsConnected(unit) local i = SLOT(unit); return i and ONLINE[MEMBERS[i]] end
    LIVE = {
      Kev = { readable = true, elixirs = {}, flask = "Flask of the Titans", food = "Well Fed" },
      Amy = { readable = true, elixirs = {}, flask = "Flask of Power", food = "Well Fed" },
      Bob = { readable = true, elixirs = {}, food = "Well Fed" },
      Dee = { readable = false, elixirs = {} }
    }
    UNIT_TO_NAME = function(unit) if unit == "player" then return "Kev" end local i = SLOT(unit); return i and MEMBERS[i] end
    SENT = {}
    CHAT = {}
    C_ChatInfo = { SendChatMessage = function(text, channel) CHAT[#CHAT + 1] = channel .. ":" .. text end, RegisterAddonMessagePrefix = function() end, SendAddonMessage = function() end }
    DB = {
      readiness = { Kev = { status = "READY", inspectedAt = "2026-09-26T11:59:00Z", findings = {} } },
      peerRoster = {
        Amy = { status = "READY", missing = 0, minDurability = 100, flags = "", seenAt = NOW - 60 },
        Bob = { status = "PARTIAL", missing = 0, minDurability = 100, flags = "NOFLASK,ENCH:Chest+Legs", seenAt = NOW - 90 * 60 },
        Cy = { status = "READY", missing = 0, minDurability = 100, flags = "", seenAt = NOW - 60 }
      }
    }
    NS = {
      L = function(text) return text end,
      isSecret = function() return false end,
      normalizeName = function(n) return n end,
      playerName = function() return "Kev" end,
      isOfficer = function() return true end,
      getDb = function() return DB end,
      message = function(text) CHAT_LOG = CHAT_LOG or {}; CHAT_LOG[#CHAT_LOG + 1] = text end,
      send = function(text, channel) SENT[#SENT + 1] = channel .. ":" .. text end,
      commandHandlers = {}, commandHelp = {},
      consumables = {
        scanUnit = function(unit) return LIVE[UNIT_TO_NAME(unit)] or { readable = false, elixirs = {} } end,
        hasElixirOrFlask = function(r) return r.flask ~= nil or #r.elixirs > 0 end
      }
    }
  `);
  session.load("Modules/Ready.lua");
  return session;
}

const rows = (s: LuaSession) => s.run(`local out = {}; for _, r in ipairs(NS.ready.collect().rows) do out[#out + 1] = r.name .. "=" .. r.status .. "[" .. table.concat(r.reasons, ";") .. "]" end; return table.concat(out, " ")`);

describe("Ready.lua", () => {
  it("turns an ISO time into seconds", () => {
    const s = withRaid();
    expect(s.run(`return NS.ready.epoch("1970-01-01T00:00:00Z")`)).toBe("0");
    expect(s.run(`return NS.ready.epoch("2026-09-26T12:00:00Z")`)).toBe(String(NOW));
    expect(s.run(`return tostring(NS.ready.epoch("nonsense"))`)).toBe("nil");
  });

  it("lists the group worst first, with the reasons", () => {
    const s = withRaid();
    expect(rows(s)).toBe("Bob=PARTIAL[no enchant: Chest, Legs;no flask;data 90 min old] Cy=NODATA[offline] Dee=NODATA[no addon data] Amy=READY[] Kev=READY[]");
  });

  it("counts them and says it in one line", () => {
    const s = withRaid();
    expect(s.run(`return NS.ready.summary(NS.ready.collect())`)).toBe("2 ready, 1 with issues, 0 not ready, 2 no data");
  });

  it("fresh buffs replace what an addon shared earlier", () => {
    const s = withRaid();
    s.run(`DB.peerRoster.Bob.flags = "NOFLASK,NOFOOD"; LIVE.Bob = { readable = true, elixirs = {}, flask = "Flask of Power", food = "Well Fed" }; DB.peerRoster.Bob.seenAt = NOW`);
    expect(rows(s)).toContain("Bob=READY[]");
  });

  it("a missing food seen live makes a player Issues even without an addon", () => {
    const s = withRaid();
    s.run(`LIVE.Dee = { readable = true, elixirs = {}, flask = "Flask of Power" }`);
    expect(rows(s)).toContain("Dee=PARTIAL[no food]");
  });

  it("empty gear slots or a NOT_READY report are Not ready and sort first", () => {
    const s = withRaid();
    s.run(`DB.peerRoster.Amy = { status = "NOT_READY", missing = 2, minDurability = 15, flags = "", seenAt = NOW }`);
    expect(rows(s).startsWith("Amy=NOT_READY[2 empty slot(s);durability 15%]")).toBe(true);
  });

  it("outside a raid, flask and food are not required", () => {
    const s = withRaid();
    s.run(`function IsInRaid() return false end; function IsInGroup() return true end; DB.peerRoster.Bob.flags = ""; DB.peerRoster.Bob.seenAt = NOW; LIVE.Bob = { readable = true, elixirs = {} }`);
    expect(s.run(`local p = NS.ready.collect(); return tostring(p.inRaid) .. tostring(p.inGroup)`)).toBe("falsetrue");
    expect(s.run(`local out = {}; for _, r in ipairs(NS.ready.collect().rows) do if r.name == "Bob" then out[#out + 1] = r.status end end; return out[1]`)).toBe("READY");
  });

  it("solo: shows just you", () => {
    const s = withRaid();
    s.run(`function IsInRaid() return false end; function IsInGroup() return false end`);
    expect(s.run(`local p = NS.ready.collect(); return #p.rows .. ":" .. tostring(p.inGroup)`)).toBe("1:false");
  });

  it("asks every addon in the group to check, once per 20 seconds", () => {
    const s = withRaid();
    s.run(`NS.ready.ask(); NS.ready.ask()`);
    expect(s.run(`return #SENT`)).toBe("1");
    expect(s.run(`return SENT[1]:sub(1, 14)`)).toBe("RAID:READYREQ|");
    s.run(`NOW = NOW + 25; NS.ready.ask()`);
    expect(s.run(`return #SENT`)).toBe("2");
    s.run(`function IsInRaid() return false end; function IsInGroup() return false end; NOW = NOW + 60; NS.ready.ask()`);
    expect(s.run(`return #SENT`)).toBe("2");
  });

  it("only officers, the group leader and assistants can use it", () => {
    const s = withRaid();
    expect(s.run(`return tostring(NS.ready.canView())`)).toBe("true");
    s.run(`NS.isOfficer = function() return false end`);
    expect(s.run(`return tostring(NS.ready.canView())`)).toBe("false");
    s.run(`NS.commandHandlers["ready"]({})`);
    expect(s.chat().join(" ")).toContain("Only officers and group leaders");
    s.run(`function UnitIsGroupAssistant(unit) return unit == "player" end`);
    expect(s.run(`return tostring(NS.ready.canView())`)).toBe("true");
    s.run(`function UnitIsGroupAssistant() return false end; function UnitIsGroupLeader(unit) return unit == "Amy" end`);
    expect(s.run(`return tostring(NS.ready.isRequester("Amy")) .. tostring(NS.ready.isRequester("Bob"))`)).toBe("truefalse");
  });

  it("posts a summary and the problems to the raid, only for those who may", () => {
    const s = withRaid();
    s.run(`NS.ready.post()`);
    expect(s.run(`return CHAT[1]`)).toBe("RAID:[Guilded] 2 ready, 1 with issues, 0 not ready, 2 no data");
    expect(s.run(`return CHAT[2]`)).toBe("RAID:[Guilded] Bob (no enchant: Chest, Legs, no flask, data 90 min old)");
    s.run(`CHAT = {}; NS.isOfficer = function() return false end; NS.ready.post()`);
    expect(s.run(`return #CHAT`)).toBe("0");
  });

  it("splits a long problem list over several lines", () => {
    const s = withRaid();
    const lines = JSON.parse(s.run(`
      local result = { rows = {}, counts = { READY = 0, PARTIAL = 30, NOT_READY = 0, NODATA = 0 } }
      for i = 1, 30 do result.rows[i] = { name = "Player" .. i, status = "PARTIAL", reasons = { "no flask", "no food" } } end
      local out = {}
      for i, l in ipairs(NS.ready.postLines(result)) do out[i] = string.format("%q", l) end
      return "[" .. table.concat(out, ",") .. "]"`)) as string[];
    expect(lines.length).toBeGreaterThan(2);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(255);
  });

  it("/guilded ready prints the summary and who needs attention", () => {
    const s = withRaid();
    s.run(`NS.commandHandlers["ready"]({})`);
    const text = s.chat().join("\n");
    expect(text).toContain("2 ready, 1 with issues, 0 not ready, 2 no data");
    expect(text).toContain("Bob: Issues - no enchant: Chest, Legs, no flask, data 90 min old");
    expect(text).not.toContain("Amy:");
  });
});

// The same raid with the real scanner and data: Kev (me, priest), Amy (warrior), Bob (mage).
function withScanner(): LuaSession {
  session = newLuaSession();
  session.run(String.raw`
    NOW = ${NOW}
    GetServerTime = function() return NOW end
    GetTime = function() return 1000 end
    MEMBERS = { "Kev", "Amy", "Bob" }
    CLASSES = { Kev = "PRIEST", Amy = "WARRIOR", Bob = "MAGE" }
    IN_RAID = true
    function IsInRaid() return IN_RAID end
    function IsInGroup() return true end
    function GetNumGroupMembers() return #MEMBERS end
    function SLOT(unit) local r = tonumber(string.match(unit, "^raid(%d+)$")); return r end
    function NAME_OF(unit) if unit == "player" then return "Kev" end local i = SLOT(unit); return i and MEMBERS[i] end
    function UnitExists(unit) return NAME_OF(unit) ~= nil end
    function UnitName(unit) return NAME_OF(unit) end
    function UnitClass(unit) return "Class", CLASSES[NAME_OF(unit)] end
    function UnitIsConnected() return true end
    AURAS = {
      Kev = { { name = "Fortitude", spellId = 21562 }, { name = "Flacon", spellId = 1235108, expirationTime = 4600 }, { name = "Bien nourri", icon = 136000, expirationTime = 4600 }, { name = "Cri", spellId = 6673 }, { name = "Intel", spellId = 1459 } },
      Amy = { { name = "Fortitude", spellId = 21562 }, { name = "Flacon", spellId = 1235110, expirationTime = 4600 }, { name = "Bien nourri", icon = 136000, expirationTime = 4600 }, { name = "Cri", spellId = 6673 }, { name = "Intel", spellId = 1459 } },
      Bob = { { name = "Fortitude", spellId = 21562 }, { name = "Flacon", spellId = 1235057, expirationTime = 4600 }, { name = "Bien nourri", icon = 136000, expirationTime = 4600 }, { name = "Cri", spellId = 6673 }, { name = "Intel", spellId = 1459 } }
    }
    C_UnitAuras = { GetAuraDataByIndex = function(unit, index) local a = AURAS[NAME_OF(unit)]; return a and a[index] end }
    SENT = {}; CHAT = {}; INSPECTED = 0
    C_ChatInfo = { SendChatMessage = function(text, channel) CHAT[#CHAT + 1] = channel .. ":" .. text end }
    DB = { readiness = {}, peerRoster = {} }
    SETTINGS = {}
    NS = {
      L = function(text) return text end,
      isSecret = function() return false end,
      normalizeName = function(n) return (string.match(n, "^([^%-]+)")) end,
      playerName = function() return "Kev" end,
      isOfficer = function() return true end,
      getDb = function() return DB end,
      getSettings = function() return SETTINGS end,
      message = function(text) CHAT_LOG = CHAT_LOG or {}; CHAT_LOG[#CHAT_LOG + 1] = text end,
      send = function(text, channel) SENT[#SENT + 1] = channel .. ":" .. text end,
      inspectReadiness = function() INSPECTED = INSPECTED + 1 end,
      commandHandlers = {}, commandHelp = {}
    }
  `);
  for (const file of ["Modules/ConsumableData.lua", "Modules/Consumables.lua", "Modules/Ready.lua"]) session.load(file);
  return session;
}
const row = (s: LuaSession, name: string) => s.run(`for _, r in ipairs(NS.ready.collect().rows) do if r.name == "${name}" then return r.status .. "[" .. table.concat(r.reasons, ";") .. "]" end end`);
const cell = (s: LuaSession, name: string, key: string) => s.run(`for _, r in ipairs(NS.ready.collect().rows) do if r.name == "${name}" then return tostring(r.cells.${key}) end end`);

describe("Ready.lua: reading buffs by id, in any language", () => {
  it("everyone with a flask, food and the buff of every class present is ready", () => {
    const s = withScanner();
    expect(row(s, "Amy")).toBe("READY[]");
    expect(row(s, "Bob")).toBe("READY[]");
    expect(cell(s, "Amy", "flask")).toBe("ok");
    expect(cell(s, "Amy", "buffs")).toBe("ok");
  });

  it("a flask that is running out is flagged with the minutes left", () => {
    const s = withScanner();
    s.run(`AURAS.Bob[2].expirationTime = 1000 + 250`);
    expect(row(s, "Bob")).toBe("PARTIAL[flask ends in 5 min]");
    expect(cell(s, "Bob", "flask")).toBe("warn");
    s.run(`SETTINGS.readyChecks = { expiry = 0 }`);
    expect(row(s, "Bob")).toBe("READY[]");
  });

  it("a real missing flask or food is Issues", () => {
    const s = withScanner();
    s.run(`table.remove(AURAS.Amy, 3); table.remove(AURAS.Bob, 2)`);
    expect(row(s, "Amy")).toBe("PARTIAL[no food]");
    expect(row(s, "Bob")).toBe("PARTIAL[no flask]");
  });

  it("a raid buff is only asked of players when someone can give it", () => {
    const s = withScanner();
    // Bob lacks Stamina and a priest is here: blamed.
    s.run(`table.remove(AURAS.Bob, 1)`);
    expect(row(s, "Bob")).toBe("PARTIAL[no raid buff: Stamina]");
    expect(cell(s, "Bob", "buffs")).toBe("bad");
    // With the priest gone nobody can give Stamina, so nobody is blamed.
    s.run(`CLASSES.Kev = "ROGUE"`);
    expect(row(s, "Bob")).toBe("READY[]");
    s.run(`SETTINGS.readyChecks = { buffs = false }; CLASSES.Kev = "PRIEST"`);
    expect(row(s, "Bob")).toBe("READY[]");
    expect(cell(s, "Bob", "buffs")).toBe("none");
  });
});

describe("Ready.lua: hidden is unknown, never missing", () => {
  it("buffs the game hides, and no report, is 'no data' with the reason", () => {
    const s = withScanner();
    s.run(`AURAS.Bob = { {} }`);
    expect(row(s, "Bob")).toBe("NODATA[buffs hidden by the game]");
    expect(cell(s, "Bob", "flask")).toBe("unknown");
  });

  it("the player's own report fills in what cannot be read, weapon enchant and durability included", () => {
    const s = withScanner();
    s.run(`AURAS.Bob = { {} }; SETTINGS.readyChecks = { weapon = true }`);
    expect(s.run(`return tostring(NS.ready.handleReport("CONSUME|Bob|F=3000|D=3000|W=0|U=12", "RAID", "Bob-Realm"))`)).toBe("true");
    expect(row(s, "Bob")).toBe("PARTIAL[durability 12%;no weapon enchant]");
    expect(cell(s, "Bob", "flask")).toBe("ok");
    expect(cell(s, "Bob", "weapon")).toBe("bad");
    s.run(`NS.ready.handleReport("CONSUME|Bob|F=3000|D=3000|W=1800|U=95", "RAID", "Bob-Realm")`);
    expect(row(s, "Bob")).toBe("READY[]");
    s.run(`NS.ready.handleReport("CONSUME|Bob|F=3000|D=3000|W=120|U=95", "RAID", "Bob-Realm")`);
    expect(row(s, "Bob")).toBe("PARTIAL[weapon enchant ends in 2 min]");
  });

  it("a report is only taken from the player it is about, through the group channel", () => {
    const s = withScanner();
    const take = (text: string, channel: string, sender: string) => s.run(`return tostring(NS.ready.handleReport("${text}", "${channel}", "${sender}"))`);
    expect(take("CONSUME|Bob|F=0", "WHISPER", "Bob-Realm")).toBe("false");
    expect(take("CONSUME|Bob|F=0", "GUILD", "Bob-Realm")).toBe("false");
    expect(take("CONSUME|Bob|F=0", "RAID", "Amy-Realm")).toBe("false");
    expect(take("READINESS|Bob|READY", "RAID", "Bob-Realm")).toBe("false");
    expect(take("CONSUME|Bob|F=0", "PARTY", "Bob-Realm")).toBe("true");
  });

  it("an old report is ignored", () => {
    const s = withScanner();
    s.run(`AURAS.Bob = { {} }; NS.ready.handleReport("CONSUME|Bob|F=0|D=0", "RAID", "Bob-Realm"); NOW = NOW + 20 * 60`);
    expect(row(s, "Bob")).toBe("NODATA[buffs hidden by the game]");
  });
});

describe("Ready.lua: it runs by itself", () => {
  const sent = (s: LuaSession) => s.run(`local out = {}; for _, m in ipairs(SENT) do out[#out + 1] = m end; return table.concat(out, "|NEXT|")`);
  const runNow = `C_Timer = { After = function(_, fn) fn() end }`;

  it("when a ready check starts, every addon looks at itself and reports to the group", () => {
    const s = withScanner();
    s.run(`${runNow}; NS.ready.onReadyCheck("raid2", 30)`);
    expect(s.run(`return INSPECTED`)).toBe("1");
    expect(sent(s)).toBe("RAID:CONSUME|Kev|F=3600|D=3600|R=0|V=0|B=ap,int,sta");
  });

  it("it never reports in combat, and a solo player does not report", () => {
    const s = withScanner();
    s.run(`${runNow}; InCombatLockdown = function() return true end; NS.ready.onReadyCheck("raid2", 30)`);
    expect(sent(s)).toBe("");
    s.run(`InCombatLockdown = function() return false end; IN_RAID = false; function IsInGroup() return false end; NS.ready.onReadyCheck("raid2", 30)`);
    expect(sent(s)).toBe("");
  });

  it("follows Blizzard's answers: ready, not ready, and no answer once it is over", () => {
    const s = withScanner();
    s.run(`NS.ready.onReadyCheck("raid2", 30); NS.ready.onReadyCheckConfirm("raid3", false)`);
    expect(cell(s, "Amy", "rc")).toBe("ready");     // the one who asked
    expect(cell(s, "Bob", "rc")).toBe("notready");
    expect(cell(s, "Kev", "rc")).toBe("waiting");
    expect(row(s, "Bob")).toBe("NOT_READY[said not ready]");
    s.run(`NS.ready.onReadyCheckFinished(false)`);
    expect(cell(s, "Kev", "rc")).toBe("silent");
    expect(row(s, "Kev")).toBe("READY[no ready check answer]");
    // Long after, it is no longer shown.
    s.run(`NOW = NOW + 3600`);
    expect(cell(s, "Kev", "rc")).toBe("nil");
  });

  it("when the check ends the leader is told who has a problem, unless turned off", () => {
    const s = withScanner();
    s.run(`${runNow}; table.remove(AURAS.Bob, 2); NS.ready.onReadyCheck("raid2", 30); NS.ready.onReadyCheckFinished(false)`);
    const text = s.chat().join("\n");
    expect(text).toContain("2 ready, 1 with issues, 0 not ready, 0 no data");
    expect(text).toContain("Bob (no flask");
    s.run(`CHAT_LOG = {}; SETTINGS.readyChecks = { report = false }; NS.ready.onReadyCheckFinished(false)`);
    expect(s.chat().join("\n")).toBe("");
  });

  it("it can also tell the group when asked to (autopost)", () => {
    const s = withScanner();
    s.run(`${runNow}; SETTINGS.readyChecks = { autopost = true }; table.remove(AURAS.Bob, 2); NS.ready.onReadyCheck("raid2", 30); NS.ready.onReadyCheckFinished(false)`);
    expect(s.run(`return CHAT[1]`)).toContain("RAID:[Guilded] 2 ready, 1 with issues");
  });

  it("when a buff changes it reports again, once, and not for the clock ticking", () => {
    const s = withScanner();
    s.run(`${runNow}; NS.ready.broadcastSelf(); SENT = {}`);
    // Nothing changed except time: nothing sent.
    s.run(`NOW = NOW + 60; fire_event("UNIT_AURA", "player")`);
    expect(sent(s)).toBe("");
    // The food is gone: told to the group.
    s.run(`NOW = NOW + 60; table.remove(AURAS.Kev, 3); fire_event("UNIT_AURA", "player")`);
    expect(sent(s)).toBe("RAID:CONSUME|Kev|F=3600|D=0|R=0|V=0|B=ap,int,sta");
    // Same again a moment later: nothing new.
    s.run(`SENT = {}; NOW = NOW + 60; fire_event("UNIT_AURA", "player")`);
    expect(sent(s)).toBe("");
  });

  it("joining a group tells it what you carry, at most every 30 seconds", () => {
    const s = withScanner();
    s.run(`${runNow}; fire_event("GROUP_ROSTER_UPDATE"); fire_event("GROUP_ROSTER_UPDATE")`);
    expect(s.run(`return #SENT`)).toBe("1");
  });

  it("the consumables module off means no reporting at all", () => {
    const s = withScanner();
    s.run(`${runNow}; NS.moduleActive = function() return false end; NS.ready.onReadyCheck("raid2", 30)`);
    expect(sent(s)).toBe("");
  });
});

describe("Ready.lua: what the leader requires", () => {
  it("officers change it with /guilded ready require, others cannot", () => {
    const s = withScanner();
    s.run(`NS.commandHandlers["ready"]({ "require", "weapon", "on" })`);
    expect(s.run(`return tostring(NS.ready.setting("weapon"))`)).toBe("true");
    s.run(`NS.commandHandlers["ready"]({ "expiry", "3" }); NS.commandHandlers["ready"]({ "durability", "0" })`);
    expect(s.run(`return NS.ready.setting("expiry") .. "/" .. NS.ready.setting("durability")`)).toBe("3/0");
    s.run(`NS.commandHandlers["ready"]({ "require", "nonsense", "on" }); NS.commandHandlers["ready"]({ "expiry", "-5" })`);
    expect(s.run(`return NS.ready.setting("expiry")`)).toBe("3");
    // Not an officer, but the leader: sees the page, cannot change the rules.
    s.run(`NS.isOfficer = function() return false end; function UnitIsGroupLeader(unit) return unit == "player" end; NS.commandHandlers["ready"]({ "require", "weapon", "off" })`);
    expect(s.run(`return tostring(NS.ready.setting("weapon"))`)).toBe("true");
    expect(s.chat().join("\n")).toContain("Only officers change what the ready check requires.");
  });

  it("an unrequired check that is missing is grey, not a problem", () => {
    const s = withScanner();
    s.run(`NS.ready.handleReport("CONSUME|Bob|F=3000|D=3000|W=0|R=0|V=0", "RAID", "Bob-Realm")`);
    expect(row(s, "Bob")).toBe("READY[]");
    expect(cell(s, "Bob", "weapon")).toBe("none");
    expect(cell(s, "Bob", "augment")).toBe("none");
  });
});

describe("officers' Gear page", () => {
  it("lists each member's shared item level, missing gear and enchants, best first, and drops month-old checks", () => {
    const s = withRaid();
    s.run(`
      DB.readiness.Kev.itemLevel = 60.5
      DB.peerRoster.Amy.flags = "IL:62"
      DB.peerRoster.Amy.identity = { class = "PRIEST", level = 60 }
      DB.peerRoster.Bob.flags = "IL:55,NOFLASK,ENCH:Chest+Legs"
      DB.peerRoster.Bob.missing = 1
      DB.peerRoster.Cy.seenAt = NOW - 40 * 86400
    `);
    expect(s.run(`local n = {}; for _, r in ipairs(NS.ready.gearRows(NOW)) do n[#n + 1] = r.name .. ":" .. tostring(r.itemLevel) end; return table.concat(n, ",")`))
      .toBe("Amy:62,Kev:61,Bob:55");
    const text = s.run(`return NS.ready.gearText(NOW)`);
    expect(text).toContain("Amy|r  level 60");
    expect(text).toContain("item level 62");
    expect(text).toMatch(/Bob\|r .*1 missing.*no enchant: Chest, Legs/);
    expect(text).not.toContain("Cy");
  });

  it("explains an empty list", () => {
    const s = withRaid();
    s.run(`DB.peerRoster = {}; DB.readiness = {}`);
    expect(s.run(`return NS.ready.gearText(NOW)`)).toContain("Nobody has shared a gear check yet");
  });
});
