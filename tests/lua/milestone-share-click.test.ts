import { afterEach, describe, expect, it } from "vitest";
import { addonSource, newLuaSession, type LuaSession } from "./harness.js";

// 9.3.8: WoW Forever refuses a guild-chat line an addon sends by itself. The owner's saved diagnostics (13-17 Nov 2026) show
// "ADDON_ACTION_BLOCKED: Guilded tried to call UNKNOWN()" within one second of every announced milestone (level 30, fishing,
// cooking and first aid 150), each logged "after" whatever Core handled last (UNIT_INVENTORY_CHANGED, CHAT_MSG_LOOT,
// ACTIVE_TALENT_GROUP_CHANGED); on 17 Nov it fired while mining, with an achievement toast. Milestones.lua sent the line from
// the game event (ACHIEVEMENT_EARNED, SKILL_LINES_CHANGED, PLAYER_LEVEL_UP) or from a retry timer. Now a line is only offered in
// the Share bar and is sent from the player's click.
let s: LuaSession | undefined;
afterEach(() => s?.close());

function setup() {
  s = newLuaSession();
  s.run(`DB = { roster = {} }; CLOCK = 1800000000; LEVEL = 30; CLICKING = false; SENDS = {}; TIMERS = {}
    function GetServerTime() return CLOCK end
    function UnitName() return "Kev" end; function GetRealmName() return "Realm" end
    function UnitLevel() return LEVEL end
    function InCombatLockdown() return false end
    function GetMaxPlayerLevel() return 60 end
    function IsInGuild() return true end
    C_Timer = { After = function(delay, fn) TIMERS[#TIMERS + 1] = fn end }
    function RUN_TIMERS() local list = TIMERS; TIMERS = {}; for _, fn in ipairs(list) do fn() end end
    -- Records where each send came from, and the marker Core reads when the game refuses it.
    function SendChatMessage(text, channel)
      SENDS[#SENDS + 1] = { text = text, channel = channel, click = CLICKING, marker = NS.guardedCall and NS.guardedCall.name }
    end
    SKILL = 140
    function GetProfessions() return 1 end
    function GetProfessionInfo() return "Mining", nil, SKILL, 300, 0, 0, 186 end
    ACH = { [15577] = { { 101, "Explore Thousand Needles", 10, false, 0, 0, 0, "Explore it." } } }
    function GetCategoryList() return { 15577 } end
    function GetCategoryInfo() return "Exploration" end
    function GetCategoryNumAchievements() return 1, 0, 1 end
    function GetAchievementInfo(a, b)
      local r = b and ACH[a][b] or ACH[15577][1]
      return r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8]
    end
    function GetAchievementCategory() return 15577 end
    NS = { getDb = function() return DB end, util = {}, commandHandlers = {}, commandHelp = {}, message = function() end,
      isSecret = function() return false end, isGuildMember = function() return true end, isOfficerName = function() return false end,
      isOfficer = function() return false end }`);
  s.load("Locale.lua");
  s.load("Modules/Milestones.lua");
  s.load("Modules/GameAchievements.lua");
  s.run(`NS.util.gameEdition = function() return "forever" end; NS.milestones.baseline(); NS.gameAchievements.scan()`);
  return s;
}
const sends = () => s!.run(`local t = {}; for _, r in ipairs(SENDS) do t[#t + 1] = r.channel .. ":" .. r.text .. ":" .. tostring(r.click) .. ":" .. tostring(r.marker) end; return table.concat(t, "\\n")`);
const click = () => s!.run(`CLICKING = true; NS.milestones.bar().share.scripts.OnClick(); CLICKING = false`);

describe("milestone lines go to guild chat only from the Share click", () => {
  it("mining with an achievement toast: nothing is sent from the game events or their timers", () => {
    setup();
    // Loot, a skill-up to 150 and the achievement, as on 17 Nov, then every timer the addon set runs.
    s!.run(`fire_event("UNIT_INVENTORY_CHANGED", "player"); fire_event("CHAT_MSG_LOOT", "You receive loot: [Tin Ore].")`);
    s!.run(`SKILL = 150; fire_event("CHAT_MSG_SKILL", "Your skill in Mining has increased to 150."); fire_event("SKILL_LINES_CHANGED")`);
    s!.run(`ACH[15577][1] = { 101, "Explore Thousand Needles", 10, true, 11, 17, 26, "Explore it." }; fire_event("ACHIEVEMENT_EARNED", 101, false)`);
    s!.run(`LEVEL = 40; fire_event("PLAYER_LEVEL_UP", 40)`);
    for (let i = 0; i < 5; i++) s!.run(`CLOCK = CLOCK + 60; RUN_TIMERS()`);
    expect(sends()).toBe("");
    expect(s!.run(`return tostring(NS.milestones.waiting())`)).toBe("3");
    expect(s!.run(`return tostring(rawget(NS.milestones.bar(), "text"))`)).toBe("Kev reached skill 150 in Mining!");
  });

  it("each click sends one line, inside the click, marked for the blocked-action diagnostic", () => {
    setup();
    s!.run(`SKILL = 150; fire_event("SKILL_LINES_CHANGED")`);
    s!.run(`ACH[15577][1] = { 101, "Explore Thousand Needles", 10, true, 11, 17, 26, "Explore it." }; fire_event("ACHIEVEMENT_EARNED", 101, false)`);
    click();
    click();
    click(); // nothing left: no send
    expect(sends()).toBe([
      "GUILD:Kev reached skill 150 in Mining!:true:SendChatMessage (milestone Share)",
      "GUILD:Kev earned the achievement Explore Thousand Needles!:true:SendChatMessage (milestone Share)",
    ].join("\n"));
    expect(s!.run(`return tostring(NS.guardedCall)`)).toBe("nil");
    expect(s!.run(`return tostring(rawget(NS.milestones.bar(), "text"))`)).toBe("nil");
  });

  it("Milestones.lua calls the chat API in one place only, the Share click", () => {
    const source = addonSource("Modules/Milestones.lua");
    // The `send` lookup in ms.share (C_ChatInfo form and the global); the third mention is the diagnostic marker's name.
    expect(source.match(/SendChatMessage/g)).toHaveLength(3);
    const share = source.slice(source.indexOf("function ms.share()"), source.indexOf("function ms.waiting()"));
    expect(share).toContain("pcall(send, text, \"GUILD\")");
    expect(source.split("pcall(send, text").length - 1).toBe(1);
    expect(source).not.toContain("function ms.pump");
  });
});
