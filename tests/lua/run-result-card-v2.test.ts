import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";
let session: LuaSession | undefined;
afterEach(() => session?.close());

// 9.3.5: the in-game result card's party table (level, guild, +gain, season total) from GuildedDungeonCards, written by the companion.
const FRAME_SETUP = `NS = {}; COMBAT = false; LOCKED = false; LABELS = {}; HEIGHTS = {}; SHOWN = 0; VISIBLE = false; SCROLL_TOP = nil
  InCombatLockdown = function() return LOCKED end
  UnitAffectingCombat = function() return COMBAT end
  local original = CreateFrame
  CreateFrame = function(kind, name, ...)
    local frame = original(kind, name, ...)
    frame.CreateTexture = function() return setmetatable({}, {__index=function() return function() end end}) end
    frame.CreateFontString = function()
      local label = setmetatable({}, {__index=function() return function() end end})
      label.SetText = function(self, text) self.text = text end
      label.Show = function(self) self.shown = true end
      label.Hide = function(self) self.shown = false end
      label.GetStringHeight = function() return 100 end
      LABELS[#LABELS + 1] = label
      return label
    end
    if name == "GuildedRunResults" then
      RESULT_FRAME = frame
      frame.SetSize = function() end
      frame.SetHeight = function(_, h) HEIGHTS[#HEIGHTS + 1] = h end
      frame.Show = function() SHOWN = SHOWN + 1; VISIBLE = true end
      frame.Hide = function() VISIBLE = false end
      frame.IsShown = function() return VISIBLE end
    end
    return frame
  end`;
const RUN = 'RUN = {id="QG-1",name="Ragefire Chasm",state="COMPLETED",durationSec=1105,encounters={},players={Aldric={class="WARRIOR",role="TANK",deaths=0}}}';
const shownText = () => session!.run('local out = {} for _, l in ipairs(LABELS) do if l.shown then out[#out+1] = l.text end end return table.concat(out, "|")');

describe("result card v2 party table", () => {
  it("shows level, guild, +gain and season total when the receipt data is there, five players at most", () => {
    session = newLuaSession(); session.run(FRAME_SETUP); session.load("Locale.lua"); session.load("Modules/RunResults.lua");
    session.run(RUN);
    session.run(String.raw`GuildedDungeonCards = { ["QG-1"] = {
      { n = "Aldric", l = 24, g = "Qu\195\169bec Gold", a = 36, t = 412 }, { n = "Brenna", l = 23, g = "Qu\195\169bec Gold", a = 0, t = 388 },
      { n = "Cedric", l = 24 }, { n = "Dara", a = 12, t = 57 }, { n = "Edric" }, { n = "Sixth", l = 5 } } }`);
    session.run("NS.runResults.show(RUN)");
    const text = shownText();
    expect(text).toContain("Lv|Guild|This run|Season");
    expect(text).toContain("Aldric");
    expect(text).toContain("24|Qu\u00e9bec Gold|");
    expect(text).toContain("+36");
    expect(text).toContain("412");
    expect(text).toContain("+0");
    expect(text).toContain("388");
    expect(text).not.toContain("Sixth");
    // Taller card for the table, details opening adds the usual extra.
    expect(session.run("return HEIGHTS[#HEIGHTS]")).toBe("372");
  });
  it("shows exactly today's card without the receipt data", () => {
    session = newLuaSession(); session.run(FRAME_SETUP); session.load("Locale.lua"); session.load("Modules/RunResults.lua");
    session.run(RUN);
    session.run("NS.runResults.show(RUN)");
    expect(shownText()).not.toContain("This run");
    expect(session.run("return HEIGHTS[#HEIGHTS]")).toBe("276");
    expect(session.run("return tostring(NS.runResults.cardRows(RUN))")).toBe("nil");
    // A table of another run, or junk, is not this run's data.
    session.run('GuildedDungeonCards = { ["OTHER"] = { { n = "X", l = 1 } }, ["QG-1"] = "junk" }');
    expect(session.run("return tostring(NS.runResults.cardRows(RUN))")).toBe("nil");
  });
  it("leaves the table out of a card that gets the data later and does nothing in combat", () => {
    session = newLuaSession(); session.run(FRAME_SETUP); session.load("Locale.lua"); session.load("Modules/RunResults.lua");
    session.run(RUN);
    session.run("NS.runResults.show(RUN)");
    expect(session.run("return SHOWN")).toBe("1");
    session.run('GuildedDungeonCards = { ["QG-1"] = { { n = "Aldric", l = 24, a = 3, t = 9 } } }; COMBAT = true');
    session.run("NS.runResults.refresh()");
    expect(session.run("return SHOWN")).toBe("1"); // in combat: queued, nothing redrawn
    expect(shownText()).not.toContain("This run");
    session.run('COMBAT = false; fire_event("PLAYER_REGEN_ENABLED")');
    expect(session.run("return NS.runResults.cardRows(RUN)[1].n")).toBe("Aldric");
  });
  it("labels the columns in French, German and Spanish and keeps blanks blank", () => {
    session = newLuaSession(); session.run("NS = {}"); session.load("Locale.lua"); session.load("Modules/RunResults.lua");
    session.run('GetLocale = function() return "frFR" end');
    expect(session.run('return table.concat(NS.runResults.cardHeader(), "|")')).toBe("|Niv|Guilde|Cette run|Saison");
    session.run('GetLocale = function() return "deDE" end');
    expect(session.run('return table.concat(NS.runResults.cardHeader(), "|")')).toBe("|Stufe|Gilde|Dieser Lauf|Saison");
    session.run('GetLocale = function() return "esES" end');
    expect(session.run('return table.concat(NS.runResults.cardHeader(), "|")')).toBe("|Nv|Hermandad|Esta partida|Temporada");
    expect(session.run('local c = NS.runResults.cardCells({ n = "Edric|cffff0000" }); return c[2] .. "|" .. c[3] .. "|" .. c[4] .. "|" .. c[5] .. "|" .. c[1]')).toBe("|||||cffffd36aEdriccffff0000|r");
  });
  it("gives a simulated run a sample table for /gdg results", () => {
    session = newLuaSession(); session.run(FRAME_SETUP); session.load("Locale.lua"); session.load("Modules/RunResults.lua");
    session.run('NS.runResults.simCard("SIM-1")');
    expect(session.run('return NS.runResults.cardRows({id="SIM-1",test=true})[1].n')).toBe("Tester One");
    expect(session.run('return tostring(NS.runResults.cardRows({id="SIM-1"}))')).toBe("nil"); // never for a real run
    session.run('NS.runResults.remove("SIM-1")');
    expect(session.run('return tostring(NS.runResults.cardRows({id="SIM-1",test=true}))')).toBe("nil");
  });
});
