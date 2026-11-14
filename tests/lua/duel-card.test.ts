import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

// The guild duel leaderboard (sorting, filters, pinned row, head to head, 24 h arrows) and the end-of-duel card
// (Modules/Duels.lua), run against the real Lua file on the mocked client. Two real players are needed to verify the
// card in game; see the pull request.
let s: LuaSession | undefined;
afterEach(() => s?.close());

function setup(locale = "enUS") {
  s = newLuaSession();
  s.run(`DB = { roster = {} }; SETTINGS = {}; CLOCK = 1800000000; NOW = 100; COMBAT = false; SENT_LINES = {}; SHOWS = 0; VISIBLE = false; HOVER = false; FS = {}; TEX = {}; KB = false; REG = {}
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
      -- Recording regions: the card's texts and textures can be read back (FS in creation order, TEX likewise).
      local function region(list)
        return function()
          local r = setmetatable({ GetStringHeight = function() return 120 end }, { __index = function(_, k)
            if k == "SetText" then return function(self, v) rawset(self, "text", v) end end
            if k == "SetTexture" then return function(self, v) rawset(self, "texture", v) end end
            if k == "SetVertexColor" then return function(self, ...) rawset(self, "tint", table.concat({ ... }, ",")) end end
            if k == "Show" then return function(self) rawset(self, "shown", true) end end
            if k == "Hide" then return function(self) rawset(self, "shown", false) end end
            return function() end
          end })
          list[#list + 1] = r
          return r
        end
      end
      frame.CreateFontString = region(FS)
      frame.CreateTexture = region(TEX)
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
  it("a won duel gives victory data with the duration, zone, classes, rating, rank and my health left", () => {
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
    // The first rated duel for both: 60 v 58 gives the winner a small rise (a level-handicapped Elo step, shrunk toward 1000).
    expect(lua.run(`return NS.duels.changeText(NS.duels.lastCard.change) .. ":" .. NS.duels.round(NS.duels.lastCard.score) .. ":" .. NS.duels.opponentRating(NS.duels.lastCard)`)).toBe("+2:1002:998 (-2)");
    expect(d("wins") + d("losses") + d("rank")).toBe("101");
    expect(d("health.me")).toBe("42");
    const text = lua.run(`return table.concat(NS.duels.cardLines(NS.duels.lastCard), "\\n")`);
    expect(text).toContain("Duration 1:24");
    expect(text).toContain("Elwynn Forest");
    expect(text).toContain("your health left 42%");
    expect(text).toContain("Record 1-0 (100%)");
    expect(text).toContain("Rating +2 -> 1002");
    expect(text).not.toContain("points");
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
    expect(stat("NS.duels.changeText(NS.duels.lastCard.change)")).toBe("+2");
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
    // Kev beats Bob (levels 60 v 58), Cy beats Kev (60 v 60), Cy beats Bob, Di beats Cy ten days ago (50 v 60, the level gap handicaps Cy).
    lua.run(`NS.duels.record("Kev Caron", "Bob Smith", CLOCK - 3 * 3600, "knockout")
      NS.duels.record("Cy Jones", "Kev Caron", CLOCK - 2 * 3600, "knockout")
      NS.duels.record("Cy Jones", "Bob Smith", CLOCK - 3600, "knockout")
      NS.duels.record("Di Lee", "Cy Jones", CLOCK - 10 * 86400, "knockout")`);
  }
  const names = (lua: LuaSession, code: string) => lua.run(`local t = {}; for _, r in ipairs(${code}) do t[#t + 1] = r.name .. "=" .. NS.duels.round(r.score) .. "/" .. r.wins .. "-" .. r.losses end; return table.concat(t, " ")`);

  it("ranks everyone from the first duel by rating, then wins", () => {
    const lua = setup(); seed(lua);
    expect(names(lua, "NS.duels.standings()")).toBe("Cy Jones=1003/2-1 Di Lee=1002/1-0 Kev Caron=999/1-1 Bob Smith=994/0-2");
    expect(lua.run(`return NS.duels.standings()[4].rank`)).toBe("4");
  });

  it("keeps each season apart and ignores duels from before the ladders started", () => {
    const lua = setup(); seed(lua);
    // CLOCK is mid January 2027: the season is 2027-01. A December duel belongs to the first season, an October one to nothing.
    lua.run(`NS.duels.record("Bob Smith", "Kev Caron", CLOCK - 25 * 86400, "knockout")`);
    expect(names(lua, "NS.duels.standings({ season = '2026-11' })")).toBe("Bob Smith=1002/1-0 Kev Caron=998/0-1");
    expect(names(lua, "NS.duels.standings()")).toBe("Cy Jones=1003/2-1 Di Lee=1002/1-0 Kev Caron=999/1-1 Bob Smith=994/0-2");
    lua.run(`DB.duels.results["old"] = { winner = "Kev Caron", loser = "Bob Smith", at = ${1794528000 - 3600}, reason = "knockout" }`);
    expect(lua.run(`return #NS.duels.standings({ season = '2026-11' })`)).toBe("2");
    expect(lua.run(`return table.concat(NS.duels.seasons(), ",")`)).toBe("2027-01,2026-11");
  });

  it("an arrival out of order re-rates the season instead of adding a delta", () => {
    const lua = setup();
    lua.run(`NS.duels.record("Kev Caron", "Bob Smith", CLOCK - 3 * 3600, "knockout"); NS.duels.record("Cy Jones", "Kev Caron", CLOCK - 3600, "knockout")`);
    const before = names(lua, "NS.duels.standings()");
    lua.run(`NS.duels.record("Bob Smith", "Kev Caron", CLOCK - 5 * 3600, "knockout")`); // an older duel that arrives late
    const after = names(lua, "NS.duels.standings()");
    expect(after).not.toBe(before);
    // The same four duels in any arrival order give the same ratings.
    const other = setup();
    other.run(`NS.duels.record("Bob Smith", "Kev Caron", CLOCK - 5 * 3600, "knockout"); NS.duels.record("Cy Jones", "Kev Caron", CLOCK - 3600, "knockout"); NS.duels.record("Kev Caron", "Bob Smith", CLOCK - 3 * 3600, "knockout")`);
    expect(names(other, "NS.duels.standings()")).toBe(after);
  });

  it("a rematch inside two minutes is one duel", () => {
    const lua = setup();
    expect(lua.run(`return tostring(NS.duels.record("Kev Caron", "Bob Smith", CLOCK - 1000, "knockout"))`)).toBe("true");
    expect(lua.run(`return tostring(NS.duels.record("Kev Caron", "Bob Smith", CLOCK - 1000 + 119, "knockout"))`)).toBe("false");
    expect(lua.run(`return tostring(NS.duels.record("Kev Caron", "Bob Smith", CLOCK - 1000 + 121, "knockout"))`)).toBe("true");
  });

  it("uses the repeat-duel fractions the server sends, and counts every duel in full without them", () => {
    const lua = setup();
    lua.run(`for i = 1, 4 do NS.duels.record("Kev Caron", "Bob Smith", CLOCK - 3000 + i * 200, "knockout") end`);
    const full = lua.run(`return NS.duels.round(NS.duels.standings()[1].score * 100)`);
    expect(lua.run(`return tostring(NS.duels.setPairWeights({ 1, "x" }))`)).toBe("false");
    expect(lua.run(`return tostring(NS.duels.setPairWeights({ 1, 0.5, 0 }))`)).toBe("true");
    const reduced = lua.run(`return NS.duels.round(NS.duels.standings()[1].score * 100)`);
    expect(Number(reduced)).toBeLessThan(Number(full));
    expect(lua.run(`local r = NS.duels.standings()[1]; return r.wins .. "/" .. r.rated`)).toBe("4/2");
    lua.run(`NS.duels.setPairWeights(nil)`);
    expect(lua.run(`return NS.duels.round(NS.duels.standings()[1].score * 100)`)).toBe(full);
  });

  it("filters by my class, and re-ranks inside the filter", () => {
    const lua = setup(); seed(lua);
    expect(names(lua, "NS.duels.standings({ class = 'WARRIOR' })")).toBe("Cy Jones=1003/2-1 Kev Caron=999/1-1");
    expect(lua.run(`return NS.duels.standings({ class = 'WARRIOR' })[2].rank`)).toBe("2");
    const view = (state: string) => lua.run(`local v = NS.duels.view(${state}); local t = {}; for _, r in ipairs(v.rows) do t[#t + 1] = r.name end; return v.total .. ":" .. table.concat(t, ",")`);
    expect(view("{ season = 1, myClass = false }")).toBe("4:Cy Jones,Di Lee,Kev Caron,Bob Smith");
    expect(view("{ season = 1, myClass = true }")).toBe("2:Cy Jones,Kev Caron");
  });

  it("keeps my row visible below the table and gives my record against a selected player", () => {
    const lua = setup();
    lua.run(`for i = 1, 14 do GUILD_MEMBERS["P" .. i] = true; NS.duels.record("P" .. i, "Bob Smith", CLOCK - i * 600, "knockout") end`);
    lua.run(`NS.duels.record("Bob Smith", "Kev Caron", CLOCK - 90, "knockout")`);
    lua.run(`NS.duels.record("Kev Caron", "Bob Smith", CLOCK - 60 * 30, "knockout")`);
    const view = lua.run(`local v = NS.duels.view({ season = 1, myClass = false, selected = "Bob Smith" }); return tostring(v.pinned) .. ":" .. #v.rows .. ":" .. v.mine.rank .. ":" .. v.versus.wins .. "-" .. v.versus.losses .. ":" .. tostring(v.versus.lastWon)`);
    expect(view).toBe("true:12:15:1-1:false"); // Kev is 15th of 16 players, so pinned
  });

  it("shows the 24 hour rank arrows for players whose rank moved, and nothing for a new one", () => {
    const lua = setup();
    lua.run(`NS.duels.record("Kev Caron", "Bob Smith", CLOCK - 2 * 86400, "knockout")`); // yesterday: Kev first
    lua.run(`NS.duels.record("Cy Jones", "Kev Caron", CLOCK - 3600, "knockout"); NS.duels.record("Cy Jones", "Bob Smith", CLOCK - 1800, "knockout")`);
    const v = lua.run(`local v = NS.duels.view({ season = 1 }); local t = {}; for _, r in ipairs(v.rows) do t[#t + 1] = r.name .. ":" .. tostring(r.change) end; return table.concat(t, " ")`);
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
    expect(keys.size).toBeGreaterThan(30);
    for (const key of keys) {
      const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const found = locale.match(new RegExp(`^(?:  |FR|DE|ES)\\["${escaped}"\\] = "`, "gm"))?.length ?? 0;
      expect(found, `translations of "${key}"`).toBeGreaterThanOrEqual(3);
    }
  });

  // What the card shows, read from the recorded texts (shown regions only) and textures.
  const texts = (lua: LuaSession) => lua.run(String.raw`local t = {} for _, r in ipairs(FS) do local x = rawget(r, "text") if type(x) == "string" and x ~= "" and rawget(r, "shown") ~= false then t[#t + 1] = x end end return table.concat(t, "\n")`);
  const art = (lua: LuaSession) => lua.run(String.raw`local r = CARD.art or TEX[1] return tostring(rawget(TEX[1], "shown")) .. "|" .. tostring(rawget(TEX[1], "texture")) .. "|" .. tostring(rawget(TEX[1], "tint"))`);

  it("shows the card after a duel with someone who is not in the guild, with no points or rank, and records nothing", () => {
    const lua = setup();
    lua.run(`UnitClass = function(unit) if unit == "target" then return "Warlock", "WARLOCK" end return "Warrior", "WARRIOR" end
      UnitLevel = function(unit) if unit == "target" then return 23 end return 60 end
      UnitExists = function(unit) return unit == "target" end
      UnitName = function(unit) if unit == "target" then return "Zed" end return "Kev" end`);
    lua.run(`NOW = 100; fire_event("DUEL_COUNTDOWN", 3); NOW = 160; CLOCK = CLOCK + 60`);
    say("Kev Caron has defeated Zed Outsider in a duel");
    expect(stat("SHOWS")).toBe("1");
    expect(stat("VISIBLE")).toBe("true");
    const t = texts(lua);
    expect(t).toContain("VICTORY");
    expect(t).toContain("Zed Outsider");
    expect(t).toContain("Not counted on the guild ladder: Zed Outsider is not in your guild.");
    expect(t).toContain("Elwynn Forest");
    expect(t).not.toContain("points");
    expect(t).not.toContain("Guild rank");
    expect(lua.run("return tostring(NS.duels.lastCard.outsider) .. tostring(NS.duels.lastCard.points)")).toBe("truenil");
    // Class and level from the target when it was the opponent.
    expect(lua.run("return NS.duels.lastCard.oppClass .. NS.duels.lastCard.oppLevel")).toBe("WARLOCK23");
    // Never recorded, never shared with the guild.
    expect(lua.run("local n = 0 for _ in pairs(DB.duels and DB.duels.results or {}) do n = n + 1 end return n")).toBe("0");
    expect(lua.run("return #SENT_LINES")).toBe("0");
    expect(lua.run("return #NS.duels.standings()")).toBe("0");
  });

  it("shows just the name for a non-guild opponent that was not targeted, and still waits for combat to end", () => {
    const lua = setup();
    lua.run("UnitExists = function() return false end; COMBAT = true");
    say("Zed Outsider has defeated Kev Caron in a duel");
    expect(stat("VISIBLE")).toBe("false");
    lua.run("COMBAT = false; fire_event('PLAYER_REGEN_ENABLED')");
    expect(stat("VISIBLE")).toBe("true");
    const t = texts(lua);
    expect(t).toContain("DEFEAT");
    expect(t).toContain("Zed Outsider");
    expect(t).not.toMatch(/Zed Outsider\|r {2}\|cff/); // no class or level detail after the name
    expect(lua.run("return tostring(NS.duels.lastCard.oppClass)")).toBe("nil");
  });

  it("draws the painting tinted for a win and for a defeat, and the plain card when Card art is off", () => {
    const lua = setup();
    playDuel(lua, "Kev Caron has defeated Bob Smith in a duel");
    expect(art(lua)).toBe("true|Interface\\AddOns\\Guilded\\Media\\DuelCard|0.85,1,0.72");
    lua.run("CARD:Hide(); CLOCK = CLOCK + 5000");
    playDuel(lua, "Bob Smith has defeated Kev Caron in a duel");
    expect(art(lua)).toContain("1,0.55,0.5");
    lua.run("SETTINGS.cardArt = false; CLOCK = CLOCK + 5000");
    playDuel(lua, "Kev Caron has defeated Bob Smith in a duel");
    expect(lua.run("return tostring(rawget(TEX[1], 'shown')) .. tostring(rawget(TEX[2], 'shown'))")).toBe("falsefalse");
    expect(stat("VISIBLE")).toBe("true");
  });

  it("lays the stats out in labelled columns: record, rating, rank, and a streak only from two in a row", () => {
    const lua = setup();
    playDuel(lua, "Kev Caron has defeated Bob Smith in a duel");
    let stats = lua.run(String.raw`local t = {} for _, c in ipairs(NS.duels.cardStats(NS.duels.lastCard)) do t[#t + 1] = c.label .. "=" .. c.value end return table.concat(t, "|")`);
    expect(stats).toBe("Record=1-0|Rating=+2|Guild rank=#1");
    expect(texts(lua)).toContain("100%");
    expect(texts(lua)).toContain("-> 1002");
    expect(texts(lua)).toContain("998 (-2)");
    lua.run("CARD:Hide(); CLOCK = CLOCK + 5000");
    playDuel(lua, "Kev Caron has defeated Cy Jones in a duel");
    stats = lua.run(String.raw`local t = {} for _, c in ipairs(NS.duels.cardStats(NS.duels.lastCard)) do t[#t + 1] = c.label .. "=" .. c.value end return table.concat(t, "|")`);
    expect(stats).toMatch(/^Record=2-0\|Rating=\+\d+\|Guild rank=#1\|Streak=W2$/);
    expect(texts(lua)).toContain("Streak");
    // Not counted: a sentence instead of the columns.
    expect(lua.run("return #NS.duels.cardStats({ outsider = true, won = true })")).toBe("0");
  });

  it("cuts long names so nothing runs past the card", () => {
    const lua = setup();
    expect(lua.run(`return NS.duels.fitName("Averyveryverylongcharactername", 20)`)).toBe("Averyveryverylong...");
    expect(lua.run(`return NS.duels.fitName("Short", 20)`)).toBe("Short");
    lua.run(`GUILD_MEMBERS["Averyveryverylongcharactername"] = true`);
    say("Kev Caron has defeated Averyveryverylongcharactername in a duel");
    expect(texts(lua)).toContain("Averyveryverylong...");
    expect(texts(lua)).not.toContain("Averyveryverylongcharactername");
  });

  it("speaks French on a French client", () => {
    const lua = setup("frFR");
    lua.run(`GetLocale = function() return "frFR" end`);
    lua.load("Locale.lua");
    say("Zed Outsider has defeated Kev Caron in a duel");
    expect(texts(lua)).toContain("n'est pas dans votre guilde");
  });

  it("ships Media/DuelCard.blp as a BLP2 texture with power-of-two sides", () => {
    const file = readFileSync(new URL("../../addon/Guilded/Media/DuelCard.blp", import.meta.url));
    expect(file.subarray(0, 4).toString("ascii")).toBe("BLP2");
    const w = file.readUInt32LE(12), h = file.readUInt32LE(16);
    for (const side of [w, h]) { expect(side).toBeGreaterThan(0); expect(side & (side - 1)).toBe(0); }
    expect(file.length).toBeLessThan(200 * 1024);
    expect(setup() && stat("NS.duels.CARD_ART")).toBe("Interface\\AddOns\\Guilded\\Media\\DuelCard");
  });

  it("cuts an accented long name on a character boundary, never inside a UTF-8 sequence", () => {
    const lua = setup();
    // "A" + E-acute (2 bytes) + "lodie Gagnon-Tremblay": a cut of 5 would land inside the accent.
    expect(lua.run(String.raw`return NS.duels.fitName("A\195\137lodie Gagnon-Tremblay", 5)`)).toBe("A...");
    expect(lua.run(String.raw`return NS.duels.fitName("\195\137lodie Gagnon-Tremblay", 5)`)).toBe("\u00c9...");
    expect(lua.run(String.raw`return NS.duels.fitName("\195\137lodie Gagnon-Tremblay", 4)`)).toBe("...");
    expect(lua.run(String.raw`return NS.duels.fitName("Short \195\137", 20)`)).toBe("Short \u00c9");
  });

  it("says the opponent fled after a duel with a non-guildmate", () => {
    const lua = setup();
    lua.run("UnitExists = function() return false end");
    say("Zed Outsider has fled from Kev Caron in a duel");
    const t = texts(lua);
    expect(t).toContain("VICTORY");
    expect(t).toContain("the opponent fled");
    expect(t).toContain("Not counted on the guild ladder: Zed Outsider is not in your guild.");
  });

  it("does not claim a guildmate is an outsider while the guild roster has not loaded", () => {
    const lua = setup();
    lua.run(`GUILD_MEMBERS = {}; IsInGuild = function() return true end; GetNumGuildMembers = function() return 0 end; UnitExists = function() return false end`);
    say("Kev Caron has defeated Bob Smith in a duel");
    const t = texts(lua);
    expect(t).toContain("Not counted yet: the guild roster has not loaded.");
    expect(t).not.toContain("is not in your guild");
    expect(lua.run("return tostring(NS.duels.lastCard.outsider) .. tostring(NS.duels.lastCard.rosterPending)")).toBe("falsetrue");
    expect(lua.run("return #NS.duels.cardStats(NS.duels.lastCard)")).toBe("0");
  });

  it("remembers the opponent's class and level from the target when the duel starts", () => {
    const lua = setup();
    lua.run(`UnitExists = function(unit) return unit == "target" and TARGETED end; TARGETED = true
      UnitName = function(unit) if unit == "target" then return "Zed" end return "Kev" end
      UnitClass = function(unit) if unit == "target" then return "Warlock", "WARLOCK" end return "Warrior", "WARRIOR" end
      UnitLevel = function(unit) if unit == "target" then return 31 end return 60 end`);
    lua.run(`NOW = 100; fire_event("DUEL_COUNTDOWN", 3); NOW = 150; CLOCK = CLOCK + 50; TARGETED = false`); // no longer targeted at the end
    say("Zed Outsider has defeated Kev Caron in a duel");
    expect(lua.run("return NS.duels.lastCard.oppClass .. NS.duels.lastCard.oppLevel")).toBe("WARLOCK31");
  });

  it("draws four stat columns when a streak joins the record, rating and rank", () => {
    const lua = setup();
    playDuel(lua, "Kev Caron has defeated Bob Smith in a duel");
    lua.run("CARD:Hide(); CLOCK = CLOCK + 5000");
    playDuel(lua, "Kev Caron has defeated Cy Jones in a duel");
    expect(lua.run("return #NS.duels.cardStats(NS.duels.lastCard)")).toBe("4");
    expect(texts(lua)).toContain("Streak");
    expect(texts(lua)).toContain("W2");
  });
});

describe("duels outside the guild, recorded for the upload", () => {
  const BIT = `bit = {
    band = function(a, b) return a & b end, bxor = function(a, b, c) return a ~ b ~ (c or 0) end, bnot = function(a) return ~a end,
    rshift = function(a, n) return (a & 0xffffffff) >> n end, bor = function(a, b) return a | b end, lshift = function(a, n) return (a << n) & 0xffffffff end
  }`;
  function outsider() {
    const lua = setup();
    lua.run(`UnitExists = function(unit) return unit == "target" end
      UnitName = function(unit) if unit == "target" then return "Zed Outsider" end return "Kev" end
      UnitClass = function(unit) if unit == "target" then return "Warlock", "WARLOCK" end return "Warrior", "WARRIOR" end
      UnitLevel = function(unit) if unit == "target" then return 23 end return 60 end
      GetGuildInfo = function(unit) if unit == "target" then return "Zed's Band" end return "Quebec Gold" end
      GetRealmName = function() return "Mirage Raceway" end`);
    return lua;
  }
  const field = (lua: LuaSession, seq: number, name: string) => lua.run(`local r; for _, v in pairs(DB.duels.external or {}) do if v.seq == ${seq} then r = v end end; return tostring(r and ${name})`);
  const chain = (prev: string, nonce: string, seq: number, winner: string, loser: string, at: number, realm: string, reason = "knockout") =>
    createHash("sha256").update([prev, nonce, seq, winner, realm, loser, realm, at, reason].join("|")).digest("hex").slice(0, 16);

  it("keeps my win with the details only this client saw, and nothing on the guild ladder", () => {
    const lua = outsider();
    lua.run(`NOW = 100; fire_event("DUEL_COUNTDOWN", 3); NOW = 160; CLOCK = CLOCK + 60`);
    say("Kev Caron has defeated Zed Outsider in a duel");
    const at = Number(lua.run("return CLOCK"));
    expect(lua.run(`local n = 0; for _ in pairs(DB.duels.external) do n = n + 1 end; return n`)).toBe("1");
    expect(field(lua, 1, "r.side .. r.winner .. r.loser .. r.reason")).toBe("winnerKev CaronZed Outsiderknockout");
    expect(field(lua, 1, "r.winnerRealm .. '/' .. r.loserRealm")).toBe("Mirage Raceway/Mirage Raceway");
    expect(field(lua, 1, "r.winnerClass .. r.loserClass .. r.winnerLevel .. r.loserLevel")).toBe("WarriorWarlock6023");
    expect(field(lua, 1, "r.winnerGuild .. '|' .. r.loserGuild")).toBe("Quebec Gold|Zed's Band");
    expect(field(lua, 1, "r.zone .. ':' .. r.durationSec")).toBe("Elwynn Forest:57");
    expect(field(lua, 1, "r.evidence.endAt")).toBe(String(at));
    expect(Number(field(lua, 1, "r.evidence.startAt")) - Number(field(lua, 1, "r.evidence.countdownAt"))).toBe(3);
    expect(field(lua, 1, "r.evidence.zoneWinner .. r.evidence.zoneLoser")).toBe("Elwynn ForestElwynn Forest");
    expect(lua.run("local n = 0 for _ in pairs(DB.duels.results) do n = n + 1 end return n")).toBe("0");
    expect(lua.run("return #SENT_LINES")).toBe("0");
  });

  it("says which side I was when I lost", () => {
    const lua = outsider();
    say("Zed Outsider has defeated Kev Caron in a duel");
    expect(field(lua, 1, "r.side .. r.winnerLevel .. r.loserLevel .. r.winnerClass .. r.loserClass")).toBe("loser2360WarlockWarrior");
  });

  it("without a challenge there is no chain, but the running number still counts up and is never reused", () => {
    const lua = outsider();
    lua.run(BIT);
    say("Kev Caron has defeated Zed Outsider in a duel");
    lua.run("CLOCK = CLOCK + 300");
    say("Zed Outsider has defeated Kev Caron in a duel");
    expect(field(lua, 1, "r.chain")).toBe("nil");
    expect(field(lua, 2, "r.nonce")).toBe("nil");
    expect(lua.run("return DB.duels.extSeq")).toBe("2");
  });

  it("with a challenge each record links to the one before (the same hash the bot checks)", () => {
    const lua = outsider();
    lua.run(BIT);
    expect(lua.run(`return tostring(NS.duels.setChallenge("not hex"))`)).toBe("false");
    expect(lua.run(`return tostring(NS.duels.setChallenge("0123456789abcdef"))`)).toBe("true");
    say("Kev Caron has defeated Zed Outsider in a duel");
    const at1 = Number(lua.run("return CLOCK"));
    lua.run("CLOCK = CLOCK + 300");
    say("Zed Outsider has defeated Kev Caron in a duel");
    const at2 = Number(lua.run("return CLOCK"));
    const realm = "Mirage Raceway";
    const first = chain("0000000000000000", "0123456789abcdef", 1, "Kev Caron", "Zed Outsider", at1, realm);
    expect(field(lua, 1, "r.prev")).toBe("0000000000000000");
    expect(field(lua, 1, "r.chain")).toBe(first);
    expect(field(lua, 2, "r.prev")).toBe(first);
    expect(field(lua, 2, "r.chain")).toBe(chain(first, "0123456789abcdef", 2, "Zed Outsider", "Kev Caron", at2, realm));
  });

  it("without a bit library the record is still kept, only without a chain", () => {
    const lua = outsider();
    lua.run(`NS.duels.setChallenge("0123456789abcdef")`);
    say("Kev Caron has defeated Zed Outsider in a duel");
    expect(field(lua, 1, "r.nonce")).toBe("0123456789abcdef");
    expect(field(lua, 1, "r.chain")).toBe("nil");
  });

  it("records one duel once, whoever reports it twice within two minutes", () => {
    const lua = outsider();
    say("Kev Caron has defeated Zed Outsider in a duel");
    lua.run("CLOCK = CLOCK + 100");
    say("Kev Caron has defeated Zed Outsider in a duel");
    expect(lua.run(`local n = 0; for _ in pairs(DB.duels.external) do n = n + 1 end; return n`)).toBe("1");
    lua.run("CLOCK = CLOCK + 100");
    say("Kev Caron has defeated Zed Outsider in a duel");
    expect(lua.run(`local n = 0; for _ in pairs(DB.duels.external) do n = n + 1 end; return n`)).toBe("2");
  });

  it("records nothing while the guild roster has not loaded, and nothing for a guildmate", () => {
    const lua = outsider();
    lua.run(`GUILD_MEMBERS = {}; GetNumGuildMembers = function() return 0 end`);
    say("Kev Caron has defeated Zed Outsider in a duel");
    expect(lua.run(`return tostring(DB.duels and DB.duels.external)`)).toBe("nil");
    const second = outsider();
    playDuel(second, "Kev Caron has defeated Bob Smith in a duel");
    expect(second.run(`return tostring(DB.duels and DB.duels.external)`)).toBe("nil");
  });

  it("leaves the opponent's guild out when the target is someone else", () => {
    const lua = setup();
    lua.run(`UnitExists = function() return false end; GetRealmName = function() return "R" end; GetGuildInfo = function() return "Quebec Gold" end`);
    say("Kev Caron has defeated Zed Outsider in a duel");
    expect(field(lua, 1, "r.loserGuild")).toBe("nil");
    expect(field(lua, 1, "r.loserLevel")).toBe("nil");
    expect(field(lua, 1, "r.winnerGuild")).toBe("Quebec Gold");
  });
});
