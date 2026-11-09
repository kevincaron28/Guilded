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
    function GetRealZoneText() return "Silverpine Forest" end
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
