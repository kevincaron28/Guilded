import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";
import { rosterPrelude } from "./roster-tools.test.js";

// 20 Nov 2026: the promotion window identifies the bot's alts, moves them to the Alt rank on an officer's two clicks, and swaps
// ranks when a member changes main. Review rules: no officer-level rank, notes are information only, an Alt-named rank
// is required, a demotion needs a confirming click, the officer's own characters are left alone.
let s: LuaSession;
afterEach(() => s?.close());

const FEED = (extra = "") => `GuildedPromotion = { updatedAt = "2026-11-20T12:00:00Z", fromRank = "Initiate", minDays = 7, minLevel = 0,
  ready = { "Dee-Realm", "Gus-Realm", "Fay-Realm" }, waiting = {}, alts = { { name = "Dee-Realm", main = "Boo" }, { name = "Eve-Realm", main = "Boo" }, { name = "Vic-Realm", main = "Boo" } },
  swaps = { { to = "New-Realm", from = "Old-Realm" } } ${extra} }`;

// Ranks 0-6: Guild Master, Officer, Veteran, Member, Initiate, Newbie, Alt. Boss (rank 0) is the officer; Initiate is the starting rank.
const DEFAULT_RANKS = '{ "Guild Master", "Officer", "Veteran", "Member", "Initiate", "Newbie", "Alt" }';
function setup(feed: string | null = FEED(), ranks = DEFAULT_RANKS, calibrated = true) {
  s?.close();
  s = newLuaSession();
  s.run(rosterPrelude);
  s.run(String.raw`
    RANKNAMES = ${ranks}
    DB = {}
    NS.getDb = function() return DB end
    NS.displayName = function(n) return n end
    NS.message = function(m) MESSAGES = MESSAGES or {}; MESSAGES[#MESSAGES + 1] = m end
    NS.L = function(x) return x end
    function GuildControlGetNumRanks() return #RANKNAMES end
    function GuildControlGetRankName(i) return RANKNAMES[i] end
    ROWS = { { name = "Boss-Realm", rank = 0, guid = "boss", public = "", officer = "" },
      { name = "Old-Realm", rank = 4, guid = "old", public = "", officer = "" },
      { name = "New-Realm", rank = 5, guid = "new", public = "", officer = "" },
      { name = "Dee-Realm", rank = 4, guid = "dee", public = "", officer = "" },
      { name = "Eve-Realm", rank = 6, guid = "eve", public = "", officer = "" },
      { name = "Fay-Realm", rank = 4, guid = "fay", public = "alt of Boo", officer = "" },
      { name = "Gus-Realm", rank = 4, guid = "gus", public = "Main - alts: Foo", officer = "" },
      { name = "Vic-Realm", rank = 1, guid = "vic", public = "", officer = "" } }
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
  if (calibrated) s.run('DB.rosterRankBase = { build = "1", base = 1, confirmed = true }');
  if (feed) s.run(feed);
  s.run('CLOCK=100; fire_event("GUILD_ROSTER_UPDATE")');
  return s;
}
const roster = (clock: number) => s.run(`CLOCK=${clock}; fire_event("GUILD_ROSTER_UPDATE")`);
const lastCall = () => s.run("local c = CALLS[#CALLS]; return c and (c[1] .. ':' .. c[2]) or 'none'");
const calls = () => s.run("return #CALLS");
// A demotion needs two clicks: the first only arms it.
const moveTwice = (name: string) => { s.run(`NS.promotion.moveToAlt('${name}')`); return s.run(`return tostring((NS.promotion.moveToAlt('${name}')))`); };

describe("alt identification in the promotion window", () => {
  it("lists the bot's alts with their main, a note hint as information only, and counts the ones already in the Alt rank", () => {
    setup();
    const text = s.run("return NS.promotion.altsText()");
    expect(text).toContain("Dee-Realm - alt of Boo (Initiate)");
    expect(text).toContain("Fay-Realm - maybe an alt (note says alt) (Initiate)");
    expect(text).toContain("1 alts already in the Alt rank");
    expect(text).not.toContain("Gus-Realm"); // "Main - alts: Foo" does not start with alt
    expect(text).not.toContain("Old-Realm - alt of");
    expect(text).toContain("New-Realm is now the main (was Old-Realm): give rank Initiate, then move Old-Realm to Alt");
  });
  it("takes the bot's alt out of the promotion list, but a note never does: Fay and Gus stay promotable", () => {
    setup();
    expect(s.run("local r = NS.promotion.ready(); local out = {} for i, x in ipairs(r) do out[i] = x.name end table.sort(out) return table.concat(out, '|')")).toBe("Fay-Realm|Gus-Realm");
  });
  it("offers no move for a note hint (no button) and never lists an officer-level character the bot named", () => {
    setup(); s.run("NS.promotion.open()");
    const text = s.run("return NS.promotion.altsText()");
    expect(text).not.toContain("Vic-Realm"); // Officer rank
    expect(s.run("for _, a in ipairs((NS.promotion.alts())) do if a.name == 'Fay-Realm' then return tostring(a.hint) end end")).toBe("true");
    expect(moveTwice("Fay-Realm")).toBe("false"); // a note hint is information only
    expect(calls()).toBe("0");
    expect(s.run("return tostring((NS.promotion.moveToAlt('Vic-Realm')))")).toBe("false");
  });
  it("an ordinary Veteran the bot names is offered, but not when the officer settings include the Veteran rank", () => {
    setup(FEED().replace('{ name = "Vic-Realm", main = "Boo" }', '{ name = "Vic-Realm", main = "Boo" }').replace("ready =", "ready ="));
    s.run("ROWS[8].rank = 2"); roster(101);
    expect(s.run("return NS.promotion.altsText()")).toContain("Vic-Realm - alt of Boo (Veteran)");
    s.run("DB.settings = { officerRanks = { [0] = true, [1] = true, [2] = true } }");
    expect(s.run("return NS.promotion.altsText()")).not.toContain("Vic-Realm");
  });
  it("shows the alt section in the panel with a Move to Alt button", () => {
    setup(); s.run("NS.promotion.open()");
    const texts = s.run("return TEXTS()");
    expect(texts).toContain("Alts and main changes");
    expect(texts).toContain("Dee-Realm - alt of Boo (Initiate)");
    expect(s.run("return tostring(FRAME('Move to Alt') ~= nil)")).toBe("true");
  });
});

describe("move to the Alt rank needs a confirming click", () => {
  it("the first click only arms it; the second sends rank index + 1 (base 1)", () => {
    setup();
    expect(s.run("local ok, m = NS.promotion.moveToAlt('Dee-Realm'); return tostring(ok) .. ':' .. m")).toContain("false:Click again within 15 seconds to confirm: move Dee-Realm to the Alt rank.");
    expect(calls()).toBe("0");
    expect(s.run("return tostring((NS.promotion.moveToAlt('Dee-Realm')))")).toBe("true");
    expect(lastCall()).toBe("4:7"); // roster index 4, rank index 6 (Alt) + 1
  });
  it("the confirmation expires, and arming one character does not confirm another", () => {
    setup();
    s.run("NS.promotion.moveToAlt('Dee-Realm'); CLOCK = 130");
    expect(s.run("return tostring((NS.promotion.moveToAlt('Dee-Realm')))")).toBe("false");
    s.run("CLOCK = 131");
    s.run("NS.promotion.moveToAlt('Dee-Realm')");
    expect(s.run("return tostring((NS.promotion.moveToAlt('Fay-Realm')))")).toBe("false");
    expect(calls()).toBe("0");
  });
  it("uses rank index + 0 once the client build is calibrated to base 0", () => {
    setup(); s.run('DB.rosterRankBase = { build = "1", base = 0, confirmed = true }');
    expect(moveTwice("Dee-Realm")).toBe("true");
    expect(lastCall()).toBe("4:6");
  });
  it("the panel button arms (label turns to Confirm) and the second click moves", () => {
    setup(); s.run("NS.promotion.open()");
    s.run("FRAME('Move to Alt').scripts.OnClick()");
    expect(calls()).toBe("0");
    expect(s.run("return tostring(FRAME('Confirm') ~= nil)")).toBe("true");
    s.run("FRAME('Confirm').scripts.OnClick()");
    expect(lastCall()).toBe("4:7");
    s.run("ROWS[4].rank = 6"); roster(101);
    expect(s.run("local alts, done = NS.promotion.alts(); return done")).toBe("2");
    expect(s.run("return NS.rosterTools.auditText()")).toContain("verified");
  });
  it("refuses the last rank until the rank numbering is calibrated", () => {
    setup(FEED(), DEFAULT_RANKS, false);
    expect(moveTwice("Dee-Realm")).toBe("false");
    expect(s.run("local ok, m = NS.promotion.moveToAlt('Dee-Realm'); return m")).toContain("Promote someone once first");
    expect(calls()).toBe("0");
  });
  it("is refused (manual) on a client that refused rank changes before, and never moves the officer", () => {
    setup(); s.run('DB.rosterBlocked = { rank = "1" }');
    expect(moveTwice("Dee-Realm")).toBe("false");
    expect(calls()).toBe("0");
    setup();
    expect(moveTwice("Boss-Realm")).toBe("false");
  });
  it("without the rank setter only a one-step move can run", () => {
    setup(); s.run("SetGuildMemberRank = nil; ROWS[4].rank = 5"); roster(101); // Newbie (5) -> Alt (6) is one step
    expect(moveTwice("Dee-Realm")).toBe("true");
    expect(moveTwice("Old-Realm")).toBe("false"); // Initiate (4) -> Alt (6) is two steps
  });
});

describe("no Alt-named rank: manual only", () => {
  it("never falls back to the lowest rank: nothing is offered and the manual line is shown", () => {
    setup(FEED(), '{ "Guild Master", "Officer", "Veteran", "Member", "Initiate", "Newbie", "Trial" }');
    expect(s.run("return tostring(NS.rosterTools.altRankIndex(NS.rosterTools.snapshot()))")).toBe("nil");
    expect(s.run("local ok, m = NS.promotion.moveToAlt('Dee-Realm'); return tostring(ok) .. ':' .. m")).toContain("Move to the Alt rank from the guild roster");
    expect(s.run("return #NS.promotion.alts() .. ':' .. #NS.promotion.swaps()")).toContain(":0"); // no swap without an Alt rank
    expect(calls()).toBe("0");
  });
});

describe("a main change swaps the ranks", () => {
  it("first gives the new main the old main's rank, then (after a confirming click) moves the old main to Alt", () => {
    setup();
    const swap = () => s.run("return tostring((NS.promotion.swapStep(NS.promotion.swaps()[1])))");
    expect(s.run("local sw = NS.promotion.swaps()[1]; return tostring(sw.needGive) .. ':' .. sw.rankName")).toBe("true:Initiate");
    expect(swap()).toBe("true");
    expect(lastCall()).toBe("3:5"); // New (roster index 3) -> Initiate (index 4) + 1
    expect(s.run("local ok = NS.promotion.moveToAlt('Old-Realm'); return tostring(ok)")).toBe("false"); // armed, and the roster has not verified the give yet
    expect(calls()).toBe("1");
    s.run("ROWS[3].rank = 4"); roster(101);
    expect(s.run("return tostring(NS.promotion.swaps()[1].needGive)")).toBe("false");
    s.run("CLOCK = 130"); // the earlier arming has expired
    expect(swap()).toBe("false"); // first click arms
    expect(swap()).toBe("true");
    expect(lastCall()).toBe("2:7");
    s.run("ROWS[2].rank = 6"); roster(111);
    expect(s.run("return #NS.promotion.swaps()")).toBe("0");
  });
  it("when the new main already ranks as high, the main is not demoted: only the old main goes to Alt", () => {
    setup(); s.run("ROWS[3].rank = 4"); roster(101);
    expect(s.run("local sw = NS.promotion.swaps()[1]; return tostring(sw.needGive)")).toBe("false");
    s.run("NS.promotion.swapStep(NS.promotion.swaps()[1]); NS.promotion.swapStep(NS.promotion.swaps()[1])");
    expect(lastCall()).toBe("2:7");
    expect(s.run("for _, c in ipairs(CALLS) do if c[1] == 3 then return 'main touched' end end return 'ok'")).toBe("ok");
  });
  it("the panel shows the swap with a Give rank button, using base 0 when calibrated", () => {
    setup(); s.run('DB.rosterRankBase = { build = "1", base = 0, confirmed = true }'); s.run("NS.promotion.open()");
    expect(s.run("return TEXTS()")).toContain("New-Realm is now the main (was Old-Realm): give rank Initiate, then move Old-Realm to Alt (1/2)");
    s.run("FRAME('Give rank').scripts.OnClick()");
    expect(lastCall()).toBe("3:4");
  });
  it("shows nothing for a swap whose old main already sits in the Alt rank, is officer-level, or is the officer; a Veteran old main is offered", () => {
    setup(); s.run("ROWS[2].rank = 6"); roster(101);
    expect(s.run("return #NS.promotion.swaps()")).toBe("0");
    setup(); s.run("ROWS[2].rank = 2"); roster(101); // old main is an ordinary Veteran: offered
    expect(s.run("return #NS.promotion.swaps()")).toBe("1");
    s.run("DB.settings = { officerRanks = { [0] = true, [1] = true, [2] = true } }"); // ... unless the guild treats Veteran as officer
    expect(s.run("return #NS.promotion.swaps()")).toBe("0");
    setup(); s.run("ROWS[2].rank = 1"); roster(101); // old main is an Officer
    expect(s.run("return #NS.promotion.swaps()")).toBe("0");
    setup(); s.run('GuildedPromotion.swaps = { { to = "Boss-Realm", from = "Old-Realm" } }'); // the officer's own character
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
    expect(s.run("return #NS.promotion.ready() .. ':' .. #NS.promotion.swaps() .. ':' .. #(NS.promotion.alts())")).toContain("1:0:");
  });
});
