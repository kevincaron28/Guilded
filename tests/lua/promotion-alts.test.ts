import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";
import { rosterPrelude } from "./roster-tools.test.js";

// 20 Nov 2026: the promotion window identifies alts (bot list, note hint), moves them to the Alt rank (the lowest) on an
// officer's click, and swaps ranks when a member changes main. Rank-number base 0 and 1 are both checked.
let s: LuaSession;
afterEach(() => s?.close());

const FEED = (extra = "") => `GuildedPromotion = { updatedAt = "2026-11-20T12:00:00Z", fromRank = "Initiate", minDays = 7, minLevel = 0,
  ready = { "Dee-Realm", "Gus-Realm" }, waiting = {}, alts = { { name = "Dee-Realm", main = "Boo" }, { name = "Eve-Realm", main = "Boo" } },
  swaps = { { to = "New-Realm", from = "Old-Realm" } } ${extra} }`;

// Ranks 0-5: Guild Master, Officer, Veteran, Member, Initiate, Alt. Boss (rank 0) is the officer.
function setup(feed: string | null = FEED()) {
  s?.close();
  s = newLuaSession();
  s.run(rosterPrelude);
  s.run(String.raw`
    RANKNAMES = { "Guild Master", "Officer", "Veteran", "Member", "Initiate", "Alt" }
    DB = {}
    NS.getDb = function() return DB end
    NS.displayName = function(n) return n end
    NS.message = function(m) MESSAGES = MESSAGES or {}; MESSAGES[#MESSAGES + 1] = m end
    NS.L = function(x) return x end
    function GuildControlGetNumRanks() return #RANKNAMES end
    function GuildControlGetRankName(i) return RANKNAMES[i] end
    ROWS = { { name = "Boss-Realm", rank = 0, guid = "boss", public = "", officer = "" },
      { name = "Old-Realm", rank = 3, guid = "old", public = "", officer = "" },
      { name = "New-Realm", rank = 5, guid = "new", public = "", officer = "" },
      { name = "Dee-Realm", rank = 4, guid = "dee", public = "", officer = "" },
      { name = "Eve-Realm", rank = 5, guid = "eve", public = "", officer = "" },
      { name = "Fay-Realm", rank = 4, guid = "fay", public = "my alt", officer = "" },
      { name = "Gus-Realm", rank = 4, guid = "gus", public = "", officer = "" } }
    function GetGuildRosterInfo(i) READS = READS + 1; local r = ROWS[i]; return r.name, RANKNAMES[r.rank + 1], r.rank, 30, "Mage", "Zone", r.public, r.officer, true, nil, "MAGE", 0, 0, false, false, 0, r.guid end
    SetGuildMemberRank = function(i, r) CALLS[#CALLS + 1] = { i, r } end
    local original = CreateFrame
    function CreateFrame(kind, ...)
      local f = original(kind, ...)
      f.kind = kind; f.text = ""; f.shown = true; f.TitleText = { SetText = function() end }
      f.SetText = function(self, v) self.text = v end; f.GetText = function(self) return self.text end
      f.Show = function(self) self.shown = true end; f.Hide = function(self) self.shown = false end; f.IsShown = function(self) return self.shown end
      f.SetFrameStrata = function(self, v) self.strata = v end
      f.CreateFontString = function() return CreateFrame("Font") end
      return f
    end
    function TEXTS() local out = {} for _, f in ipairs(FRAMES) do if f.text ~= "" and f.shown ~= false then out[#out + 1] = f.text end end return table.concat(out, "|") end
    function FRAME(name) for _, f in ipairs(FRAMES) do if f.shown and f.text == name then return f end end end
  `);
  s.load("Modules/RosterTools.lua");
  s.load("Modules/Promotion.lua");
  s.run("NS.util.gameEdition=function() return EDITION end; NS.util.address=function(n) return n end; NS.isOfficer = function() return true end");
  if (feed) s.run(feed);
  s.run('CLOCK=100; fire_event("GUILD_ROSTER_UPDATE")');
  return s;
}
const roster = (clock: number) => s.run(`CLOCK=${clock}; fire_event("GUILD_ROSTER_UPDATE")`);
const lastCall = () => s.run("local c = CALLS[#CALLS]; return c and (c[1] .. ':' .. c[2]) or 'none'");

describe("alt detection in the promotion window", () => {
  it("lists the bot's alts with their main, a note hint as 'maybe', and counts the ones already in the Alt rank", () => {
    setup();
    const text = s.run("return NS.promotion.altsText()");
    expect(text).toContain("Dee-Realm - alt of Boo (Initiate)");
    expect(text).toContain("Fay-Realm - maybe an alt (note says alt) (Initiate)");
    expect(text).toContain("1 alts already in the Alt rank");
    expect(text).not.toContain("Gus-Realm");
    // The pair of a main change is not repeated as plain alts.
    expect(text).not.toContain("Old-Realm - alt of");
    expect(text).toContain("New-Realm is now the main (was Old-Realm): give rank Member, then move Old-Realm to Alt");
  });
  it("never offers an alt (bot list or note) for promotion, even when the bot's ready list names it", () => {
    setup();
    expect(s.run("local r = NS.promotion.ready(); local out = {} for i, x in ipairs(r) do out[i] = x.name end return table.concat(out, '|')")).toBe("Gus-Realm");
  });
  it("shows the alt section in the panel with a Move to Alt button", () => {
    setup(); s.run("NS.promotion.open()");
    const texts = s.run("return TEXTS()");
    expect(texts).toContain("Alts and main changes");
    expect(texts).toContain("Dee-Realm - alt of Boo (Initiate)");
    expect(s.run("return tostring(FRAME('Move to Alt') ~= nil)")).toBe("true");
  });
});

describe("move to the Alt rank (lowest) on a click", () => {
  it("sets the lowest rank with rank number = index + 1 by default (base 1)", () => {
    setup();
    expect(s.run("return tostring((NS.promotion.moveToAlt('Dee-Realm')))")).toBe("true");
    expect(lastCall()).toBe("4:6"); // roster index 4, rank index 5 (Alt) + 1
  });
  it("uses rank index + 0 once the client build is calibrated to base 0", () => {
    setup();
    s.run('DB.rosterRankBase = { build = "1", base = 0, confirmed = true }');
    expect(s.run("return tostring((NS.promotion.moveToAlt('Dee-Realm')))")).toBe("true");
    expect(lastCall()).toBe("4:5");
  });
  it("the panel button does it, and the roster confirming it verifies the move", () => {
    setup(); s.run("NS.promotion.open()");
    s.run("FRAME('Move to Alt').scripts.OnClick()");
    expect(lastCall()).toBe("4:6");
    s.run("ROWS[4].rank = 5"); roster(101);
    expect(s.run("local alts, done = NS.promotion.alts(); return done")).toBe("2");
    expect(s.run("return NS.rosterTools.auditText()")).toContain("verified");
  });
  it("is refused (manual mode) on a client that refused rank changes before, and never moves the officer", () => {
    setup();
    s.run('DB.rosterBlocked = { rank = "1" }');
    const ok = s.run("local ok, m = NS.promotion.moveToAlt('Dee-Realm'); return tostring(ok) .. ':' .. m");
    expect(ok).toContain("false:");
    expect(s.run("return #CALLS")).toBe("0");
    setup();
    expect(s.run("return tostring((NS.promotion.moveToAlt('Boss-Realm')))")).toBe("false");
  });
  it("without the rank setter only a one-step move can run; a longer one is unavailable", () => {
    setup(); s.run("SetGuildMemberRank = nil");
    expect(s.run("return tostring((NS.promotion.moveToAlt('Dee-Realm')))")).toBe("true"); // Initiate (4) -> Alt (5) is one step down
    expect(s.run("return tostring((NS.promotion.moveToAlt('Old-Realm')))")).toBe("false");
  });
});

describe("a main change swaps the ranks", () => {
  it("first gives the new main the old main's rank, then moves the old main to Alt", () => {
    setup();
    const swap = () => s.run("return tostring((NS.promotion.swapStep(NS.promotion.swaps()[1])))");
    expect(s.run("local sw = NS.promotion.swaps()[1]; return tostring(sw.needGive) .. ':' .. sw.rankName")).toBe("true:Member");
    expect(swap()).toBe("true");
    expect(lastCall()).toBe("3:4"); // New (roster index 3) -> Member (index 3) + 1
    // The old main is not touched until the new main's rank is verified.
    expect(s.run("local ok = NS.promotion.moveToAlt('Old-Realm'); return tostring(ok)")).toBe("false");
    s.run("ROWS[3].rank = 3"); roster(101);
    expect(s.run("return tostring(NS.promotion.swaps()[1].needGive)")).toBe("false");
    expect(swap()).toBe("true");
    expect(lastCall()).toBe("2:6"); // Old (index 2) -> Alt (5) + 1
    s.run("ROWS[2].rank = 5"); roster(102);
    expect(s.run("return #NS.promotion.swaps()")).toBe("0");
  });
  it("when the new main already ranks as high, the main is not demoted: only the old main goes to Alt", () => {
    setup(); s.run("ROWS[3].rank = 2"); roster(101);
    expect(s.run("local sw = NS.promotion.swaps()[1]; return tostring(sw.needGive)")).toBe("false");
    s.run("NS.promotion.swapStep(NS.promotion.swaps()[1])");
    expect(lastCall()).toBe("2:6");
  });
  it("the panel shows the swap with a Give rank button, using base 0 when calibrated", () => {
    setup(); s.run('DB.rosterRankBase = { build = "1", base = 0, confirmed = true }'); s.run("NS.promotion.open()");
    expect(s.run("return TEXTS()")).toContain("New-Realm is now the main (was Old-Realm): give rank Member, then move Old-Realm to Alt (1/2)");
    s.run("FRAME('Give rank').scripts.OnClick()");
    expect(lastCall()).toBe("3:3");
  });
  it("shows nothing for a swap whose old main already sits in the Alt rank", () => {
    setup(); s.run("ROWS[2].rank = 5"); roster(101);
    expect(s.run("return #NS.promotion.swaps()")).toBe("0");
  });
});

describe("the payload reaches the addon", () => {
  it("promotionToLua writes alts and swaps, drops malformed rows, and old feeds without them still work", async () => {
    const { promotionToLua } = await import("../../companion/standings-format.mjs");
    const lua = promotionToLua({ updatedAt: "2026-11-20T12:00:00Z", fromRank: "Initiate", minDays: 7, minLevel: 0, ready: ["Gus-Realm"], waiting: [],
      alts: [{ name: "Dee-Realm", main: "Boo" }, { name: "Bad\nName", main: "x" }, { name: "NoMain" }], swaps: [{ to: "New-Realm", from: "Old-Realm" }, { to: "A", from: "A" }] }).join("\n");
    expect(lua).toContain('{ name = "Dee-Realm", main = "Boo" }');
    expect(lua).not.toContain("Bad");
    expect(lua).not.toContain("NoMain");
    expect(lua).toContain('{ to = "New-Realm", from = "Old-Realm" }');
    expect(lua).not.toContain('to = "A"');
    setup(null); s.run(lua);
    expect(s.run("return #GuildedPromotion.alts .. ':' .. #GuildedPromotion.swaps")).toBe("1:1");
    setup(`GuildedPromotion = { fromRank = "Initiate", minDays = 7, ready = { "Gus-Realm" }, waiting = {} }`);
    expect(s.run("return #NS.promotion.ready() .. ':' .. #NS.promotion.swaps() .. ':' .. #(NS.promotion.alts())")).toBe("1:0:1");
  });
});
