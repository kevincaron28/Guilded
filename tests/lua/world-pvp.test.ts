import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

// World PvP stats (Modules/WorldPvP.lua): open-world kills, deaths, defends and calls for help.
let s: LuaSession | undefined;
afterEach(() => s?.close());

const WEEK = 7 * 86400;

function setup() {
  s = newLuaSession();
  s.run(`CLOCK = 1000; EPOCH = 1800000000; INST = false; ATTACKED = false; MSGS = {}; DB = {}
    function GetTime() return CLOCK end
    function GetServerTime() return EPOCH end
    function IsInInstance() return INST end
    ZONE = "Silverpine Forest"
    function GetRealZoneText() return ZONE end
    COMBATLOG_HONORGAIN = "%s dies, honorable kill Rank: %s (%d Honor Points)"
    NS = { util = {}, commandHandlers = {}, commandHelp = {},
      message = function(text) MSGS[#MSGS + 1] = text end,
      isSecret = function() return false end,
      getDb = function() return DB end,
      callForHelp = { attacked = function() return ATTACKED end } }`);
  s.load("Locale.lua");
  s.load("Modules/WorldPvP.lua");
  return s;
}
const kill = (name = "Thug") => s!.run(`return tostring(NS.worldPvp.noteKill("${name} dies, honorable kill Rank: Private (12 Honor Points)"))`);
const stat = (scope: "week" | "total", field: string) =>
  s!.run(`local w, t = NS.worldPvp.stats(); return tostring(${scope === "week" ? "w" : "t"}.${field})`);

describe("world PvP kills", () => {
  it("counts an honorable kill from the game's own line and remembers the victim and zone", () => {
    setup();
    expect(kill("Thug")).toBe("true");
    expect(stat("week", "kills")).toBe("1");
    expect(stat("total", "kills")).toBe("1");
    expect(s!.run(`return DB.worldPvp.recent[1].n .. "|" .. DB.worldPvp.recent[1].z`)).toBe("Thug|Silverpine Forest");
  });

  it("ignores lines that are not kills, secret text and kills inside instances or battlegrounds", () => {
    setup();
    expect(s!.run(`return tostring(NS.worldPvp.noteKill("You gain 10 reputation"))`)).toBe("false");
    expect(s!.run(`return tostring(NS.worldPvp.noteKill(nil))`)).toBe("false");
    s!.run(`INST = true`);
    expect(kill()).toBe("false");
    expect(stat("total", "kills")).toBe("0");
  });

  it("counts the same victim once within five seconds, and again later", () => {
    setup();
    kill("Thug");
    s!.run(`CLOCK = CLOCK + 2`);
    expect(kill("Thug")).toBe("false");
    s!.run(`CLOCK = CLOCK + 10`);
    expect(kill("Thug")).toBe("true");
    expect(kill("Other")).toBe("true");
    expect(stat("total", "kills")).toBe("3");
  });

  it("counts through the game event as well", () => {
    setup();
    s!.run(`fire_event("CHAT_MSG_COMBAT_HONOR_GAIN", "Thug dies, honorable kill Rank: Private (12 Honor Points)")`);
    expect(stat("total", "kills")).toBe("1");
  });

  it("keeps only the last thirty kills", () => {
    setup();
    for (let i = 0; i < 35; i++) { kill(`Victim${i}`); s!.run(`CLOCK = CLOCK + 10`); }
    expect(s!.run(`return tostring(#DB.worldPvp.recent)`)).toBe("30");
    expect(stat("total", "kills")).toBe("35");
  });
});

describe("world PvP deaths, calls and defends", () => {
  it("counts a death only after a confirmed attack by an enemy player, once a minute", () => {
    setup();
    expect(s!.run(`return tostring(NS.worldPvp.noteDeath())`)).toBe("false");
    s!.run(`ATTACKED = true`);
    expect(s!.run(`return tostring(NS.worldPvp.noteDeath())`)).toBe("true");
    expect(s!.run(`return tostring(NS.worldPvp.noteDeath())`)).toBe("false");
    s!.run(`CLOCK = CLOCK + 90`);
    s!.run(`fire_event("PLAYER_DEAD")`);
    expect(stat("total", "deaths")).toBe("2");
  });

  it("counts calls made, calls answered and calls I answered", () => {
    setup();
    s!.run(`NS.worldPvp.note("call"); NS.worldPvp.note("answered"); NS.worldPvp.note("answered"); NS.worldPvp.note("responded")`);
    expect(stat("week", "calls")).toBe("1");
    expect(stat("week", "answered")).toBe("2");
    expect(stat("week", "responded")).toBe("1");
    expect(s!.run(`return tostring(NS.worldPvp.note("nonsense"))`)).toBe("false");
  });

  it("counts a kill within five minutes of On my way as a defend, and not later", () => {
    setup();
    s!.run(`NS.worldPvp.note("responded")`);
    expect(s!.run(`return tostring(NS.worldPvp.defending())`)).toBe("true");
    kill("Thug");
    expect(stat("total", "defends")).toBe("1");
    expect(s!.run(`return tostring(DB.worldPvp.recent[1].d)`)).toBe("1");
    s!.run(`CLOCK = CLOCK + 301`);
    expect(s!.run(`return tostring(NS.worldPvp.defending())`)).toBe("false");
    kill("Later");
    expect(stat("total", "defends")).toBe("1");
    expect(stat("total", "kills")).toBe("2");
  });

  it("counts a defend only in the zone the call named", () => {
    setup();
    s!.run(`NS.worldPvp.note("responded", "Duskwood")`);
    expect(s!.run(`return tostring(NS.worldPvp.defending())`)).toBe("false"); // still in Silverpine Forest
    kill("Elsewhere");
    expect(stat("total", "defends")).toBe("0");
    s!.run(`ZONE = "Duskwood"; CLOCK = CLOCK + 10`);
    expect(s!.run(`return tostring(NS.worldPvp.defending())`)).toBe("true");
    kill("Here");
    expect(stat("total", "defends")).toBe("1");
    expect(stat("total", "kills")).toBe("2");
  });

  it("compares map ids first, so a French helper and an English caller still match", () => {
    setup();
    s!.run(`MYMAP = 47; NS.guildMap = { myPosition = function() return MYMAP, 0.5, 0.5 end }; ZONE = "Bois de la Penombre"`);
    s!.run(`NS.worldPvp.note("responded", "Duskwood", 47)`);
    expect(s!.run(`return tostring(NS.worldPvp.defending())`)).toBe("true");
    kill("Here");
    expect(stat("total", "defends")).toBe("1");
    s!.run(`MYMAP = 48; CLOCK = CLOCK + 10`);
    expect(s!.run(`return tostring(NS.worldPvp.defending())`)).toBe("false");
    kill("Elsewhere");
    expect(stat("total", "defends")).toBe("1");
  });
  it("falls back to the zone name when a side has no map id, and cuts a long name like the call does", () => {
    setup();
    const long = "The Hinterlands Northern Reaches Of The Wild";
    s!.run(`ZONE = "${long}"; NS.worldPvp.note("responded", string.sub("${long}", 1, 28), 0)`);
    expect(s!.run(`return tostring(NS.worldPvp.defending())`)).toBe("true");
    s!.run(`NS.guildMap = { myPosition = function() return nil end }; NS.worldPvp.note("responded", "Duskwood", 47)`);
    expect(s!.run(`return tostring(NS.worldPvp.defending())`)).toBe("false"); // my map unknown, name differs
    s!.run(`ZONE = "Duskwood"`);
    expect(s!.run(`return tostring(NS.worldPvp.defending())`)).toBe("true");
  });
});

describe("world PvP weeks and the readout", () => {
  it("starts a new week at the Tuesday reset and keeps the totals", () => {
    setup();
    kill("Thug");
    s!.run(`EPOCH = EPOCH + ${WEEK}`);
    expect(stat("week", "kills")).toBe("0");
    expect(stat("total", "kills")).toBe("1");
    s!.run(`CLOCK = CLOCK + 10`);
    kill("Again");
    expect(stat("week", "kills")).toBe("1");
    expect(stat("total", "kills")).toBe("2");
  });

  it("keeps the week that just ended so a session across the reset still uploads it", () => {
    setup();
    kill("Thug"); kill("Other");
    const key = s!.run(`return tostring(NS.worldPvp.weekKey())`);
    s!.run(`EPOCH = EPOCH + ${WEEK}; CLOCK = CLOCK + 10`);
    kill("Again");
    expect(stat("week", "kills")).toBe("1");
    expect(s!.run(`return DB.worldPvp.prev.weekKey .. ":" .. DB.worldPvp.prev.week.kills`)).toBe(`${key}:2`);
    // Two weeks on, it is dropped.
    s!.run(`EPOCH = EPOCH + ${WEEK}; CLOCK = CLOCK + 10`);
    kill("Late");
    expect(s!.run(`return DB.worldPvp.prev.week.kills`)).toBe("1");
    s!.run(`EPOCH = EPOCH + 2 * ${WEEK}; CLOCK = CLOCK + 10`);
    kill("Gone");
    expect(s!.run(`return tostring(DB.worldPvp.prev)`)).toBe("nil");
  });

  it("prints this week and the total with /guilded worldpvp", () => {
    setup();
    kill("Thug");
    s!.run(`NS.worldPvp.note("call"); NS.commandHandlers.worldpvp()`);
    const out = s!.run(`return table.concat(MSGS, " | ")`);
    expect(out).toContain("World PvP this week: 1 kills, 0 deaths, 0 defends. Calls for help: 1 made (0 answered), 0 answered by me.");
    expect(out).toContain("World PvP in total: 1 kills");
    expect(s!.run(`return tostring(NS.commandHandlers.wpvp == NS.commandHandlers.worldpvp)`)).toBe("true");
  });

  it("does nothing when the module is turned off", () => {
    setup();
    s!.run(`NS.moduleActive = function() return false end`);
    expect(kill()).toBe("false");
    expect(s!.run(`return tostring(NS.worldPvp.note("call"))`)).toBe("false");
    expect(s!.run(`return tostring(DB.worldPvp)`)).toBe("nil");
  });
});

describe("world PvP deaths: zone, K/D and what never counts", () => {
  const die = () => s!.run(`CLOCK = CLOCK + 90; return tostring(NS.worldPvp.noteDeath())`);

  it("keeps the zone and time of a death, never the killer", () => {
    setup();
    s!.run(`ATTACKED = true`);
    expect(die()).toBe("true");
    expect(s!.run(`local d = DB.worldPvp.deathsRecent[1]; return d.z .. "|" .. tostring(d.at) .. "|" .. tostring(d.n) .. "|" .. tostring(d.c)`)).toBe("Silverpine Forest|1800000000|nil|nil");
    expect(s!.run(`return DB.worldPvp.zones["Silverpine Forest"]`)).toBe("1");
  });

  it("counts nothing for a creature, a fall or a duel (no confirmed enemy-player attack)", () => {
    setup();
    s!.run(`ATTACKED = false`);
    expect(die()).toBe("false");
    expect(stat("total", "deaths")).toBe("0");
    expect(s!.run(`return tostring(DB.worldPvp.zones)`)).toBe("nil");
  });

  it("counts nothing in a battleground, arena, dungeon or raid", () => {
    setup();
    s!.run(`ATTACKED = true; INST = true`);
    expect(die()).toBe("false");
    expect(stat("total", "deaths")).toBe("0");
    s!.run(`INST = false`);
    expect(die()).toBe("true");
  });

  it("computes K/D and lists the deadliest zones, most first", () => {
    setup();
    s!.run(`ATTACKED = true`);
    kill("A"); s!.run(`CLOCK = CLOCK + 10`); kill("B"); s!.run(`CLOCK = CLOCK + 10`); kill("C"); s!.run(`CLOCK = CLOCK + 10`); kill("D");
    die();
    s!.run(`ZONE = "Hillsbrad Foothills"`); die(); die();
    expect(s!.run(`return NS.worldPvp.kd(select(2, NS.worldPvp.stats()))`)).toBe("1.3");
    expect(s!.run(`local z = NS.worldPvp.deadliestZones(2); return z[1].zone .. z[1].deaths .. "|" .. z[2].zone .. z[2].deaths`)).toBe("Hillsbrad Foothills2|Silverpine Forest1");
    s!.run(`NS.commandHandlers.worldpvp()`);
    const out = s!.run(`return table.concat(MSGS, " | ")`);
    expect(out).toContain("K/D: 1.3 this week, 1.3 in total.");
    expect(out).toContain("Deadliest zones: Hillsbrad Foothills (2), Silverpine Forest (1).");
  });

  it("shows kills as K/D with no deaths and prints no extra lines", () => {
    setup();
    kill("A");
    expect(s!.run(`return NS.worldPvp.kd(select(2, NS.worldPvp.stats()))`)).toBe("1.0");
    expect(s!.run(`return #NS.worldPvp.details()`)).toBe("0");
  });

  it("keeps at most 25 zones, dropping the least deadly", () => {
    setup();
    s!.run(`ATTACKED = true`);
    for (let i = 1; i <= 30; i++) { s!.run(`ZONE = "Zone ${i}"`); die(); }
    expect(s!.run(`local n = 0; for _ in pairs(DB.worldPvp.zones) do n = n + 1 end; return n`)).toBe("25");
    expect(s!.run(`return #DB.worldPvp.deathsRecent <= 30 and "ok" or "many"`)).toBe("ok");
  });

  it("loads saved data from before deaths had zones", () => {
    setup();
    s!.run(`DB.worldPvp = { total = { kills = 5, deaths = 2, defends = 0, calls = 0, answered = 0, responded = 0 }, week = { kills = 1, deaths = 1, defends = 0, calls = 0, answered = 0, responded = 0 }, weekKey = NS.worldPvp.weekKey(), recent = {} }`);
    expect(s!.run(`return NS.worldPvp.kd(select(2, NS.worldPvp.stats()))`)).toBe("2.5");
    expect(s!.run(`return #NS.worldPvp.deadliestZones()`)).toBe("0");
    s!.run(`ATTACKED = true`);
    expect(die()).toBe("true");
    expect(stat("total", "deaths")).toBe("3");
    expect(s!.run(`return NS.worldPvp.details()[2]`)).toContain("Silverpine Forest (1)");
  });

  it("translates the two new lines", () => {
    setup();
    s!.run(`NS.getSettings = function() return { language = "fr" } end`);
    expect(s!.run(`return NS.L("K/D: %s this week, %s in total.")`)).toContain("cette semaine");
  });
});

describe("world PvP places", () => {
  const map = `COMBAT = false; POS = { x = 0.4567891, y = 0.25 }; MAPID = 1429
    function InCombatLockdown() return COMBAT end
    C_Map = { GetBestMapForUnit = function() return MAPID end,
      GetPlayerMapPosition = function() if not POS then return nil end return { GetXY = function() return POS.x, POS.y end } end }`;
  const events = () => s!.run(`local out = {}; for _, e in ipairs(DB.worldPvp.events or {}) do out[#out + 1] = table.concat({ e.k, tostring(e.m), tostring(e.x), tostring(e.y), tostring(e.a) }, ",") end; return table.concat(out, ";")`);

  it("keeps the map id and the position (4 decimals) with a kill and a death", () => {
    setup(); s!.run(map);
    kill("Thug");
    s!.run(`ATTACKED = true`);
    s!.run(`NS.worldPvp.noteDeath()`);
    expect(events()).toBe("kill,1429,0.4568,0.25,nil;death,1429,0.4568,0.25,nil");
    expect(s!.run(`return DB.worldPvp.recent[1].m .. "|" .. DB.worldPvp.recent[1].x`)).toBe("1429|0.4568");
  });

  it("gives every event a counter id that survives the list being pruned", () => {
    setup(); s!.run(map);
    kill("A"); s!.run(`CLOCK = CLOCK + 10`); kill("B");
    s!.run(`DB.worldPvp.events = { DB.worldPvp.events[2] }`);
    s!.run(`CLOCK = CLOCK + 10`); kill("C");
    expect(s!.run(`return DB.worldPvp.events[1].s .. "," .. DB.worldPvp.events[2].s`)).toBe("2,3");
  });

  it("uses the last position seen out of combat, marked approximate, when the game refuses", () => {
    setup(); s!.run(map);
    s!.run(`NS.worldPvp.sample(); POS = nil; COMBAT = true; CLOCK = CLOCK + 30`);
    kill("Thug");
    expect(events()).toBe("kill,1429,0.4568,0.25,1");
    s!.run(`CLOCK = CLOCK + 5000`);
    kill("Late");
    expect(events().split(";")[1]).toBe("kill,1429,nil,nil,nil");
  });

  it("keeps no map and no position in an instance, and no number for the map when the game gives none", () => {
    setup(); s!.run(map);
    s!.run(`INST = true`);
    expect(s!.run(`local p = NS.worldPvp.where(); return tostring(p.m) .. tostring(p.x)`)).toBe("nilnil");
    s!.run(`INST = false; C_Map.GetBestMapForUnit = function() return nil end`);
    kill("Thug");
    expect(events()).toBe("kill,nil,nil,nil,nil");
  });

  it("rejects any coordinate outside 0 to 1 and a 0,0 position, keeping only the map id", () => {
    setup(); s!.run(map);
    for (const pos of ["x = -0.2, y = 0.5", "x = 0.5, y = -0.2", "x = 1.2, y = 0.5", "x = 0.5, y = 1.01", "x = 0, y = 0"]) {
      s!.run(`DB.worldPvp = nil; POS = { ${pos} }; CLOCK = CLOCK + 10`);
      kill("Thug");
      expect(events(), pos).toBe("kill,1429,nil,nil,nil");
    }
  });

  it("starts from a saved file with no events (before 9.3.1) and keeps the ids after a reload", () => {
    setup(); s!.run(map);
    s!.run(`DB.worldPvp = { total = { kills = 2 }, week = {}, recent = {}, zones = {} }`);
    kill("A");
    expect(s!.run(`return DB.worldPvp.events[1].s .. "|" .. DB.worldPvp.seq`)).toBe("1|1");
    setup(); s!.run(map);
    s!.run(`DB.worldPvp = { events = { { k = "kill", t = 1800000000, m = 1429, s = 1 } }, seq = 1, recent = {}, zones = {}, total = {}, week = {} }`);
    s!.run(`CLOCK = CLOCK + 10`); kill("B");
    expect(s!.run(`return DB.worldPvp.events[1].s .. "," .. DB.worldPvp.events[2].s`)).toBe("1,2");
  });

  it("bounds the stored events by count and by age", () => {
    setup(); s!.run(map);
    for (let i = 0; i < 520; i++) { kill(`V${i}`); s!.run(`CLOCK = CLOCK + 10`); }
    expect(s!.run(`return #DB.worldPvp.events`)).toBe("500");
    s!.run(`EPOCH = EPOCH + 31 * 86400`);
    kill("Fresh");
    expect(s!.run(`return #DB.worldPvp.events`)).toBe("1");
  });

  it("drops the stored events and records nothing when the module is off", () => {
    setup(); s!.run(map);
    s!.run(`NS.moduleActive = function() return false end`);
    expect(kill("Thug")).toBe("false");
    s!.run(`DB.worldPvp = { events = { { k = "kill", t = 1, m = 1 } }, recent = { { n = "X", z = "Z", at = 1, m = 5, x = 0.1, y = 0.2, a = 1 } }, deathsRecent = { { z = "Z", at = 1, m = 5, x = 0.1, y = 0.2 } } }`);
    s!.run(`fire_event("PLAYER_ENTERING_WORLD")`);
    expect(s!.run(`return #(DB.worldPvp.events or {})`)).toBe("1"); // an event does not drop them, the timer does
    s!.run(`NS.worldPvp.tick(6)`);
    expect(s!.run(`return tostring(DB.worldPvp.events)`)).toBe("nil");
    expect(s!.run(`local r, d = DB.worldPvp.recent[1], DB.worldPvp.deathsRecent[1]; return table.concat({ tostring(r.m), tostring(r.x), tostring(r.y), tostring(r.a), tostring(d.m), tostring(d.x), tostring(d.y), r.z, d.z }, ",")`)).toBe("nil,nil,nil,nil,nil,nil,nil,Z,Z");
  });
});

describe("world PvP kills when the honor line is not readable (WoW Forever, 21 Nov 2026)", () => {
  // Evidence: the owner's SavedVariables had the honorable-kills milestone (hk:1) reached while worldPvp.total.kills stayed 0.
  function withStat() {
    setup();
    s!.run(`HK = 10; function GetPVPLifetimeStats() return HK end
      NS.worldPvp.baselineHK()`);
  }
  const statUp = () => s!.run(`HK = HK + 1; fire_event("PLAYER_PVP_KILLS_CHANGED")`);

  it("counts a kill from the honorable-kills statistic when no honor line arrives", () => {
    withStat();
    statUp();
    expect(stat("total", "kills")).toBe("1");
    expect(s!.run(`return DB.worldPvp.events[1].k .. "|" .. DB.worldPvp.recent[1].n:sub(1, 1)`)).toBe("kill|?");
  });

  it("counts a kill once when the honor line and the statistic both announce it, in either order", () => {
    withStat();
    s!.run(`fire_event("CHAT_MSG_COMBAT_HONOR_GAIN", "Thug dies, honorable kill Rank: Private (12 Honor Points)")`);
    statUp();
    expect(stat("total", "kills")).toBe("1");
    s!.run(`CLOCK = CLOCK + 30`);
    statUp();
    s!.run(`fire_event("CHAT_MSG_COMBAT_HONOR_GAIN", "Other dies, honorable kill Rank: Private (12 Honor Points)")`);
    expect(stat("total", "kills")).toBe("2");
  });

  it("does not count battleground kills raised by the statistic, nor later", () => {
    withStat();
    s!.run(`INST = true`);
    statUp();
    s!.run(`INST = false; CLOCK = CLOCK + 30`);
    s!.run(`fire_event("PLAYER_PVP_KILLS_CHANGED")`);
    expect(stat("total", "kills")).toBe("0");
  });

  it("keeps unnamed kills apart for the bot's repeat-victim limit", () => {
    withStat();
    for (let i = 0; i < 3; i++) { statUp(); s!.run(`CLOCK = CLOCK + 30`); }
    expect(s!.run(`return DB.worldPvp.recent[1].n ~= DB.worldPvp.recent[2].n and "distinct" or "same"`)).toBe("distinct");
  });
});

describe("world PvP victims (enrichment only; the statistic stays the one count)", () => {
  function withUnits() {
    setup();
    s!.run(`HK = 10; function GetPVPLifetimeStats() return HK end
      NS.worldPvp.baselineHK()
      UNITS = {}
      function UnitExists(u) return UNITS[u] ~= nil end
      function UnitIsPlayer(u) return UNITS[u] and UNITS[u].player ~= false end
      function UnitIsEnemy(a, u) return UNITS[u] and UNITS[u].enemy ~= false end
      function UnitCanAttack(a, u) return UNITS[u] and UNITS[u].enemy ~= false end
      function UnitIsDeadOrGhost(u) return UNITS[u] and UNITS[u].dead == true end
      function UnitFactionGroup(u) return u == "player" and "Alliance" or (UNITS[u] and UNITS[u].faction or "Horde") end
      function UnitName(u) return UNITS[u] and UNITS[u].name or "Tester" end
      function UnitClass(u) return "Mage", UNITS[u] and UNITS[u].class or "MAGE" end
      function UnitLevel(u) return UNITS[u] and UNITS[u].level or 12 end
      function GetGuildInfo(u) return UNITS[u] and UNITS[u].guild or nil end
      function UnitGUID(u) return u == "player" and "Player-1-ME" or (UNITS[u] and UNITS[u].guid) end
      function UnitIsMindControlled(u) return UNITS[u] and UNITS[u].mc == true end
      function see(u, t) UNITS[u] = t; fire_event(u == "target" and "PLAYER_TARGET_CHANGED" or "UPDATE_MOUSEOVER_UNIT") end`);
  }
  const enemy = () => `{ name = "Grim Rook", guid = "Player-1-AAA", class = "MAGE", level = 14, guild = "The Wolves" }`;
  const row = (i = 1) => s!.run(`local r = DB.worldPvp.recent[${i}]; return r.n .. "|" .. tostring(r.c) .. "|" .. tostring(r.l) .. "|" .. tostring(r.g)`);
  const statUp = () => s!.run(`HK = HK + 1; fire_event("PLAYER_PVP_KILLS_CHANGED")`);
  const unnamed = (i = 1) => s!.run(`return DB.worldPvp.recent[${i}].n:sub(1, 1)`) === "?";

  it("names the victim from the honor line and adds class, level and guild seen on the target", () => {
    withUnits();
    s!.run(`see("target", ${enemy()})`);
    s!.run(`fire_event("CHAT_MSG_COMBAT_HONOR_GAIN", "Grim Rook dies, honorable kill Rank: Private (12 Honor Points)")`);
    statUp();
    expect(stat("total", "kills")).toBe("1");
    expect(row()).toBe("Grim Rook|MAGE|14|The Wolves");
  });

  it("names a kill the statistic counted first when the honor line follows", () => {
    withUnits();
    statUp();
    expect(unnamed()).toBe(true);
    s!.run(`CLOCK = CLOCK + 1; fire_event("CHAT_MSG_COMBAT_HONOR_GAIN", "Grim Rook dies, honorable kill Rank: Private (12 Honor Points)")`);
    expect(stat("total", "kills")).toBe("1");
    expect(row().split("|")[0]).toBe("Grim Rook");
  });

  it("uses PARTY_KILL for my own killing blow and never someone else's", () => {
    withUnits();
    s!.run(`see("mouseover", ${enemy()})`);
    s!.run(`fire_event("PARTY_KILL", "Player-1-OTHER", "Player-1-AAA")`);
    statUp();
    expect(unnamed()).toBe(true);
    s!.run(`CLOCK = CLOCK + 30; see("mouseover", ${enemy()}); fire_event("PARTY_KILL", "Player-1-ME", "Player-1-AAA")`);
    statUp();
    expect(row(2)).toBe("Grim Rook|MAGE|14|The Wolves");
    expect(stat("total", "kills")).toBe("2");
  });

  it("falls back to the enemy seen dying within five seconds, and not one that died longer ago", () => {
    withUnits();
    s!.run(`see("target", ${enemy()}); UNITS.target.dead = true; fire_event("UNIT_HEALTH", "target")`);
    s!.run(`CLOCK = CLOCK + 2`);
    statUp();
    expect(row()).toBe("Grim Rook|MAGE|14|The Wolves");
    s!.run(`CLOCK = CLOCK + 30; see("target", { name = "Old Corpse", guid = "Player-1-BBB", dead = true }); CLOCK = CLOCK + 8`);
    statUp();
    expect(unnamed(2)).toBe(true);
  });

  it("does not take a Feign Death for a death", () => {
    withUnits();
    s!.run(`see("target", ${enemy()}); UNITS.target.dead = true; fire_event("UNIT_HEALTH", "target")`);
    s!.run(`CLOCK = CLOCK + 2; UNITS.target.dead = false; fire_event("UNIT_HEALTH", "target"); CLOCK = CLOCK + 1`);
    statUp();
    expect(stat("total", "kills")).toBe("1"); // the statistic is still the count
    expect(unnamed()).toBe(true);
  });

  it("skips an unreadable honor line (secret or foreign wording) but still counts the kill", () => {
    withUnits();
    s!.run(`NS.isSecret = function(v) return v == "SECRET" end`);
    expect(s!.run(`return tostring(NS.worldPvp.noteKill("SECRET"))`)).toBe("false");
    s!.run(`COMBATLOG_HONORGAIN = nil; COMBATLOG_HONORGAIN_NO_RANK = nil`);
    expect(s!.run(`return tostring(NS.worldPvp.victim("Grim Rook dies, honorable kill Rank: Private (12 Honor Points)"))`)).toBe("nil");
    statUp();
    expect(stat("total", "kills")).toBe("1");
  });

  it("reads the no-rank honor line from its own global string", () => {
    withUnits();
    s!.run(`COMBATLOG_HONORGAIN_NO_RANK = "%s dies, honorable kill (%d Honor Points)"`);
    expect(s!.run(`return NS.worldPvp.victim("Grim Rook dies, honorable kill (5 Honor Points)")`)).toBe("Grim Rook");
  });

  it("counts and names nothing during a duel, and again after it", () => {
    withUnits();
    s!.run(`fire_event("DUEL_REQUESTED", "Rival")`);
    s!.run(`see("target", ${enemy()})`);
    statUp();
    expect(stat("total", "kills")).toBe("0");
    s!.run(`fire_event("DUEL_FINISHED"); CLOCK = CLOCK + 30`);
    statUp();
    expect(stat("total", "kills")).toBe("1");
  });

  it("ignores friendly, same-faction, mind-controlled and non-player units", () => {
    withUnits();
    s!.run(`see("target", { name = "Pal", guid = "Player-1-P", enemy = false, dead = true })`);
    s!.run(`see("mouseover", { name = "Twin", guid = "Player-1-T", faction = "Alliance", dead = true })`);
    s!.run(`see("target", { name = "Puppet", guid = "Player-1-M", mc = true, dead = true })`);
    s!.run(`see("target", { name = "Wolf", guid = "Creature-1", player = false, dead = true })`);
    statUp();
    expect(unnamed()).toBe(true);
  });

  it("expires entries after 30 seconds", () => {
    withUnits();
    s!.run(`see("target", ${enemy()}); UNITS.target.dead = true; fire_event("UNIT_HEALTH", "target"); CLOCK = CLOCK + 40`);
    statUp();
    expect(unnamed()).toBe(true);
  });

  it("observing without any unit APIs is harmless", () => {
    setup();
    expect(s!.run(`return tostring(NS.worldPvp.observe("target"))`)).toBe("true");
    expect(s!.run(`return tostring(NS.worldPvp.observe("party1"))`)).toBe("false");
  });
});
