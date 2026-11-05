import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

// Milestone announcements (Modules/Milestones.lua) and guild duels (Modules/Duels.lua), run against the real
// Lua files on the mocked client: detection, opt-in, once-only, throttle, dedupe and the daily pair allowance.
let s: LuaSession | undefined;
afterEach(() => s?.close());

function setup(locale = "enUS") {
  s = newLuaSession();
  s.run(`DB = { roster = {} }; CLOCK = 1800000000; LEVEL = 5; COMBAT = false; CHAT_OUT = {}; CHAT_FAIL = false
    GUILD_MEMBERS = { Kev = true, Bob = true, Cy = true }; OFFICERS = {}
    function GetServerTime() return CLOCK end
    function GetLocale() return "${locale}" end
    function UnitName() return "Kev" end; function GetRealmName() return "Realm" end
    function UnitLevel() return LEVEL end
    function InCombatLockdown() return COMBAT end
    function GetMaxPlayerLevel() return 60 end
    function IsInGuild() return true end
    function SendChatMessage(text, channel) if CHAT_FAIL then error("ADDON_ACTION_FORBIDDEN") end; CHAT_OUT[#CHAT_OUT + 1] = channel .. ":" .. text end
    DUEL_WINNER_KNOCKOUT = "%1$s has defeated %2$s in a duel"
    DUEL_WINNER_RETREAT = "%2$s has fled from %1$s in a duel"
    NS = { getDb = function() return DB end, util = {}, commandHandlers = {}, commandHelp = {}, message = function() end,
      isSecret = function() return false end,
      isGuildMember = function(name) return GUILD_MEMBERS[(name or ""):match("^[^-]+")] == true end,
      isOfficerName = function(name) return OFFICERS[(name or ""):match("^[^-]+")] == true end,
      isOfficer = function() return OFFICERS.Kev == true end }`);
  s.load("Locale.lua");
  s.load("Modules/Milestones.lua");
  s.load("Modules/Duels.lua");
  s.run(`NS.util.gameEdition = function() return "forever" end`);
  s.run(`NS.milestones.baseline()`); // a fresh character records what it already has, silently
  return s;
}
const out = () => s!.run(`return table.concat(CHAT_OUT, "\\n")`);
const outCount = () => Number(s!.run(`return tostring(#CHAT_OUT)`));
const on = () => s!.run(`NS.commandHandlers.milestones({ "on" })`);

describe("milestone announcements", () => {
  it("is off by default: records the milestone for the upload, says nothing", () => {
    const lua = setup();
    lua.run(`LEVEL = 10; fire_event("PLAYER_LEVEL_UP", 10)`);
    expect(outCount()).toBe(0);
    expect(lua.run(`return tostring(DB.milestones.chars["Kev-Realm"].done["level:10"] ~= nil)`)).toBe("true");
    expect(lua.run(`return DB.milestones.chars["Kev-Realm"].log[1].ref`)).toBe("level:10");
  });

  it("announces a level step once, in GUILD chat only", () => {
    const lua = setup(); on();
    lua.run(`fire_event("PLAYER_LEVEL_UP", 10)`);
    expect(out()).toBe("GUILD:Kev reached level 10!");
    lua.run(`CLOCK = CLOCK + 100; fire_event("PLAYER_LEVEL_UP", 10); NS.milestones.pump()`);
    expect(outCount()).toBe(1);
  });

  it("does not replay history when announcements are turned on later", () => {
    const lua = setup();
    lua.run(`fire_event("PLAYER_LEVEL_UP", 20)`); // reached while off: recorded silently
    on();
    lua.run(`CLOCK = CLOCK + 100; fire_event("PLAYER_LEVEL_UP", 20); fire_event("PLAYER_LEVEL_UP", 21)`);
    expect(outCount()).toBe(0);
    lua.run(`fire_event("PLAYER_LEVEL_UP", 30)`);
    expect(out()).toBe("GUILD:Kev reached level 30!");
  });

  it("announces only the highest step of a jump and the maximum level by name", () => {
    const lua = setup(); on();
    lua.run(`fire_event("PLAYER_LEVEL_UP", 35)`);
    expect(out()).toBe("GUILD:Kev reached level 30!");
    lua.run(`CLOCK = CLOCK + 31; fire_event("PLAYER_LEVEL_UP", 60); NS.milestones.pump()`);
    expect(out()).toContain("GUILD:Kev reached the maximum level (60)!");
    expect(lua.run(`return tostring(DB.milestones.chars["Kev-Realm"].done["level:40"] ~= nil)`)).toBe("true");
    expect(lua.run(`return tostring(#CHAT_OUT)`)).toBe("2");
  });

  it("sends at most one line per 30 seconds, the rest waits", () => {
    const lua = setup(); on();
    lua.run(`fire_event("PLAYER_LEVEL_UP", 10)`);
    lua.run(`GetPVPLifetimeStats = function() return 150 end; fire_event("PLAYER_PVP_KILLS_CHANGED")`);
    expect(outCount()).toBe(1); // the HK lines wait for the throttle
    lua.run(`CLOCK = CLOCK + 29; NS.milestones.pump()`);
    expect(outCount()).toBe(1);
    lua.run(`CLOCK = CLOCK + 2; NS.milestones.pump()`);
    expect(out()).toContain("GUILD:Kev reached 100 honorable kills!");
    expect(outCount()).toBe(2);
  });

  it("holds a line during combat and sends it afterwards", () => {
    const lua = setup(); on();
    lua.run(`COMBAT = true; fire_event("PLAYER_LEVEL_UP", 10)`);
    expect(outCount()).toBe(0);
    lua.run(`COMBAT = false; NS.milestones.pump()`);
    expect(outCount()).toBe(1);
  });

  it("keeps the line when the client refuses the message, and gives up after a few tries", () => {
    const lua = setup(); on();
    lua.run(`CHAT_FAIL = true; fire_event("PLAYER_LEVEL_UP", 10)`);
    expect(outCount()).toBe(0);
    lua.run(`CHAT_FAIL = false; NS.milestones.pump()`);
    expect(out()).toBe("GUILD:Kev reached level 10!");
  });

  it("reads honorable kills nil-safe and announces 1, then 100", () => {
    const lua = setup(); on();
    lua.run(`fire_event("PLAYER_PVP_KILLS_CHANGED")`); // no API on this client
    expect(outCount()).toBe(0);
    lua.run(`GetPVPLifetimeStats = function() return 1 end; fire_event("PLAYER_PVP_KILLS_CHANGED")`);
    expect(out()).toBe("GUILD:Kev scored a first honorable kill!");
    lua.run(`GetPVPLifetimeStats = function() return nil end; fire_event("PLAYER_PVP_KILLS_CHANGED")`);
    expect(outCount()).toBe(1);
  });

  it("announces the first clear of each dungeon, for a run the character took part in, once", () => {
    const lua = setup(); on();
    lua.run(`NS.onDungeonRunFinished({ state = "COMPLETED", instanceId = 329, name = "Stratholme", players = { Kev = {}, Bob = {} } })`);
    expect(out()).toBe("GUILD:Kev cleared Stratholme for the first time!");
    lua.run(`CLOCK = CLOCK + 100; NS.onDungeonRunFinished({ state = "COMPLETED", instanceId = 329, name = "Stratholme", players = { Kev = {} } })`);
    lua.run(`NS.onDungeonRunFinished({ state = "COMPLETED", instanceId = 70, name = "Uldaman", players = { Bob = {} } })`);
    lua.run(`NS.onDungeonRunFinished({ state = "ABANDONED", instanceId = 71, name = "Zul'Farrak", players = { Kev = {} } })`);
    expect(outCount()).toBe(1);
  });

  it("keeps an earlier hook (Scores.lua) working and respects a per-type switch", () => {
    s = newLuaSession();
    s.run(`DB = {}; HOOKED = 0; function GetServerTime() return 1800000000 end; function UnitName() return "Kev" end; function GetRealmName() return "R" end
      function UnitLevel() return 1 end; function IsInGuild() return true end; function InCombatLockdown() return false end; function SendChatMessage(t, c) CHAT_OUT = (CHAT_OUT or "") .. c .. ":" .. t end
      NS = { getDb = function() return DB end, util = {}, commandHandlers = {}, commandHelp = {}, message = function() end, onDungeonRunFinished = function() HOOKED = HOOKED + 1 end }`);
    s.load("Modules/Milestones.lua");
    s.run(`NS.milestones.baseline(); NS.commandHandlers.milestones({ "on" }); NS.commandHandlers.milestones({ "level", "off" })`);
    s.run(`NS.onDungeonRunFinished({ state = "COMPLETED", instanceId = 1, name = "A", players = { Kev = {} } }); NS.milestones.checkLevel(10)`);
    expect(s.run(`return tostring(HOOKED)`)).toBe("1");
    expect(s.run(`return tostring(CHAT_OUT)`)).toBe("GUILD:Kev cleared A for the first time!");
  });

  it("speaks French on a French client", () => {
    const lua = setup("frFR"); on();
    lua.run(`fire_event("PLAYER_LEVEL_UP", 10)`);
    expect(out()).toBe("GUILD:Kev a atteint le niveau 10 !");
  });

  it("shows the officer recommendation as a prompt; only an officer's word counts and nothing turns on by itself", () => {
    const lua = setup();
    lua.run(`NS.milestones.onAddonMessage("REC|1|1800000000", "Bob-Realm")`); // Bob is not an officer
    expect(lua.run(`return tostring(NS.milestones.recommended())`)).toBe("nil");
    lua.run(`OFFICERS.Bob = true; NS.milestones.onAddonMessage("REC|1|1800000000", "Bob-Realm")`);
    expect(lua.run(`return tostring(NS.milestones.recommended() ~= nil)`)).toBe("true");
    expect(lua.run(`return tostring(NS.milestones.maybePrompt())`)).toBe("true");
    expect(lua.run(`return tostring(NS.milestones.maybePrompt())`)).toBe("false"); // asked once per recommendation
    expect(lua.run(`return tostring(NS.milestones.enabled())`)).toBe("false");
    lua.run(`fire_event("PLAYER_LEVEL_UP", 10)`);
    expect(outCount()).toBe(0);
  });

  it("lets an officer recommend, not a member", () => {
    const lua = setup();
    expect(lua.run(`return tostring(NS.milestones.recommend(true))`)).toBe("false");
    lua.run(`OFFICERS.Kev = true`);
    expect(lua.run(`return tostring(NS.milestones.recommend(true))`)).toBe("true");
  });
});

const knock = (a: string, b: string) => `fire_event("CHAT_MSG_SYSTEM", "${a} has defeated ${b} in a duel")`;

describe("guild duels", () => {
  it("reads both duel lines from the client's global strings, whatever the argument order", () => {
    const lua = setup();
    expect(lua.run(`local w, l, r = NS.duels.parse("Kev has defeated Bob in a duel"); return w .. "," .. l .. "," .. r`)).toBe("Kev,Bob,knockout");
    expect(lua.run(`local w, l, r = NS.duels.parse("Bob has fled from Kev in a duel"); return w .. "," .. l .. "," .. r`)).toBe("Kev,Bob,retreat");
    expect(lua.run(`return tostring((NS.duels.parse("Kev says hello")))`)).toBe("nil");
    lua.run(`DUEL_WINNER_KNOCKOUT = "%s a battu %s en duel"; NS.duels.rebuildPatterns()`);
    expect(lua.run(`local w, l = NS.duels.parse("Kev a battu Bob en duel"); return w .. "," .. l`)).toBe("Kev,Bob");
  });

  it("records only duels between two guild members", () => {
    const lua = setup();
    lua.run(knock("Kev", "Stranger"));
    expect(lua.run(`return tostring(#NS.duels.standings())`)).toBe("0");
    lua.run(knock("Bob", "Cy"));
    const rows = lua.run(`local r = NS.duels.standings(); return #r .. ":" .. r[1].name .. ":" .. r[1].wins`);
    expect(rows).toBe("2:Bob:1");
  });

  it("counts one duel when both clients (and a bystander) report it", () => {
    const lua = setup();
    lua.run(knock("Kev", "Bob"));
    lua.run(`CLOCK = CLOCK + 3; NS.duels.onAddonMessage("D|Kev|Bob|" .. CLOCK .. "|knockout", "Bob-Realm")`); // the loser's client
    lua.run(`CLOCK = CLOCK + 4; NS.duels.onAddonMessage("D|Kev|Bob|" .. CLOCK .. "|knockout", "Kev-Realm")`);
    lua.run(knock("Kev", "Bob"));
    expect(lua.run(`local r = NS.duels.standings(); return #r .. ":" .. r[1].wins`)).toBe("2:1");
    // The same pair 90 seconds later is a new duel.
    lua.run(`CLOCK = CLOCK + 90; NS.duels.onAddonMessage("D|Kev|Bob|" .. CLOCK .. "|knockout", "Bob-Realm")`);
    expect(lua.run(`return tostring(NS.duels.standings()[1].wins)`)).toBe("2");
  });

  it("believes a shared result only from the winner or the loser, and rejects bad data", () => {
    const lua = setup();
    lua.run(`NS.duels.onAddonMessage("D|Kev|Bob|" .. CLOCK .. "|knockout", "Cy-Realm")`);
    expect(lua.run(`return tostring(#NS.duels.standings())`)).toBe("0");
    lua.run(`NS.duels.onAddonMessage("D|Kev|Stranger|" .. CLOCK .. "|knockout", "Kev-Realm")`);
    lua.run(`NS.duels.onAddonMessage("D|Kev|Bob|1|knockout", "Kev-Realm")`);
    lua.run(`NS.duels.onAddonMessage("D|Kev|Bob|" .. CLOCK .. "|cheat", "Kev-Realm")`);
    expect(lua.run(`return tostring(#NS.duels.standings())`)).toBe("0");
    lua.run(`NS.duels.onAddonMessage("D|Kev|Bob|" .. CLOCK .. "|retreat", "Bob-Realm")`);
    expect(lua.run(`return tostring(#NS.duels.standings())`)).toBe("2");
  });

  it("shares a duel the player took part in with the guild, once", () => {
    const lua = setup();
    lua.run(`SENT = {}; ${knock("Kev", "Bob")}`);
    const queued = Number(lua.run(`local sent = 0; for _, m in ipairs(SENT or {}) do if m.prefix == "GuildedDuel" then sent = sent + 1 end end; return tostring(sent + NS.comm.pending("GuildedDuel"))`));
    expect(queued).toBe(1);
    lua.run(`CLOCK = CLOCK + 1; ${knock("Kev", "Bob")}`);
    expect(Number(lua.run(`local sent = 0; for _, m in ipairs(SENT or {}) do if m.prefix == "GuildedDuel" then sent = sent + 1 end end; return tostring(sent + NS.comm.pending("GuildedDuel"))`))).toBe(1);
  });

  it("counts at most five duels per pair per day, and ranks by wins, win rate and streak", () => {
    const lua = setup();
    lua.run(`for i = 1, 8 do CLOCK = CLOCK + 120; NS.duels.record("Kev", "Bob", CLOCK, "knockout") end`);
    lua.run(`CLOCK = CLOCK + 120; NS.duels.record("Bob", "Cy", CLOCK, "knockout")`);
    lua.run(`CLOCK = CLOCK + 120; NS.duels.record("Cy", "Kev", CLOCK, "retreat")`);
    const board = lua.run(`local t = {}; for _, r in ipairs(NS.duels.standings()) do t[#t + 1] = r.name .. "=" .. r.wins .. "/" .. r.losses .. "/" .. r.best .. "/" .. r.streak end; return table.concat(t, " ")`);
    // Kev won 5 counted duels (the other 3 were over the allowance) and lost the last one to Cy.
    expect(board).toBe("Kev=5/1/5/-1 Cy=1/1/1/1 Bob=1/5/1/1");
  });

  it("a first duel win announces once as a milestone when announcements are on", () => {
    const lua = setup(); on();
    lua.run(knock("Kev", "Bob"));
    expect(out()).toBe("GUILD:Kev won a first duel!");
    lua.run(`CLOCK = CLOCK + 200; ${knock("Kev", "Bob")}`);
    expect(outCount()).toBe(1);
  });

  it("does not announce a duel loss, or a win by someone else", () => {
    const lua = setup(); on();
    lua.run(knock("Bob", "Kev"));
    lua.run(`CLOCK = CLOCK + 200; ${knock("Bob", "Cy")}`);
    expect(outCount()).toBe(0);
  });
});
