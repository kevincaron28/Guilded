import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

// Secret achievements (Modules/SecretAchievements.lua): killed by the Son of Arugal (npc 2529), run against the real Lua files.
// There is no combat log, so the module polls the units attacking the player and matches them when PLAYER_DEAD fires.
let s: LuaSession | undefined;
afterEach(() => s?.close());

const ARUGAL = "Creature-0-3-0-0-2529-0000A1B2C3";
const BOAR = "Creature-0-3-0-0-3098-0000A1B2C4";

function setup(locale = "enUS") {
  s = newLuaSession();
  s.run(`DB = { roster = {} }; CLOCK = 1800000000; NOW = 100; COMBAT = true; CHAT_OUT = {}; MSG = {}
    UNIT = {}  -- unit token -> { guid, hostile, targetsMe }
    function GetServerTime() return CLOCK end
    function GetTime() return NOW end
    function GetLocale() return "${locale}" end
    function UnitName() return "Kev" end; function GetRealmName() return "Realm" end
    function UnitLevel() return 8 end
    function InCombatLockdown() return false end
    function UnitAffectingCombat() return COMBAT end
    function GetMaxPlayerLevel() return 60 end
    function IsInGuild() return true end
    function SendChatMessage(text, channel) CHAT_OUT[#CHAT_OUT + 1] = channel .. ":" .. text end
    function UnitExists(u) return UNIT[u] ~= nil end
    function UnitGUID(u) return UNIT[u] and UNIT[u].guid end
    function UnitCanAttack(_, u) return UNIT[u] ~= nil and UNIT[u].hostile == true end
    function UnitIsUnit(a, b) local u = a:match("^(.-)target$"); return u ~= nil and b == "player" and UNIT[u] ~= nil and UNIT[u].targetsMe == true end
    NS = { getDb = function() return DB end, util = {}, commandHandlers = {}, commandHelp = {}, message = function(m) MSG[#MSG + 1] = m end,
      isSecret = function() return false end, isGuildMember = function() return true end, isOfficerName = function() return false end, isOfficer = function() return false end }`);
  s.load("Locale.lua");
  s.load("Modules/Milestones.lua");
  s.load("Modules/SecretAchievements.lua");
  s.run(`NS.util.gameEdition = function() return "forever" end`);
  s.run(`NS.milestones.baseline()`);
  return s;
}
const attack = (unit: string, guid: string, targetsMe = true) => s!.run(`UNIT["${unit}"] = { guid = "${guid}", hostile = true, targetsMe = ${targetsMe} }`);
const die = () => s!.run(`COMBAT = false; fire_event("PLAYER_DEAD")`); // the dead are out of combat, so the chat line may go out
const log = () => s!.run(`local c = DB.milestones.chars["Kev-Realm"]; local t = {}; for _, e in ipairs(c.log) do t[#t + 1] = e.kind .. ":" .. e.ref end; return table.concat(t, ",")`);

describe("secret achievements: killed by", () => {
  it("parses the creature id from a GUID", () => {
    setup();
    const id = (guid: string) => s!.run(`local v = NS.secretAchievements.npcId(${JSON.stringify(guid)}); return tostring(v)`);
    expect(id(ARUGAL)).toBe("2529");
    expect(id("Vehicle-0-3-0-0-2529-0000A1B2C3")).toBe("2529");
    expect(id("Player-3676-0A1B2C3D")).toBe("nil");
    expect(id("Creature-0-3-0")).toBe("nil");
    expect(id("")).toBe("nil");
  });

  it("unlocks when the player dies while the Son of Arugal was attacking", () => {
    setup();
    attack("nameplate1", ARUGAL);
    s!.run(`NS.secretAchievements.scan(); NOW = 104`);
    die();
    expect(log()).toBe("secret:secret:killed-arugal");
    expect(s!.run(`return DB.milestones.chars["Kev-Realm"].log[1].value`)).toBe("1");
    // The local notice, and the guild-chat line under the normal milestone rules.
    expect(s!.run(`return MSG[#MSG]`)).toBe("Secret achievement unlocked: Silverpine Welcome Committee!");
    expect(s!.run(`return table.concat(CHAT_OUT, "|")`)).toBe("GUILD:Kev unlocked a secret achievement: Silverpine Welcome Committee!");
  });

  it("does not unlock for another creature, a creature not attacking, or an old sighting", () => {
    setup();
    attack("target", BOAR);
    die();
    expect(log()).toBe("");
    attack("target", ARUGAL, false); // looking at the player's group, not at the player
    die();
    expect(log()).toBe("");
    attack("target", ARUGAL);
    s!.run(`NS.secretAchievements.scan(); NOW = 130`); // seen 30 s before the death
    s!.run(`UNIT = {}`);
    die();
    expect(log()).toBe("");
  });

  it("is recorded once per character, even after another death", () => {
    setup();
    attack("target", ARUGAL); die();
    attack("target", ARUGAL); s!.run(`NOW = 200`); die();
    expect(log()).toBe("secret:secret:killed-arugal");
    expect(s!.run(`return #CHAT_OUT`)).toBe("1");
  });

  it("forgets sightings when combat ends, so an earlier elite does not count for a later death", () => {
    setup();
    attack("target", ARUGAL);
    s!.run(`NS.secretAchievements.scan(); fire_event("PLAYER_REGEN_ENABLED")`);
    s!.run(`UNIT = {}`);
    die();
    expect(log()).toBe("");
  });

  it("records nothing when the milestones module is off", () => {
    setup();
    s!.run(`NS.moduleActive = function() return false end`);
    attack("target", ARUGAL); die();
    expect(log()).toBe("");
  });

  it("says the name in French on a French client", () => {
    setup("frFR");
    attack("target", ARUGAL); die();
    expect(s!.run(`return MSG[#MSG]`)).toBe("Succès secret débloqué : Comité d'accueil des Pins-Argentés !");
  });

  it("keeps the detector table open for more secrets", () => {
    setup();
    expect(s!.run(`return NS.secretAchievements.killedBy[2529]`)).toBe("killed-arugal");
  });
});
