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
    NS.util.unitKey = function(unit) if unit ~= nil and unit ~= "player" then return nil end return "Kev Caron" end`);
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

  it("the test preview always has a stat row (sample numbers, marked as a preview) and saves nothing", () => {
    const lua = setup();
    lua.run(`NS.commandHandlers.duels({ "card", "test" })`);
    const labels = lua.run(String.raw`local t = {} for _, c in ipairs(NS.duels.cardStats(NS.duels.sampleCard())) do t[#t + 1] = c.label end return table.concat(t, "|")`);
    expect(labels).toContain("Record");
    expect(labels).toContain("Rating");
    expect(labels).toContain("Guild rank");
    expect(lua.run(`return tostring(NS.duels.sampleCard().preview)`)).toBe("true");
    expect(lua.run(`return #(NS.duels.store and NS.duels.store().log or {})`)).toBe("0");
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
    expect(lua.run(`return table.concat(SENT_LINES, ",")`)).toMatch(/^D\|Kev Caron\|Bob Smith\|\d+\|knockout,S\|Kev Caron\|Bob Smith\|\d+\|w\|84\|58\|0\|42\|42\|100$/); // 9.5: the duel line unchanged, then my health numbers in their own message
    lua.run(`NS.commandHandlers.duels({ "card", "test" })`);
    expect(stat("#SENT_LINES")).toBe("2");
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
    expect(stat("#SENT_LINES")).toBe("2"); // the duel and my numbers; nothing more for the rematch
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
    expect(text).toContain("Revanche ? Cible Bob Smith et choisis Duel.");
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

  it("drops rows from before the ladders started and keeps the whole current season when it prunes", () => {
    const lua = setup();
    lua.run(`DB.duels = { results = {} }
      for i = 1, 3 do DB.duels.results["old" .. i] = { winner = "Kev Caron", loser = "Bob Smith", at = 1794528000 - i * 4000, reason = "knockout" } end
      for i = 1, 520 do DB.duels.results["cur" .. i] = { winner = "Kev Caron", loser = "Bob Smith", at = CLOCK - 1000000 + i * 200, reason = "knockout" } end
      NS.duels.record("Cy Jones", "Di Lee", CLOCK - 100, "knockout")`);
    expect(lua.run(`local n, old = 0, 0; for k in pairs(DB.duels.results) do n = n + 1; if k:find("^old") then old = old + 1 end end; return n .. ":" .. old`)).toBe("521:0");
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

  it("takes the opponent's realm from their unit, never assuming it is mine", () => {
    const lua = outsider();
    lua.run(`UnitFullName = function(unit) if unit == "target" then return "Zed Outsider", "Other Realm" end return "Kev", nil end`);
    say("Kev Caron has defeated Zed Outsider in a duel");
    expect(field(lua, 1, "r.winnerRealm .. '/' .. r.loserRealm")).toBe("Mirage Raceway/OtherRealm");
    lua.run("CLOCK = CLOCK + 300");
    say("Zed Outsider has defeated Kev Caron in a duel");
    expect(field(lua, 2, "r.winnerRealm .. '/' .. r.loserRealm")).toBe("OtherRealm/Mirage Raceway");
  });

  it("uses my realm for an opponent of my own realm (the game gives none), and ignores a damaged realm", () => {
    const lua = outsider();
    lua.run(`UnitFullName = function(unit) return "Zed Outsider", nil end`);
    say("Kev Caron has defeated Zed Outsider in a duel");
    expect(field(lua, 1, "r.loserRealm")).toBe("Mirage Raceway");
    lua.run(`UnitFullName = function(unit) return "Zed Outsider", "Bad|Realm" end; CLOCK = CLOCK + 300`);
    say("Kev Caron has defeated Zed Outsider in a duel");
    expect(field(lua, 2, "r.loserRealm")).toBe("Mirage Raceway");
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

// The two-PC test of 14 November 2026: Lebowski Highspirits (no guild) beat Blunt Cruising (in the guild), in a party, with no
// countdown seen on either side and both players still in combat when the result line came. Each side is one client.
describe("a duel between a guild member and a player outside every guild, on both clients", () => {
  const LINE = "Lebowski Highspirits has defeated Blunt Cruising in a duel";
  function client(me: string, inGuild: boolean, locale = "enUS") {
    const lua = setup(locale);
    lua.run(`DIAGS = {}
      NS.util.unitKey = function(unit) if unit ~= nil and unit ~= "player" then return nil end return "${me}" end
      UnitName = function(unit) if unit == "target" then return nil end return "${me.split(" ")[0]}" end
      UnitExists = function() return false end
      UnitClass = function() if ${inGuild} then return "Warlock", "WARLOCK" end return "Priest", "PRIEST" end
      UnitLevel = function() if ${inGuild} then return 1 end return 4 end
      GUILD_MEMBERS = ${inGuild ? `{ ["${me}"] = true, ["Bob Smith"] = true }` : "{}"}
      ROSTER = ${inGuild ? `{ { "${me}", 1, "WARLOCK" }, { "Bob Smith", 58, "MAGE" } }` : "{}"}
      IsInGuild = function() return ${inGuild} end
      GetGuildInfo = function(unit) if unit == "player" and ${inGuild} then return "Quebec Gold" end return nil end
      GetRealmName = function() return "Realm Two" end
      GetZoneText = function() return "Valley of Trials" end
      UnitAffectingCombat = function() return COMBAT end
      NS.logDiagnostic = function(kind, detail) DIAGS[#DIAGS + 1] = kind .. " " .. tostring(detail) end`);
    return lua;
  }
  const one = (lua: LuaSession, code: string) => lua.run(`local r; for _, v in pairs(DB.duels and DB.duels.external or {}) do r = v end; return tostring(r and ${code})`);
  const count = (lua: LuaSession) => lua.run(`local n = 0; for _ in pairs(DB.duels and DB.duels.external or {}) do n = n + 1 end; return n`);

  it("the winner outside every guild keeps the duel, sees one line at once and the card once combat ends", () => {
    const lua = client("Lebowski Highspirits", false);
    lua.run(`COMBAT = true`);
    say(LINE);
    expect(count(lua)).toBe("1");
    expect(one(lua, "r.side .. '|' .. r.winner .. '|' .. r.loser .. '|' .. r.reason")).toBe("winner|Lebowski Highspirits|Blunt Cruising|knockout");
    expect(one(lua, "r.winnerClass .. r.winnerLevel .. '|' .. tostring(r.winnerGuild)")).toBe("Priest4|nil");
    // No countdown: the zone still comes from the result line, on the record and in its evidence.
    expect(one(lua, "r.zone .. '|' .. r.evidence.zoneWinner .. '|' .. tostring(r.evidence.endAt == r.at) .. '|' .. tostring(r.durationSec)")).toBe("Valley of Trials|Valley of Trials|true|nil");
    expect(stat("MSGS")).toContain("Duel won against Blunt Cruising.");
    // In combat the card waits; it shows when combat ends.
    expect(stat("SHOWS")).toBe("0");
    lua.run(`COMBAT = false; fire_event("PLAYER_REGEN_ENABLED")`);
    expect(stat("SHOWS")).toBe("1");
    expect(stat("NS.duels.lastCard.won")).toBe("true");
    // Never on the guild ladder, never sent to a guild.
    expect(lua.run("local n = 0 for _ in pairs(DB.duels.results) do n = n + 1 end return n")).toBe("0");
    expect(lua.run("return #SENT_LINES")).toBe("0");
    expect(lua.run("return #DIAGS")).toBe("0");
  });

  it("the loser in the guild keeps the same duel as the loser, with the same line and card", () => {
    const lua = client("Blunt Cruising", true);
    lua.run(`COMBAT = true`);
    say(LINE);
    expect(count(lua)).toBe("1");
    expect(one(lua, "r.side .. '|' .. r.winner .. '|' .. r.loser .. '|' .. r.loserGuild .. '|' .. tostring(r.winnerGuild)")).toBe("loser|Lebowski Highspirits|Blunt Cruising|Quebec Gold|nil");
    expect(one(lua, "r.loserClass .. r.loserLevel .. '|' .. r.zone")).toBe("Warlock1|Valley of Trials");
    expect(stat("MSGS")).toContain("Duel lost against Lebowski Highspirits.");
    lua.run(`COMBAT = false; fire_event("PLAYER_REGEN_ENABLED")`);
    expect(stat("SHOWS")).toBe("1");
    expect(stat("NS.duels.lastCard.won")).toBe("false");
    expect(lua.run("return #SENT_LINES")).toBe("0");
  });

  it("both clients make the same pair and time, so the bot can match the two reports", () => {
    const winner = client("Lebowski Highspirits", false);
    say(LINE);
    const w = one(winner, "r.winner .. '|' .. r.loser .. '|' .. r.at .. '|' .. r.winnerRealm .. '|' .. r.loserRealm");
    winner.close();
    const loser = client("Blunt Cruising", true);
    say(LINE);
    expect(one(loser, "r.winner .. '|' .. r.loser .. '|' .. r.at .. '|' .. r.winnerRealm .. '|' .. r.loserRealm")).toBe(w);
  });

  it("a guild duel and a fled duel get their line too", () => {
    const lua = client("Blunt Cruising", true);
    say("Bob Smith has defeated Blunt Cruising in a duel");
    expect(stat("MSGS")).toContain("Duel lost against Bob Smith.");
    lua.run("CLOCK = CLOCK + 300");
    say("Lebowski Highspirits has fled from Blunt Cruising in a duel");
    expect(stat("MSGS")).toContain("Duel won: Lebowski Highspirits fled.");
    lua.run("CLOCK = CLOCK + 300");
    say("Blunt Cruising has fled from Bob Smith in a duel");
    expect(stat("MSGS")).toContain("Duel lost: you fled from Bob Smith.");
  });

  it("a duel between two other players prints nothing", () => {
    const lua = client("Blunt Cruising", true);
    say("Bob Smith has defeated Zed Outsider in a duel");
    expect(lua.run("return tostring(MSGS)")).toBe("nil");
  });

  it("the line still comes, the duel is still kept, and the failure is saved when the card cannot be drawn", () => {
    const lua = client("Lebowski Highspirits", false);
    lua.run(`NS.util.keepApart = function() error("card broke") end`);
    say(LINE);
    expect(stat("MSGS")).toContain("Duel won against Blunt Cruising.");
    expect(count(lua)).toBe("1");
    expect(lua.run("return DIAGS[1]")).toContain("card broke");
    expect(lua.run("return DIAGS[1]")).toMatch(/^LUA_ERROR duels: /);
  });

  it("says it in French", () => {
    client("Blunt Cruising", true, "frFR");
    say(LINE);
    expect(stat("MSGS")).toContain("Duel perdu contre Lebowski Highspirits.");
  });

  // Right after login a guild member's client has IsInGuild() but GetNumGuildMembers() == 0: who is a guildmate cannot be said yet.
  function loading(me = "Blunt Cruising") {
    const lua = client(me, true);
    lua.run(`TIMERS = {}; ASKED = 0
      C_Timer = { After = function(_, fn) TIMERS[#TIMERS + 1] = fn end }
      function run_timers(n) for _ = 1, n or 20 do local list = TIMERS; TIMERS = {}; if #list == 0 then return end; for _, fn in ipairs(list) do fn() end end end
      C_GuildInfo = { GuildRoster = function() ASKED = ASKED + 1 end }
      SAVED_MEMBERS, SAVED_ROSTER = GUILD_MEMBERS, ROSTER
      GUILD_MEMBERS, ROSTER = {}, {}
      function load_roster() GUILD_MEMBERS, ROSTER = SAVED_MEMBERS, SAVED_ROSTER; fire_event("GUILD_ROSTER_UPDATE") end`);
    return lua;
  }

  it("the loser's client keeps a duel that ended before the guild roster loaded, and records it once the roster is there", () => {
    const lua = loading();
    say(LINE);
    expect(stat("MSGS")).toContain("Duel lost against Lebowski Highspirits.");
    expect(count(lua)).toBe("0");
    expect(stat("NS.duels.pendingCount()")).toBe("1");
    // The roster is asked for once, out of combat; an update that still has no roster asks nothing more.
    expect(stat("ASKED")).toBe("1");
    lua.run(`fire_event("GUILD_ROSTER_UPDATE")`);
    expect(stat("ASKED")).toBe("1");
    expect(stat("NS.duels.pendingCount()")).toBe("1");
    lua.run(`load_roster()`);
    expect(stat("NS.duels.pendingCount()")).toBe("0");
    expect(count(lua)).toBe("1");
    expect(one(lua, "r.side .. '|' .. r.winner .. '|' .. r.loser .. '|' .. r.loserGuild .. '|' .. r.zone")).toBe("loser|Lebowski Highspirits|Blunt Cruising|Quebec Gold|Valley of Trials");
    expect(lua.run("return #DIAGS")).toBe("0");
  });

  it("a waiting duel against a guildmate becomes a guild duel once the roster loads, and is shared then", () => {
    const lua = loading();
    say("Bob Smith has defeated Blunt Cruising in a duel");
    expect(lua.run("local n = 0 for _ in pairs(DB.duels.results) do n = n + 1 end return n")).toBe("0");
    expect(lua.run("return #SENT_LINES")).toBe("0");
    lua.run(`load_roster()`);
    expect(lua.run("local n = 0 for _ in pairs(DB.duels.results) do n = n + 1 end return n")).toBe("1");
    expect(count(lua)).toBe("0");
    expect(lua.run("return SENT_LINES[1]")).toMatch(/^D\|Bob Smith\|Blunt Cruising\|\d+\|knockout$/);
  });

  it("waits for the roster through a /reload: the duel is saved and tried again after login", () => {
    const before = loading();
    say(LINE);
    const saved = before.run("local p = DB.duels.pending[1]; return p.winner .. '|' .. p.loser .. '|' .. p.at .. '|' .. p.reason .. '|' .. p.ext.zone");
    expect(saved).toMatch(/^Lebowski Highspirits\|Blunt Cruising\|\d+\|knockout\|Valley of Trials$/);
    before.close();
    // After the reload: a new client state with the saved table, the roster loaded.
    const [winner, loser, at, reason, zone] = saved.split("|");
    const lua = client("Blunt Cruising", true);
    lua.run(`TIMERS = {}; C_Timer = { After = function(_, fn) TIMERS[#TIMERS + 1] = fn end }
      DB.duels = { results = {}, pending = { { winner = "${winner}", loser = "${loser}", at = ${at}, reason = "${reason}", ext = { zone = "${zone}" } } } }
      fire_event("PLAYER_LOGIN"); for _, fn in ipairs(TIMERS) do fn() end`);
    expect(count(lua)).toBe("1");
    expect(lua.run("return tostring(DB.duels.pending)")).toBe("nil");
  });

  it("never asks for the roster in combat: once combat ends", () => {
    const lua = loading();
    lua.run("COMBAT = true");
    say(LINE);
    expect(stat("ASKED")).toBe("0");
    lua.run(`COMBAT = false; fire_event("PLAYER_REGEN_ENABLED")`);
    expect(stat("ASKED")).toBe("1");
  });

  it("drops a duel the roster never came for after the last try, and saves why", () => {
    const lua = loading();
    say(LINE);
    lua.run("run_timers(30)");
    expect(stat("NS.duels.pendingCount()")).toBe("0");
    expect(count(lua)).toBe("0");
    expect(lua.run("return DIAGS[#DIAGS]")).toMatch(/^DUEL_DROPPED duels: Lebowski Highspirits v Blunt Cruising at \d+: roster never loaded$/);
    // A bounded retry: the timer chain has ended.
    expect(lua.run("return #TIMERS")).toBe("0");
  });

  it("drops a waiting duel that fails to record, with a diagnostic, so the retry timer ends", () => {
    const lua = loading();
    say(LINE);
    lua.run(`GUILD_MEMBERS, ROSTER = SAVED_MEMBERS, SAVED_ROSTER; NS.duels.recordExternal = function() error("broken record") end`);
    lua.run("run_timers(30)");
    expect(stat("NS.duels.pendingCount()")).toBe("0");
    expect(lua.run("return DIAGS[#DIAGS]")).toMatch(/^DUEL_DROPPED duels: Lebowski Highspirits v Blunt Cruising at \d+: error: .*broken record/);
    expect(lua.run("return #TIMERS")).toBe("0");
  });

  it("a failure outside the entries still shortens the list each round, and the timer stops", () => {
    const lua = loading();
    say(LINE);
    lua.run("CLOCK = CLOCK + 200");
    say(LINE);
    lua.run(`NS.duels.flushPending = function() error("broken flush") end`);
    lua.run("run_timers(30)");
    expect(stat("NS.duels.pendingCount()")).toBe("0");
    expect(lua.run("local n = 0 for _, d in ipairs(DIAGS) do if d:find('DUEL_DROPPED', 1, true) and d:find('broken flush', 1, true) then n = n + 1 end end return n")).toBe("2");
    expect(lua.run("return #TIMERS")).toBe("0");
  });

  it("asks for the roster again for the next duel after a final drop", () => {
    const lua = loading();
    say(LINE);
    lua.run("run_timers(30)");
    expect(stat("NS.duels.pendingCount()")).toBe("0");
    expect(stat("ASKED")).toBe("1");
    lua.run("CLOCK = CLOCK + 300");
    say(LINE);
    expect(stat("ASKED")).toBe("2");
  });

  it("the result line is on in the default settings", () => {
    const lua = client("Blunt Cruising", true);
    expect(lua.run("return tostring(NS.duels.noticeEnabled())")).toBe("true");
    lua.run("SETTINGS = nil; NS.getSettings = function() return nil end");
    expect(lua.run("return tostring(NS.duels.noticeEnabled())")).toBe("true");
    lua.run("NS.duels.setNoticeEnabled(false)"); // no settings table: nothing to save, no error
  });

  it("keeps at most five duels waiting", () => {
    const lua = loading();
    for (let i = 0; i < 7; i++) { say(LINE); lua.run("CLOCK = CLOCK + 200"); }
    expect(stat("NS.duels.pendingCount()")).toBe("5");
    expect(lua.run("local n = 0 for _, d in ipairs(DIAGS) do if d:find('too many waiting') then n = n + 1 end end return n")).toBe("2");
  });
});

describe("the duel result line follows the member's switches", () => {
  const LINE = "Lebowski Highspirits has defeated Blunt Cruising in a duel";
  function member() {
    const lua = setup();
    lua.run(`NS.util.unitKey = function(unit) if unit ~= nil and unit ~= "player" then return nil end return "Blunt Cruising" end
      GUILD_MEMBERS = { ["Blunt Cruising"] = true, ["Bob Smith"] = true }
      ROSTER = { { "Blunt Cruising", 1, "WARLOCK" }, { "Bob Smith", 58, "MAGE" } }
      UnitExists = function() return false end`);
    return lua;
  }

  it("prints nothing and records nothing while the duels module is off", () => {
    const lua = member();
    lua.run(`NS.moduleActive = function(key) return key ~= "duels" end`);
    say(LINE);
    say("Bob Smith has defeated Blunt Cruising in a duel");
    expect(lua.run("return tostring(MSGS)")).toBe("nil");
    expect(lua.run("return tostring(DB.duels and next(DB.duels.external or {}))")).toBe("nil");
    expect(lua.run("local n = 0 for _ in pairs(DB.duels and DB.duels.results or {}) do n = n + 1 end return n")).toBe("0");
  });

  it("/guilded duels line off stops the line only: the duel is still kept and the card still shows", () => {
    const lua = member();
    lua.run(`NS.commandHandlers.duels({ "line", "off" })`);
    expect(stat("MSGS")).toContain("Duel result line: off.");
    lua.run(`MSGS = nil`);
    say(LINE);
    expect(lua.run("return tostring(MSGS)")).toBe("nil");
    expect(lua.run("return tostring(next(DB.duels.external) ~= nil)")).toBe("true");
    expect(stat("SHOWS")).toBe("1");
    lua.run(`NS.commandHandlers.duels({ "line", "on" }); MSGS = nil; CLOCK = CLOCK + 300`);
    say(LINE);
    expect(stat("MSGS")).toContain("Duel lost against Lebowski Highspirits.");
  });

  it("a member who turned their own duel announcements off gets no line; an officer's guild-wide off does not silence it", () => {
    const lua = member();
    lua.run(`NS.milestones.memberOff = function(kind) return kind == "duel" end`);
    say(LINE);
    expect(lua.run("return tostring(MSGS)")).toBe("nil");
    lua.run(`NS.milestones.memberOff = function() return false end; NS.milestones.guildOff = function() return true end; CLOCK = CLOCK + 300`);
    say(LINE);
    expect(stat("MSGS")).toContain("Duel lost against Lebowski Highspirits.");
  });
});

// 9.3.2, 14 Nov 23:35Z: Blunt Cruising lost to Lebowski Highspirits (level 4 priest, no guild), and the card said "Paladin level 27": the
// class and level of Lebowski Holyroller, a guildmate with the same first name. Names are matched by the full "First Last" only.
describe("two characters with the same first name", () => {
  const LINE = "Lebowski Highspirits has defeated Blunt Cruising in a duel";
  function blunt(target: boolean, fullTarget = true) {
    const lua = setup();
    lua.run(`NS.util.unitKey = function(unit)
        if unit == nil or unit == "player" then return "Blunt Cruising" end
        if unit == "target" and ${target} and ${fullTarget} then return "Lebowski Highspirits" end
        return nil
      end
      GUILD_MEMBERS = { ["Blunt Cruising"] = true, ["Lebowski Holyroller"] = true, ["Bob Smith"] = true }
      ROSTER = { { "Blunt Cruising", 1, "WARLOCK" }, { "Lebowski Holyroller", 27, "PALADIN" }, { "Bob Smith", 58, "MAGE" } }
      UnitExists = function(unit) return unit == "target" and ${target} end
      UnitName = function(unit) if unit == "target" then return "Lebowski", "Highspirits" end return "Blunt", "Cruising" end
      UnitClass = function(unit) if unit == "target" then return "Priest", "PRIEST" end return "Warlock", "WARLOCK" end
      UnitLevel = function(unit) if unit == "target" then return 4 end return 1 end
      GetGuildInfo = function(unit) if unit == "player" then return "Quebec Gold" end return nil end
      GetRealmName = function() return "Realm Two" end`);
    return lua;
  }
  const ext = (lua: LuaSession, code: string) => lua.run(`local r; for _, v in pairs(DB.duels and DB.duels.external or {}) do r = v end; return tostring(r and ${code})`);

  it("the card and the record take the opponent's class and level from the target, never from the guildmate with the same first name", () => {
    const lua = blunt(true);
    say(LINE);
    expect(stat("NS.duels.lastCard.oppClass .. NS.duels.lastCard.oppLevel")).toBe("PRIEST4");
    const text = lua.run(`return table.concat(NS.duels.cardLines(NS.duels.lastCard), " / ")`);
    expect(text).not.toContain("Paladin");
    expect(text).not.toContain("27");
    expect(ext(lua, "r.winnerClass .. r.winnerLevel .. '|' .. tostring(r.winnerGuild)")).toBe("Priest4|nil");
  });

  it("a client whose target gives only the first name still checks it against the opponent", () => {
    blunt(true, false);
    say(LINE);
    expect(stat("NS.duels.lastCard.oppClass .. NS.duels.lastCard.oppLevel")).toBe("PRIEST4");
  });

  it("a target that gives only a first name is not taken for a full-named opponent, for the card or the health left", () => {
    const lua = blunt(true, false);
    lua.run(`UnitName = function(unit) if unit == "target" then return "Lebowski" end return "Blunt", "Cruising" end`);
    say(LINE);
    expect(stat("NS.duels.lastCard.oppClass")).toBe("nil");
    expect(stat("NS.duels.lastCard.health and NS.duels.lastCard.health.opponent")).toBe("nil");
    expect(lua.run(`local r; for _, v in pairs(DB.duels.external) do r = v end; return tostring(r.winnerClass)`)).toBe("nil");
  });

  it("with no target the card says nothing about the opponent's class or level, rather than a guildmate's", () => {
    const lua = blunt(false);
    say(LINE);
    expect(stat("NS.duels.lastCard.oppClass")).toBe("nil");
    expect(stat("NS.duels.lastCard.oppLevel")).toBe("nil");
    expect(ext(lua, "r.winnerClass")).toBe("nil");
    expect(ext(lua, "r.winnerLevel")).toBe("nil");
  });

  it("a bare first name finds a guildmate only when no other guildmate has it", () => {
    const lua = blunt(false);
    lua.run("NS.duels.rosterRefresh()");
    expect(lua.run(`local d = NS.duels.cardData("Bob", "Blunt Cruising", CLOCK, "knockout", { me = "Blunt Cruising" }); return tostring(d.oppClass) .. tostring(d.oppLevel)`)).toBe("MAGE58");
    lua.run(`ROSTER[#ROSTER + 1] = { "Lebowski Bigsby", 12, "ROGUE" }; NS.duels.rosterRefresh()`);
    expect(lua.run(`local d = NS.duels.cardData("Lebowski", "Blunt Cruising", CLOCK, "knockout", { me = "Blunt Cruising" }); return tostring(d.oppClass) .. tostring(d.oppLevel)`)).toBe("nilnil");
    expect(lua.run(`local d = NS.duels.cardData("Lebowski Highspirits", "Blunt Cruising", CLOCK, "knockout", { me = "Blunt Cruising" }); return tostring(d.oppClass)`)).toBe("nil");
  });
});

// 9.5: my own health in a duel -> damage taken, healing received, lowest health (no combat log), shared in their own message.
describe("duel health statistics (9.5)", () => {
  const hp = (lua: LuaSession, unit: string, cur: number, max = 100, time?: number) => {
    lua.run(`${time !== undefined ? `NOW = ${time};` : ""} HEALTH.${unit} = { ${cur}, ${max} }; fire_event("UNIT_HEALTH", "${unit}")`);
  };
  const start = (lua: LuaSession) => lua.run(`NOW = 100; HEALTH = { player = { 100, 100 } }; fire_event("DUEL_REQUESTED", "Bob Smith"); fire_event("DUEL_COUNTDOWN", 3)`);

  it("sums decreases as damage taken and increases as healing, counts only after the countdown, skips max-health changes and other units", () => {
    const lua = setup();
    start(lua);
    hp(lua, "player", 90, 100, 101);         // still counting down: only the baseline moves
    hp(lua, "player", 70, 100, 110);         // -20
    hp(lua, "player", 85, 100, 115);         // +15
    hp(lua, "player", 60, 100, 120);         // -25
    hp(lua, "player", 120, 200, 125);        // new maximum: not healing; 60 %
    hp(lua, "player", 100, 200, 130);        // -20, lowest 50 %
    lua.run(`HEALTH.target = { 5, 100 }; fire_event("UNIT_HEALTH", "target")`); // another unit: never read
    lua.run(`NOW = 187; CLOCK = CLOCK + 90`);
    say("Kev Caron has defeated Bob Smith in a duel");
    const d = (field: string) => lua.run(`return tostring(NS.duels.lastCard.${field})`);
    expect(d("hp.taken")).toBe("65");
    expect(d("hp.heal")).toBe("15");
    expect(d("hp.low")).toBe("50");
    expect(d("hp.left")).toBe("50");
    expect(lua.run(`return NS.duels.hpText(NS.duels.lastCard.hp)`)).toBe("damage taken 65  -  healing 15  -  lowest health 50%");
    expect(lua.run(`return table.concat(NS.duels.cardLines(NS.duels.lastCard), "\\n")`)).toContain("damage taken 65");
    // Never the combat log.
    expect(stat("REG.COMBAT_LOG_EVENT_UNFILTERED")).toBe("nil");
  });

  it("is inactive outside a duel and leaves a duel without health changes with no numbers", () => {
    const lua = setup();
    hp(lua, "player", 10, 100, 50);          // no session: ignored, no error
    start(lua);
    lua.run(`NOW = 187; CLOCK = CLOCK + 90`);
    say("Kev Caron has defeated Bob Smith in a duel");
    expect(stat("NS.duels.lastCard.hp")).toBe("nil");
    expect(lua.run(`return table.concat(NS.duels.cardLines(NS.duels.lastCard), "\\n")`)).not.toContain("damage taken");
    // After the duel the session is gone: a health change is not counted into anything.
    hp(lua, "player", 5, 100, 200);
    expect(stat("NS.duels.hpResult()")).toBe("nil");
  });

  it("shares the numbers in a separate S message and keeps the D message exactly as older addons decode it", () => {
    const lua = setup();
    start(lua);
    hp(lua, "player", 70, 100, 110); hp(lua, "player", 80, 100, 115);
    lua.run(`NOW = 187; CLOCK = CLOCK + 90`);
    say("Kev Caron has defeated Bob Smith in a duel");
    const lines = lua.run(`return table.concat(SENT_LINES, "\\n")`).split("\n");
    const dLine = lines.find(l => l.startsWith("D|"))!;
    expect(dLine).toMatch(/^D\|([^|]+)\|([^|]+)\|(\d+)\|(\w+)$/);  // the pattern a pre-9.5 addon matches, unchanged
    const sLine = lines.find(l => l.startsWith("S|"))!;
    expect(sLine).toMatch(/^S\|Kev Caron\|Bob Smith\|\d+\|w\|84\|30\|10\|70\|80\|100$/);
    // An older addon's decoder (anchored D pattern) never sees the S message as a duel.
    expect(/^D\|([^|]+)\|([^|]+)\|(\d+)\|(\w+)$/.test(sLine)).toBe(false);
    expect(lua.run(`local row; for _, r in pairs(DB.duels.results) do row = r end; return row.stats.w.taken .. ":" .. row.stats.w.heal .. ":" .. row.stats.w.low`)).toBe("30:10:70");
  });

  it("files the other player's own numbers under their side, only from that player", () => {
    const lua = setup();
    start(lua);
    hp(lua, "player", 70, 100, 110);
    lua.run(`NOW = 187; CLOCK = CLOCK + 90`);
    say("Kev Caron has defeated Bob Smith in a duel");
    const at = lua.run(`local row; for _, r in pairs(DB.duels.results) do row = r end; return row.at`);
    // Cy cannot speak for Bob.
    expect(lua.run(`return tostring(NS.duels.onAddonMessage("S|Kev Caron|Bob Smith|${at}|l|84|4890|0|0|0|100", "Cy Jones"))`)).toBe("false");
    expect(lua.run(`return tostring(NS.duels.onAddonMessage("S|Kev Caron|Bob Smith|${at}|l|84|4890||0|0|100", "Bob Smith"))`)).toBe("true");
    expect(lua.run(`local row; for _, r in pairs(DB.duels.results) do row = r end; return tostring(row.stats.l.taken) .. ":" .. tostring(row.stats.l.heal) .. ":" .. tostring(row.stats.l.low) .. ":" .. row.stats.w.taken`)).toBe("4890:nil:0:30");
    // Out-of-range values are dropped.
    lua.run(`NS.duels.onAddonMessage("S|Kev Caron|Bob Smith|${at}|l|84|99999999999|0|500|500|100", "Bob Smith")`);
    expect(lua.run(`local row; for _, r in pairs(DB.duels.results) do row = r end; return tostring(row.stats.l.taken) .. ":" .. tostring(row.stats.l.low) .. ":" .. tostring(row.stats.l.heal)`)).toBe("nil:nil:0");
  });
});
