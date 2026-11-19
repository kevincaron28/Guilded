import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";
import { rosterPrelude } from "./roster-tools.test.js";
import { ALT_RANK_NAMES } from "../../src/services/promotion.js";

// 16 Nov 2026 promotions rework: the bot's rule decides, officers click, the Alt rank is never touched.
let s: LuaSession;
afterEach(() => s?.close());

const FEED = (over = "") => `GuildedPromotion = { updatedAt = "2026-11-16T12:00:00Z", fromRank = "Initiate", minDays = 7, minLevel = 20,
  ready = { "Amy-Realm", "Bob-Realm" }, waiting = { { name = "Dee-Realm", daysLeft = 3 } }, linked = { "Amy-Realm", "Bob-Realm", "Dee-Realm", "Cy-Realm" } ${over} }`;

// Ranks 0-5: Guild Master, Officer, Veteran, Member, Initiate, Alt. Boss (you) is rank 0; Amy, Bob and Dee are Initiates, Cy is an Alt.
function setup(feed: string | null = FEED(), ranks = '{ "Guild Master", "Officer", "Veteran", "Member", "Initiate", "Alt" }') {
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
      { name = "Amy-Realm", rank = 4, guid = "amy", public = "", officer = "" }, { name = "Bob-Realm", rank = 4, guid = "bob", public = "", officer = "" },
      { name = "Cy-Realm", rank = 5, guid = "cy", public = "", officer = "" }, { name = "Dee-Realm", rank = 4, guid = "dee", public = "", officer = "" } }
    LEVELS = {}
    function GetGuildRosterInfo(i) READS = READS + 1; local r = ROWS[i]; return r.name, RANKNAMES[r.rank + 1], r.rank, LEVELS[r.name] or 30, "Mage", "Zone", r.public, r.officer, true, nil, "MAGE", 0, 0, false, false, 0, r.guid end
    -- Frames that remember their text and shown state.
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
    function FRAME(name) for _, f in ipairs(FRAMES) do if f.text == name or (f.shown and f.text:find(name, 1, true)) then return f end end end
  `);
  s.load("Modules/RosterTools.lua");
  s.load("Modules/Promotion.lua");
  s.load("Modules/OfficerNotes.lua");
  s.run('NS.util.gameEdition=function() return EDITION end; NS.util.address=function(n) return n end');
  if (feed) s.run(feed);
  return s;
}
const roster = (clock = 100) => s.run(`CLOCK=${clock}; fire_event("GUILD_ROSTER_UPDATE")`);
const calls = () => s.run("local out={} for i,c in ipairs(CALLS) do out[i]=tostring(c[1]) end return table.concat(out,'|')");
const ready = () => s.run("local r=NS.promotion.ready(); local out={} for i,x in ipairs(r) do out[i]=x.name end return table.concat(out,'|')");
// The roster confirms Amy's promotion: she is now a Member.
const confirm = (row: number, rank: number, clock: number) => s.run(`ROWS[${row}].rank=${rank}; CLOCK=${clock}; fire_event("GUILD_ROSTER_UPDATE")`);

describe("only the bot's ready list is offered", () => {
  it("offers ready members at the starting rank, never a linked-only or waiting member", () => {
    setup(); roster();
    expect(ready()).toBe("Amy-Realm|Bob-Realm"); // Dee waits, Cy is in `linked` but is an Alt: neither is offered
    expect(s.run("local w=NS.promotion.waiting(); return #w..':'..w[1].display..':'..w[1].daysLeft")).toBe("1:Dee-Realm:3");
  });
  it("matches the rank by name: a listed member at another rank is not offered, whatever the rank index", () => {
    setup(); roster();
    s.run("ROWS[3].rank = 3"); // Bob became a Member (index 3): still listed as ready by a stale feed
    roster(110);
    expect(ready()).toBe("Amy-Realm");
    // The starting rank is not the lowest index here: Initiate is index 4 of 0-5. A Member (3) is never taken for it.
    expect(s.run("return NS.promotion.rule().fromRank")).toBe("Initiate");
  });
  it("applies the bot's minimum level to the in-game level", () => {
    setup(); roster();
    s.run('LEVELS["Bob-Realm"] = 12');
    roster(110);
    expect(ready()).toBe("Amy-Realm");
  });
  it("falls back to the local rule (days seen on this roster) when the officer has no bot list", () => {
    setup(null); roster();
    s.run("DB.rankSince = { ['Amy-Realm'] = { rank = 'Initiate', since = 1800000000 - 9 * 86400 } }");
    expect(ready()).toBe("Amy-Realm");
    expect(s.run("return NS.promotion.rule().minDays")).toBe("7");
    expect(s.run("local n = NS.promotion.updateAlert(); return n")).toBe("0"); // no alert without the bot's list
  });
});

describe("nothing is promoted without a click", () => {
  it("shows the alert on roster events but never sends a promotion by itself", () => {
    setup(); roster();
    for (let t = 110; t < 400; t += 10) roster(t);
    s.run("for _, f in ipairs(FRAMES) do if f.scripts.OnUpdate then f.scripts.OnUpdate(f, 5) end end");
    expect(calls()).toBe("");
    expect(s.run("return tostring(NS.officerNotes.tick)")).toBe("nil"); // the 2 s promoter is gone
    expect(s.run('local a = FRAME("2 ready to promote"); return tostring(a ~= nil and a.shown)')).toBe("true");
  });
  it("the alert opens the panel and right-click hides it until the count changes", () => {
    setup(); roster();
    s.run('FRAME("2 ready to promote").scripts.OnClick(nil, "RightButton")');
    expect(s.run('return tostring(FRAME("2 ready to promote") ~= nil and FRAME("2 ready to promote").shown)')).toBe("false");
    roster(200);
    expect(s.run('return tostring(FRAME("2 ready to promote").shown)')).toBe("false");
    s.run("ROWS[3].rank = 3"); roster(300); // Bob promoted elsewhere: the count changes
    expect(s.run('return tostring(FRAME("1 ready to promote").shown)')).toBe("true");
    s.run('FRAME("1 ready to promote").scripts.OnClick(nil, "LeftButton")');
    expect(s.run('return tostring(FRAME("Promote next") ~= nil)')).toBe("true");
    expect(calls()).toBe("");
  });
  it("the officer switch turns the alert off and keeps its saved key", () => {
    setup(); roster();
    s.run('NS.officerNotes.command({"officer","auto","promote","off"})');
    expect(s.run("return tostring(DB.officerAuto.off.promote)")).toBe("true");
    expect(s.run('return tostring(FRAME("2 ready to promote").shown)')).toBe("false");
    expect(s.run("return NS.promotion.updateAlert()")).toBe("0");
  });
});

describe("one click, one promotion, verified before it counts", () => {
  it("steps through one member per click: the next waits for the roster to confirm the last", () => {
    setup(); roster();
    expect(s.run("local ok, msg = NS.promotion.promoteNext(); return tostring(ok)")).toBe("true");
    expect(calls()).toBe("Amy-Realm");
    expect(s.run("local ok, msg = NS.promotion.promoteNext(); return tostring(ok) .. ':' .. msg")).toBe("false:Wait for the roster to confirm the previous promotion.");
    expect(calls()).toBe("Amy-Realm");
    confirm(2, 3, 110); // verified
    expect(s.run("local ok = NS.promotion.promoteNext(); return tostring(ok)")).toBe("true");
    expect(calls()).toBe("Amy-Realm|Bob-Realm");
  });
  it("marks a member promoted only after the roster verified it", () => {
    setup(); roster();
    s.run("NS.promotion.promoteNext()");
    expect(s.run("return tostring(next(DB.officerAuto and DB.officerAuto.promoted or {}))")).toBe("nil");
    confirm(2, 3, 110);
    expect(s.run("return tostring(DB.officerAuto.promoted['Amy-Realm'] ~= nil)")).toBe("true");
    expect(s.run("return DB.officerAuto.log[1].kind")).toBe("promote");
  });
  it("a refused or unverified attempt is not remembered and can be retried, a bounded number of times", () => {
    setup(); roster();
    s.run("GuildPromote = function() error('refused') end");
    expect(s.run("local ok = NS.promotion.promoteNext(); return tostring(ok)")).toBe("false");
    expect(s.run("return tostring(next(DB.officerAuto and DB.officerAuto.promoted or {}))")).toBe("nil");
    s.run("GuildPromote = function(n) CALLS[#CALLS + 1] = { n } end");
    expect(s.run("local ok = NS.promotion.promoteNext(); return tostring(ok)")).toBe("true"); // retried: Amy again
    expect(calls()).toBe("Amy-Realm");
    // Never verified (the roster does not change): it times out, stays unremembered, and three tries are the limit.
    roster(120);
    expect(s.run("return tostring(next(DB.officerAuto and DB.officerAuto.promoted or {}))")).toBe("nil");
    expect(s.run("local ok = NS.promotion.promoteNext(); return tostring(ok)")).toBe("true"); // third try
    roster(140);
    roster(160);
    expect(s.run("local item = NS.promotion.ready()[1]; return item.name .. ':' .. tostring(item.exhausted)")).toBe("Amy-Realm:true");
    expect(s.run("local n = NS.promotion.actionable(); return n")).toBe("1"); // Amy no longer counts for the alert
    expect(s.run("local ok = NS.promotion.promoteNext(); return tostring(ok)")).toBe("true"); // Bob is next
    expect(calls()).toBe("Amy-Realm|Amy-Realm|Bob-Realm");
  });
  it("a game refusal (blocked action) is remembered per client build and stops the offers", () => {
    setup(); roster();
    s.run("NS.promotion.promoteNext(); NS.rosterTools.onBlocked()");
    expect(s.run("local ok, msg = NS.promotion.promoteNext(); return tostring(ok)")).toBe("false");
    expect(calls()).toBe("Amy-Realm");
  });
});

describe("the panel", () => {
  it("shows the bot's rule, ready rows, waiting rows and the step-through button", () => {
    setup(); roster();
    s.run("NS.promotion.open()");
    const texts = s.run("return TEXTS()");
    expect(texts).toContain("Rule: rank Initiate for 7+ days, level 20+.");
    expect(texts).toContain("Amy-Realm");
    expect(texts).toContain("Dee-Realm - waiting (3 days left)");
    expect(texts).toContain("Promote next (2 left)");
  });
  it("refreshes on a roster event while it is open", () => {
    setup(); roster();
    s.run("NS.promotion.open()");
    s.run("ROWS[3].rank = 3"); roster(110); // Bob left the starting rank
    const texts = s.run("return TEXTS()");
    expect(texts).toContain("Promote next (1 left)");
    expect(texts).not.toContain("Bob-Realm -");
  });
  it("Promote next from the panel runs one promotion inside the click", () => {
    setup(); roster();
    s.run("NS.promotion.open()");
    s.run('FRAME("Promote next").scripts.OnClick()');
    expect(calls()).toBe("Amy-Realm");
  });
});

describe("the Alt rank is never promoted", () => {
  it("skips a listed member whose rank is an alt rank, and refuses a direct promote", () => {
    setup(FEED()); roster();
    expect(ready()).not.toContain("Cy-Realm");
    expect(s.run('local ok, msg = NS.promotion.promote("Cy-Realm"); return tostring(ok) .. ":" .. msg')).toBe("false:Alts are never promoted.");
    expect(calls()).toBe("");
    // Even when the bot lists Cy as ready and the rule starts at the Alt rank.
    setup(FEED().replace('fromRank = "Initiate"', 'fromRank = "Alt"').replace('"Bob-Realm" }', '"Bob-Realm", "Cy-Realm" }')); roster();
    expect(ready()).toBe("");
  });
  // 17 Nov 2026 root cause: the guild keeps Alt (index 5) directly above Initiate (index 6). The old check read the rank
  // one step up and dropped every Initiate ("Nobody is ready"). The promotion now skips the alt rank and lands on Member.
  const ALT_ABOVE = '{ "Guild Master", "Officer", "Veteran", "Member", "Member", "Alt", "Initiate" }';
  const altAbove = () => {
    setup(FEED(), ALT_ABOVE);
    s.run('ROWS[2].rank = 6; ROWS[3].rank = 6; ROWS[4].rank = 5; ROWS[5].rank = 6');
    roster();
  };
  it("lists Initiates when the rank above them is an alt rank, and promotes past it (never into it)", () => {
    altAbove();
    expect(ready()).toBe("Amy-Realm|Bob-Realm");
    s.run('C_GuildInfo={SetGuildRankOrder=function() RANKORDER = true end}; SetGuildMemberRank=function(i,r) CALLS[#CALLS+1]={i,r} end');
    expect(s.run('local ok = NS.promotion.promote("Amy-Realm"); return tostring(ok)')).toBe("true");
    expect(s.run('return CALLS[1][1]..":"..CALLS[1][2]')).toBe("2:5"); // roster index 2; rank number 5 = index 4, the Member rank above Alt
    expect(s.run("return tostring(RANKORDER)")).toBe("nil"); // SetGuildRankOrder is never called
  });
  it("offers nothing it cannot do: a client that can only promote one step refuses to skip the alt rank", () => {
    altAbove();
    expect(s.run('local ok = NS.promotion.promote("Amy-Realm"); return tostring(ok)')).toBe("false");
    expect(calls()).toBe("");
  });
  it("explains an empty list with /guilded promote why", () => {
    altAbove();
    s.run("NS.isOfficer = function() return true end; MESSAGES = {}; NS.commandHandlers.promote({ 'promote', 'why' })");
    const out = s.run("return table.concat(MESSAGES, '|')");
    expect(out).toContain("Promote check, rank Initiate: 5 roster rows, 2 at another rank, 0 you, 0 alt rank, 0 with no rank to move up to.");
    expect(out).toContain("Discord list: 2 names, 0 not found in the roster. Of 3 at the rank: 1 not on the list, 2 ready.");
    s.run("NS.isOfficer = function() return false end; MESSAGES = {}; NS.commandHandlers.promote({ 'promote', 'why' })");
    expect(s.run("return table.concat(MESSAGES, '|')")).toBe("Officers only.");
  });
  it("the key binding promotes the next ready member, prints the result and does nothing in combat", () => {
    altAbove();
    s.run("NS.isOfficer = function() return true end; MESSAGES = {}; SetGuildMemberRank=function(i,r) CALLS[#CALLS+1]={i,r} end");
    expect(s.run("return type(GuildedPromoteNext_OnKey) .. ':' .. BINDING_NAME_GUILDED_PROMOTE_NEXT")).toBe("function:Promote next ready member");
    s.run("COMBAT = true; GuildedPromoteNext_OnKey()");
    expect(calls()).toBe("");
    expect(s.run("return MESSAGES[#MESSAGES]")).toBe("Promote next: not while in combat.");
    s.run("COMBAT = false; CLOCK = 101; fire_event('GUILD_ROSTER_UPDATE'); GuildedPromoteNext_OnKey()");
    expect(s.run("return CALLS[1][1]")).toBe("2");
    expect(s.run("return MESSAGES[#MESSAGES]")).toContain("Promotion requested: Amy-Realm.");
    // A second press waits for the roster to verify the first.
    s.run("GuildedPromoteNext_OnKey()");
    expect(s.run("return #CALLS")).toBe("1");
    s.run("NS.isOfficer = function() return false end; GuildedPromoteNext_OnKey()");
    expect(s.run("return MESSAGES[#MESSAGES]")).toBe("Officers only.");
  });
  it("registers the key binding in Bindings.xml", async () => {
    const xml = (await import("node:fs")).readFileSync(new URL("../../addon/Guilded/Bindings.xml", import.meta.url), "utf8");
    expect(xml).toContain('name="GUILDED_PROMOTE_NEXT"');
    expect(xml).toContain("GuildedPromoteNext_OnKey()");
  });
  it("refuses an alt rank as the local rule's starting rank", () => {
    setup(null); roster();
    expect(s.run('return tostring(NS.promotion.setRule("Alts", 7))')).toBe("false");
    expect(s.run("return NS.promotion.rule().fromRank")).toBe("Initiate");
  });
  it("recognises alt rank names in English and French, and shares its list with the bot", () => {
    setup();
    const alt = (name: string) => s.run(`return tostring(NS.rosterTools.isAltRank("${name}"))`);
    for (const name of ["Alt", "alts", "ALT (bank)", "Alt-Bank", "Reroll", "Rerolls", "Re-roll", "R\\195\\169roll", "Twink"]) expect(alt(name)).toBe("true");
    for (const name of ["Member", "Initiate", "Altar", "Alternate", "Veteran", "Salt"]) expect(alt(name)).toBe("false");
    for (const name of ALT_RANK_NAMES) expect(alt(name)).toBe("true");
  });
});

describe("no polling", () => {
  it("only the engine's verify tick remains: no OnUpdate in the promotion modules and no periodic roster requests", () => {
    setup(); roster();
    s.run("REQUESTS = 0; GuildRoster = function() REQUESTS = REQUESTS + 1 end; for _, f in ipairs(FRAMES) do if f.scripts.OnUpdate then f.scripts.OnUpdate(f, 30) end end");
    expect(s.run("return REQUESTS")).toBe("0");
    expect(calls()).toBe("");
  });
});

describe("manual helper and the alt rank in the way (19 Nov 2026)", () => {
  const ALT_ABOVE = '{ "Guild Master", "Officer", "Veteran", "Member", "Alt", "Initiate" }';
  const rows = 'ROWS[2].rank=5; ROWS[3].rank=5; ROWS[4].rank=4; ROWS[5].rank=5';
  it("without SetGuildMemberRank, never calls the one-step promote into an alt rank (manual mode)", () => {
    setup(FEED(), ALT_ABOVE); s.run(rows); roster();
    expect(s.run("return tostring(NS.promotion.manual(NS.promotion.ready()))")).toBe("true");
    expect(s.run("local ok, msg = NS.promotion.promote('Amy-Realm'); return tostring(ok)")).toBe("false");
    expect(s.run("local ok = NS.promotion.promoteNext(); return tostring(ok)")).toBe("false");
    s.run("GuildedPromoteNext_OnKey()");
    expect(calls()).toBe("");
  });
  it("the engine itself refuses a one-step promote into an alt rank", () => {
    setup(FEED(), ALT_ABOVE); s.run(rows); roster();
    s.run("NS.isOfficer = function() return true end");
    expect(s.run(String.raw`local p = NS.rosterTools.preview("character\taction\tvalue\nAmy-Realm\tpromote\t"); return tostring(p.blocked)`)).toBe("true");
    expect(calls()).toBe("");
  });
  it("with SetGuildMemberRank an alt rank in the way is skipped in one click: no manual mode", () => {
    setup(FEED(), ALT_ABOVE); s.run(rows); roster();
    s.run("SetGuildMemberRank=function(i,r) CALLS[#CALLS+1]={i,r} end; NS.isOfficer=function() return true end");
    expect(s.run("return tostring(NS.promotion.manual(NS.promotion.ready()))")).toBe("false");
    expect(s.run("return tostring((NS.promotion.promote('Amy-Realm')))")).toBe("true");
    expect(s.run("return CALLS[1][1]..':'..CALLS[1][2]")).toBe("2:4"); // Member (index 3) sits above Alt (index 4): rank number 4
  });
  it("a landing at the wrong rank stops further promotions and falls back to manual mode", () => {
    setup(FEED(), ALT_ABOVE); s.run(rows); roster();
    s.run("SetGuildMemberRank=function(i,r) CALLS[#CALLS+1]={i,r} end; NS.isOfficer=function() return true end");
    s.run("assert(NS.promotion.promote('Amy-Realm')); ROWS[2].rank = 4; CLOCK=101; fire_event('GUILD_ROSTER_UPDATE')");
    expect(s.run("return tostring(NS.promotion.manual())")).toBe("true");
    expect(s.run("return tostring((NS.promotion.promote('Bob-Realm')))")).toBe("false");
  });
  it("/guilded promote test prints the call and makes none", () => {
    setup(FEED(), ALT_ABOVE); s.run(rows); roster();
    s.run("SetGuildMemberRank=function(i,r) CALLS[#CALLS+1]={i,r} end; NS.isOfficer=function() return true end; MESSAGES={}");
    s.run("NS.commandHandlers.promote({ 'promote', 'test', 'Amy-Realm' })");
    expect(s.run("return table.concat(MESSAGES, '|')")).toContain("Would call: SetGuildMemberRank(2, 4)");
    expect(calls()).toBe("");
  });
  it("shows a manual panel when this client refused rank changes: no promote buttons, copy name and open roster", () => {
    setup(); roster();
    s.run('DB.rosterBlocked = { rank = tostring(select(2, GetBuildInfo()) or "?") }');
    s.run('NS.promotion.open()');
    expect(s.run("return tostring(NS.promotion.manual())")).toBe("true");
    const texts = s.run("return TEXTS()");
    expect(texts).toContain("Open guild roster");
    expect(texts).toContain("Copy name");
    expect(texts).not.toContain("Promote next");
    s.run('OPENED=0; function ToggleGuildFrame() OPENED=OPENED+1 end; FRAME("Open guild roster").scripts.OnClick()');
    expect(s.run("return OPENED")).toBe("1");
    s.run('COPIED=nil; NS.showCopyText=function(t) COPIED=t end; FRAME("Copy name").scripts.OnClick()');
    expect(s.run("return COPIED")).toMatch(/Amy|Bob/);
    expect(calls()).toBe("");
  });
  it("the panel sits above the Roster admin window and shows the rule from the feed", () => {
    setup(FEED(', minVoice = 180, requireLink = true')); roster();
    s.run("NS.promotion.open()");
    expect(s.run("return TEXTS()")).toContain("Promotions need a linked character, 7 days at Initiate, 3 h of voice a week.");
    expect(s.run("for _, f in ipairs(FRAMES) do if f.strata == 'DIALOG' then return 'DIALOG' end end return 'none'")).toBe("DIALOG");
  });
  it("a waiting row shows the bot's reason, not 0 days left (bot feed -> companion writer -> addon text)", async () => {
    const { promotionToLua } = await import("../../companion/standings-format.mjs");
    const lua = promotionToLua({ updatedAt: "2026-11-19T12:00:00Z", fromRank: "Initiate", minDays: 7, minLevel: 0, minVoiceMinutes: 180, requireLink: true, ready: [],
      waiting: [{ name: "Dee-Realm", daysLeft: 0, reason: "voice:0:180" }, { name: "Cy-Realm", daysLeft: 0, reason: "link" }] }).join("\n");
    setup(null); s.run(lua); s.run("ROWS[4].rank = 4"); roster();
    s.run("NS.promotion.open()");
    const texts = s.run("return TEXTS()");
    expect(texts).toContain("Dee-Realm - waiting (voice 0 h 00 / 3 h 00)".replace("0 h 00 / 3 h 00", "0 min / 3 h 00"));
    expect(texts).not.toContain("0 days left");
  });
});
