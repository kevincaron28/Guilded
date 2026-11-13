import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

// The guild duel leaderboard (sorting, filters, pinned row, head to head, 24 h arrows) and the end-of-duel card
// (Modules/Duels.lua), run against the real Lua file on the mocked client. Two real players are needed to verify the
// card in game; see the pull request.
let s: LuaSession | undefined;
afterEach(() => s?.close());

function setup(locale = "enUS") {
  s = newLuaSession();
  s.run(`DB = { roster = {} }; SETTINGS = {}; CLOCK = 1800000000; NOW = 100; COMBAT = false; SENT_LINES = {}; SHOWS = 0; VISIBLE = false; HOVER = false; KB = false; REG = {}
    GUILD_MEMBERS = { ["Kev Caron"] = true, ["Bob Smith"] = true, ["Cy Jones"] = true, ["Di Lee"] = true }
    ROSTER = { { "Kev Caron", 60, "WARRIOR" }, { "Bob Smith", 58, "MAGE" }, { "Cy Jones", 60, "WARRIOR" }, { "Di Lee", 50, "PRIEST" } }
    function GetServerTime() return CLOCK end
    function GetTime() return NOW end
    function GetLocale() return "${locale}" end
    function UnitName() return "Kev" end
    function UnitLevel() return 60 end
    function UnitClass() return "Warrior", "WARRIOR" end
    function UnitGUID(unit) if unit == "player" then return "Player-1-AAA" end; return nil end
    function GetZoneText() return "Elwynn Forest" end
    HEALTH = {}
    function UnitHealth(unit) return HEALTH[unit] and HEALTH[unit][1] or 100 end
    function UnitHealthMax(unit) return HEALTH[unit] and HEALTH[unit][2] or 100 end
    function InCombatLockdown() return COMBAT end
    function IsInGuild() return true end
    function GetNumGuildMembers() return #ROSTER end
    function GetGuildRosterInfo(i) local r = ROSTER[i]; return r[1], "Member", 3, r[2], r[3], "Zone", "", "", true, 0, r[3] end
    RAID_CLASS_COLORS = { WARRIOR = { r = 0.78, g = 0.61, b = 0.43 }, MAGE = { r = 0.41, g = 0.8, b = 0.94 } }
    DUEL_WINNER_KNOCKOUT = "%1$s has defeated %2$s in a duel"
    DUEL_WINNER_RETREAT = "%2$s has fled from %1$s in a duel"
    local original = CreateFrame
    CreateFrame = function(kind, name, ...)
      local frame = original(kind, name, ...)
      frame.RegisterEvent = function(_, event) REG[event] = true end
      frame.UnregisterEvent = function(_, event) REG[event] = false end
      frame.EnableKeyboard = function() KB = true end
      frame.SetPropagateKeyboardInput = function() KB = true end
      frame.CreateFontString = function()
        return setmetatable({ GetStringHeight = function() return 120 end }, { __index = function() return function() end end })
      end
      if name == "GuildedDuelCard" then
        CARD = frame
        frame.Show = function() VISIBLE = true; SHOWS = SHOWS + 1 end
        frame.Hide = function() VISIBLE = false end
        frame.IsShown = function() return VISIBLE end
        frame.IsMouseOver = function() return HOVER end
        frame.SetAlpha = function(_, a) ALPHA = a end
      end
      return frame
    end
    NS = { getDb = function() return DB end, getSettings = function() return SETTINGS end, util = {}, commandHandlers = {}, commandHelp = {},
      message = function(text) MSGS = (MSGS or "") .. text .. "\\n" end, isSecret = function() return false end,
      isGuildMember = function(name) return GUILD_MEMBERS[(name or ""):match("^[^-]+")] == true end }
    NS.util.unitKey = function() return "Kev Caron" end`);
  s.load("Locale.lua");
  s.load("Modules/Milestones.lua");
  s.load("Modules/Duels.lua");
  s.run(`NS.comm = { register = function() end, send = function(prefix, text) SENT_LINES[#SENT_LINES + 1] = text; return true end }`);
  return s;
}
const say = (text: string) => s!.run(`fire_event("CHAT_MSG_SYSTEM", "${text}")`);
const stat = (code: string) => s!.run(`return tostring(${code})`);
// A full duel on my side: opponent asked, the countdown, the result line.
function playDuel(lua: LuaSession, result: string) {
  lua.run(`NOW = 100; fire_event("DUEL_REQUESTED", "Bob Smith"); fire_event("DUEL_COUNTDOWN", 3)`);
  lua.run(`NOW = 187; CLOCK = CLOCK + 90; HEALTH = { player = { 42, 100 }, target = { 1, 100 } }`);
  say(result);
}

describe("end-of-duel card", () => {
  it("a won duel gives victory data with the duration, zone, classes, points, rank and my health left", () => {
    const lua = setup();
    playDuel(lua, "Kev Caron has defeated Bob Smith in a duel");
    expect(stat("SHOWS")).toBe("1");
    const d = (field: string) => lua.run(`return tostring(NS.duels.lastCard.${field})`);
    expect(d("won")).toBe("true");
    expect(d("me")).toBe("Kev Caron");
    expect(d("opponent")).toBe("Bob Smith");
    expect(d("myClass") + d("oppClass")).toBe("WARRIORMAGE");
    expect(d("duration")).toBe("84"); // 187 - (100 + 3)
    expect(d("zone")).toBe("Elwynn Forest");
    expect(d("points")).toBe("6"); // 10 + 2 * (58 - 60)
    expect(d("wins") + d("losses") + d("rank")).toBe("101");
    expect(d("health.me")).toBe("42");
    const text = lua.run(`return table.concat(NS.duels.cardLines(NS.duels.lastCard), "\\n")`);
    expect(text).toContain("Duration 1:24");
    expect(text).toContain("Elwynn Forest");
    expect(text).toContain("your health left 42%");
    expect(text).toContain("Record 1-0 (100%)");
    expect(text).toContain("+6 points");
    expect(text).toContain("Rematch? Target Bob Smith and choose Duel.");
    // Damage and healing need the restricted combat log: never registered, never shown.
    expect(stat("REG.COMBAT_LOG_EVENT_UNFILTERED")).toBe("nil");
    expect(text).not.toContain("Damage");
  });

  it("a lost duel gives defeat data, and a fled duel says who fled", () => {
    const lua = setup();
    playDuel(lua, "Bob Smith has defeated Kev Caron in a duel");
    expect(stat("NS.duels.lastCard.won")).toBe("false");
    expect(stat("NS.duels.lastCard.points")).toBe("nil");
    expect(stat("NS.duels.lastCard.opponent")).toBe("Bob Smith");
    expect(stat("NS.duels.lastCard.losses")).toBe("1");
    lua.run(`CLOCK = CLOCK + 200`);
    say("Cy Jones has fled from Kev Caron in a duel");
    expect(lua.run(`return table.concat(NS.duels.cardLines(NS.duels.lastCard), "\\n")`)).toContain("the opponent fled");
    expect(stat("NS.duels.lastCard.rankChange ~= nil")).toBe("true");
  });

  it("is built from what is known when no countdown was seen: no duration, no numbers", () => {
    const lua = setup();
    say("Kev Caron has defeated Bob Smith in a duel");
    expect(stat("NS.duels.lastCard.duration")).toBe("nil");
    expect(stat("NS.duels.lastCard.health")).toBe("nil");
    expect(lua.run(`return table.concat(NS.duels.cardLines(NS.duels.lastCard), "\\n")`)).not.toContain("Duration");
  });

  it("is not shown for a duel between two other guildmates", () => {
    setup();
    say("Cy Jones has defeated Bob Smith in a duel");
    expect(stat("SHOWS")).toBe("0");
    expect(stat("NS.duels.lastCard")).toBe("nil");
  });

  it("waits for the end of combat, then shows once", () => {
    const lua = setup();
    lua.run(`COMBAT = true`);
    say("Kev Caron has defeated Bob Smith in a duel");
    expect(stat("SHOWS")).toBe("0");
    lua.run(`COMBAT = false; fire_event("PLAYER_REGEN_ENABLED")`);
    expect(stat("SHOWS")).toBe("1");
    lua.run(`fire_event("PLAYER_REGEN_ENABLED")`);
    expect(stat("SHOWS")).toBe("1");
  });

  it("is hidden when the setting is off, and the command and the setting agree", () => {
    const lua = setup();
    lua.run(`NS.commandHandlers.duels({ "card", "off" })`);
    expect(stat("SETTINGS.duelCard")).toBe("false");
    say("Kev Caron has defeated Bob Smith in a duel");
    expect(stat("SHOWS")).toBe("0");
    expect(stat("NS.duels.cardEnabled()")).toBe("false");
    // The preview command shows it anyway.
    lua.run(`NS.commandHandlers.duels({ "card", "test" })`);
    expect(stat("SHOWS")).toBe("1");
    lua.run(`NS.duels.setCardEnabled(true); CLOCK = CLOCK + 200`);
    say("Kev Caron has defeated Bob Smith in a duel");
    expect(stat("SHOWS")).toBe("2");
    expect(stat("NS.duels.cardEnabled()")).toBe("true");
  });

  it("closes with X or a right click, fades after 15 seconds, waits while hovered, moves and remembers its place", () => {
    const lua = setup();
    say("Kev Caron has defeated Bob Smith in a duel");
    expect(stat("VISIBLE")).toBe("true");
    lua.run(`HOVER = true; CARD.scripts.OnUpdate(CARD, 20)`);
    expect(stat("VISIBLE")).toBe("true");
    lua.run(`HOVER = false; CARD.scripts.OnUpdate(CARD, 14)`);
    expect(stat("ALPHA")).toBe("0.5");
    lua.run(`CARD.scripts.OnUpdate(CARD, 1)`);
    expect(stat("VISIBLE")).toBe("false");
    lua.run(`CLOCK = CLOCK + 200`);
    say("Kev Caron has defeated Bob Smith in a duel");
    lua.run(`CARD.scripts.OnMouseUp(CARD, "LeftButton")`);
    expect(stat("VISIBLE")).toBe("true");
    lua.run(`CARD.scripts.OnMouseUp(CARD, "RightButton")`);
    expect(stat("VISIBLE")).toBe("false");
    lua.run(`CLOCK = CLOCK + 200`);
    say("Kev Caron has defeated Bob Smith in a duel");
    lua.run(`CARD.close.scripts.OnClick()`);
    expect(stat("VISIBLE")).toBe("false");
    lua.run(`CARD.GetPoint = function() return "TOP", UIParent, "TOP", 10, -20 end; CARD.scripts.OnDragStop(CARD)`);
    expect(stat("SETTINGS.duelCardPos.x")).toBe("10");
    expect(stat("KB")).toBe("false"); // never asks for the keyboard
  });

  it("goes back into hiding when combat starts while it is open", () => {
    const lua = setup();
    say("Kev Caron has defeated Bob Smith in a duel");
    lua.run(`COMBAT = true; CARD.scripts.OnUpdate(CARD, 1)`);
    expect(stat("VISIBLE")).toBe("false");
    lua.run(`COMBAT = false; fire_event("PLAYER_REGEN_ENABLED")`);
    expect(stat("VISIBLE")).toBe("true");
  });

  it("sends only the one duel result through the shared budget, never from the card", () => {
    const lua = setup();
    playDuel(lua, "Kev Caron has defeated Bob Smith in a duel");
    expect(lua.run(`return table.concat(SENT_LINES, ",")`)).toMatch(/^D\|Kev Caron\|Bob Smith\|\d+\|knockout$/);
    lua.run(`NS.commandHandlers.duels({ "card", "test" })`);
    expect(stat("#SENT_LINES")).toBe("1");
    expect(stat("NS.send")).toBe("nil");
  });

  it("a rematch inside the dedupe window is not recorded and the card shows no points, record or rank", () => {
    const lua = setup();
    playDuel(lua, "Kev Caron has defeated Bob Smith in a duel");
    lua.run(`NOW = 300; fire_event("DUEL_REQUESTED", "Bob Smith"); fire_event("DUEL_COUNTDOWN", 3); NOW = 317; CLOCK = CLOCK + 20`);
    say("Kev Caron has defeated Bob Smith in a duel");
    expect(stat("NS.duels.lastCard.recorded")).toBe("false");
    expect(stat("NS.duels.lastCard.points")).toBe("nil");
    expect(stat("NS.duels.lastCard.wins")).toBe("nil");
    expect(stat("NS.duels.lastCard.rank")).toBe("nil");
    expect(lua.run(`return table.concat(NS.duels.cardLines(NS.duels.lastCard), "\\n")`)).toContain("Not recorded");
    expect(lua.run(`return NS.duels.standings()[1].wins`)).toBe("1");
    expect(stat("#SENT_LINES")).toBe("1"); // and nothing more is shared
  });

  it("when the opponent's message recorded the duel first, my duration and zone fill the row in", () => {
    const lua = setup();
    lua.run(`NOW = 100; fire_event("DUEL_REQUESTED", "Bob Smith"); fire_event("DUEL_COUNTDOWN", 3); NOW = 187; CLOCK = CLOCK + 90`);
    lua.run(`NS.duels.onAddonMessage("D|Kev Caron|Bob Smith|" .. CLOCK .. "|knockout", "Bob Smith-Realm")`);
    say("Kev Caron has defeated Bob Smith in a duel");
    expect(stat("NS.duels.lastCard.recorded")).toBe("true");
    expect(stat("NS.duels.lastCard.points")).toBe("6");
    expect(stat("NS.duels.lastCard.wins")).toBe("1");
    expect(lua.run(`local r; for _, v in pairs(DB.duels.results) do r = v end; return r.dur .. ":" .. r.zone`)).toBe("84:Elwynn Forest");
  });

  it("never loses the duel when the optional card data fails", () => {
    const lua = setup();
    lua.run(`UnitHealth = function() error("boom") end; NOW = 100; fire_event("DUEL_REQUESTED", "Bob Smith"); fire_event("DUEL_COUNTDOWN", 3); NOW = 187; CLOCK = CLOCK + 90`);
    say("Kev Caron has defeated Bob Smith in a duel");
    expect(lua.run(`return NS.duels.standings()[1].wins`)).toBe("1");
    expect(stat("NS.duels.lastCard.health.me")).toBe("nil");
    expect(stat("SHOWS")).toBe("1");
    lua.run(`CLOCK = CLOCK + 200; UnitHealth = function() return "x" end; NOW = 400; fire_event("DUEL_REQUESTED", "Cy Jones"); fire_event("DUEL_COUNTDOWN", 3); NOW = 450`);
    say("Kev Caron has defeated Cy Jones in a duel");
    expect(lua.run(`return #NS.duels.standings()`)).toBe("3");
    // Even the standings read failing before the record cannot stop it.
    lua.run(`CLOCK = CLOCK + 200; NOW = 600; fire_event("DUEL_REQUESTED", "Di Lee"); fire_event("DUEL_COUNTDOWN", 3); NOW = 650; GetGuildRosterInfo = function() error("boom") end; NS.duels.rosterRefresh()`);
    say("Kev Caron has defeated Di Lee in a duel");
    expect(lua.run(`return #NS.duels.standings()`)).toBe("4");
  });

  it("does not remember an empty roster, so the next duel still gets levels", () => {
    const lua = setup();
    lua.run(`REAL = GetNumGuildMembers; GetNumGuildMembers = function() return 0 end`);
    lua.run(`NS.duels.record("Cy Jones", "Di Lee", CLOCK - 500, "knockout")`);
    lua.run(`GetNumGuildMembers = REAL; NS.duels.record("Kev Caron", "Bob Smith", CLOCK - 100, "knockout")`);
    expect(lua.run(`local r; for _, v in pairs(DB.duels.results) do if v.winner == "Kev Caron" then r = v end end; return r.wlv .. ":" .. r.llv`)).toBe("60:58");
  });

  it("a duel over the daily pair allowance is marked not counted", () => {
    const lua = setup();
    lua.run(`for i = 1, 5 do CLOCK = CLOCK + 120; NS.duels.record("Kev Caron", "Bob Smith", CLOCK, "knockout") end; CLOCK = CLOCK + 120`);
    say("Kev Caron has defeated Bob Smith in a duel");
    expect(stat("NS.duels.lastCard.counted")).toBe("false");
    expect(lua.run(`return table.concat(NS.duels.cardLines(NS.duels.lastCard), "\\n")`)).toContain("Not counted");
  });

  it("speaks French on a French client", () => {
    const lua = setup("frFR");
    playDuel(lua, "Bob Smith has defeated Kev Caron in a duel");
    const text = lua.run(`return table.concat(NS.duels.cardLines(NS.duels.lastCard), "\\n")`);
    expect(text).toContain("Durée 1:24");
    expect(text).toContain("Revanche ? Ciblez Bob Smith et choisissez Duel.");
  });
});

describe("duel leaderboard", () => {
  function seed(lua: LuaSession) {
    // Kev beats Bob (levels 60 v 58 = 6 points), Cy beats Kev (60 v 60 = 10), Cy beats Bob (6), Di beats Cy long ago (50 v 60 = 20).
    lua.run(`NS.duels.record("Kev Caron", "Bob Smith", CLOCK - 3 * 3600, "knockout")
      NS.duels.record("Cy Jones", "Kev Caron", CLOCK - 2 * 3600, "knockout")
      NS.duels.record("Cy Jones", "Bob Smith", CLOCK - 3600, "knockout")
      NS.duels.record("Di Lee", "Cy Jones", CLOCK - 10 * 86400, "knockout")`);
  }
  const names = (lua: LuaSession, code: string) => lua.run(`local t = {}; for _, r in ipairs(${code}) do t[#t + 1] = r.name .. "=" .. r.points .. "/" .. r.wins .. "-" .. r.losses end; return table.concat(t, " ")`);

  it("ranks by points, then wins, win rate and fewest losses", () => {
    const lua = setup(); seed(lua);
    expect(names(lua, "NS.duels.standings()")).toBe("Di Lee=20/1-0 Cy Jones=16/2-1 Kev Caron=6/1-1 Bob Smith=0/0-2");
  });

  it("filters by period and by my class, and re-ranks inside the filter", () => {
    const lua = setup(); seed(lua);
    expect(names(lua, "NS.duels.standings({ since = CLOCK - 7 * 86400 })")).toBe("Cy Jones=16/2-0 Kev Caron=6/1-1 Bob Smith=0/0-2");
    expect(names(lua, "NS.duels.standings({ class = 'WARRIOR' })")).toBe("Cy Jones=16/2-1 Kev Caron=6/1-1");
    expect(lua.run(`return NS.duels.standings({ class = 'WARRIOR' })[2].rank`)).toBe("2");
    const view = (state: string) => lua.run(`local v = NS.duels.view(${state}); local t = {}; for _, r in ipairs(v.rows) do t[#t + 1] = r.name end; return v.total .. ":" .. table.concat(t, ",")`);
    expect(view("{ period = 1, myClass = false }")).toBe("3:Cy Jones,Kev Caron,Bob Smith");
    expect(view("{ period = 1, myClass = true }")).toBe("2:Cy Jones,Kev Caron");
    expect(view("{ period = 3, myClass = false }")).toBe("4:Di Lee,Cy Jones,Kev Caron,Bob Smith");
  });

  it("keeps my row visible below the table and gives my record against a selected player", () => {
    const lua = setup();
    lua.run(`for i = 1, 14 do GUILD_MEMBERS["P" .. i] = true; NS.duels.record("P" .. i, "Bob Smith", CLOCK - i * 600, "knockout") end`);
    lua.run(`NS.duels.record("Bob Smith", "Kev Caron", CLOCK - 90, "knockout")`);
    lua.run(`NS.duels.record("Kev Caron", "Bob Smith", CLOCK - 60 * 30, "knockout")`);
    const view = lua.run(`local v = NS.duels.view({ period = 1, myClass = false, selected = "Bob Smith" }); return tostring(v.pinned) .. ":" .. #v.rows .. ":" .. v.mine.rank .. ":" .. v.versus.wins .. "-" .. v.versus.losses .. ":" .. tostring(v.versus.lastWon)`);
    expect(view).toBe("true:12:16:1-1:false"); // Kev is 16th of 16 players, so pinned
  });

  it("shows the 24 hour rank arrows for players whose rank moved, and nothing for a new one", () => {
    const lua = setup();
    lua.run(`NS.duels.record("Kev Caron", "Bob Smith", CLOCK - 2 * 86400, "knockout")`); // yesterday: Kev first
    lua.run(`NS.duels.record("Cy Jones", "Kev Caron", CLOCK - 3600, "knockout"); NS.duels.record("Cy Jones", "Bob Smith", CLOCK - 1800, "knockout")`);
    const v = lua.run(`local v = NS.duels.view({ period = 3 }); local t = {}; for _, r in ipairs(v.rows) do t[#t + 1] = r.name .. ":" .. tostring(r.change) end; return table.concat(t, " ")`);
    expect(v).toBe("Cy Jones:nil Kev Caron:-1 Bob Smith:-1"); // Cy is new in the ranking; Kev fell from 1 to 2 and Bob from 2 to 3
  });

  it("builds the page, redraws on a new duel and shows the empty state", () => {
    const lua = setup();
    lua.run(`PAGE = CreateFrame("Frame"); PAGE.IsShown = function() return true end
      NS.duels.buildPage(PAGE, { newLabel = function(parent, text) return parent:CreateFontString(nil, "OVERLAY", "GameFontNormal") end, at = function(w) return w end, width = 582 })`);
    seed(lua);
    expect(stat("NS.onDuelsChange ~= nil")).toBe("true");
    lua.run(`NS.onDuelsChange(); PAGE.scripts.OnShow()`);
  });

  it("has a French, German and Spanish line for every English text the page and the card use", () => {
    const source = readFileSync(new URL("../../addon/Guilded/Modules/Duels.lua", import.meta.url), "utf8");
    const locale = readFileSync(new URL("../../addon/Guilded/Locale.lua", import.meta.url), "utf8");
    const keys = new Set<string>();
    for (const m of source.matchAll(/\bL\("((?:[^"\\]|\\.)*)"\)/g)) keys.add(m[1]!);
    for (const label of ["This week", "30 days", "All kept"]) keys.add(label);
    expect(keys.size).toBeGreaterThan(30);
    for (const key of keys) {
      const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const found = locale.match(new RegExp(`^(?:  |FR|DE|ES)\\["${escaped}"\\] = "`, "gm"))?.length ?? 0;
      expect(found, `translations of "${key}"`).toBeGreaterThanOrEqual(3);
    }
  });
});
