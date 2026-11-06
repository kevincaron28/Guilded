import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

let session: LuaSession | undefined;
afterEach(() => { session?.close(); session = undefined; });

const NOW = Math.floor(Date.UTC(2026, 10, 10, 12) / 1000);
const RAID_AT = "2026-11-12T02:00:00.000Z";

// The module on its own, with a calendar stub and GuildedRaids as the companion writes it.
function withSignup(extra = ""): LuaSession {
  session = newLuaSession();
  session.run(String.raw`
    NOW = ${NOW}
    function GetServerTime() return NOW end
    function UnitClass() return "Shaman", "SHAMAN" end
    LOCALIZED_CLASS_NAMES_MALE = { SHAMAN = "Shaman", PRIEST = "Priest", WARRIOR = "Warrior", DRUID = "Druid" }
    DB = {}
    CHAT = {}
    REPLIES = {}
    GuildedStandings = { updatedAt = "2026-11-10T11:00:00Z" }
    GuildedRaids = {
      { id = "r1", title = "Molten Core", at = "${RAID_AT}", core = "Tuesday", note = "", signups = {
        { "Ann", "T", "WARRIOR", "S", ${NOW - 7200} },
        { "Bea", "H", "PRIEST", "S", ${NOW - 7000} },
        { "Cy", "H", "DRUID", "S", ${NOW - 6000} },
        { "Dee", "D", "SHAMAN", "S", ${NOW - 5000} },
        { "Eve", "D", "SHAMAN", "M", ${NOW - 4000} },
        { "Fay", "D", "PRIEST", "W", ${NOW - 3000} },
        { "Kev", "D", "SHAMAN", "S", ${NOW - 8000} },
      } },
      { id = "discord:77", title = "Game night", at = "${RAID_AT}", core = "", note = "" },
    }
    NS = {
      L = function(t) return t end,
      moduleActive = function() return true end,
      normalizeName = function(n) return (string.gsub(n or "", "%-.*", "")) end,
      playerName = function() return "Kev" end,
      getDb = function() return DB end,
      message = function(t) CHAT[#CHAT + 1] = t end,
      commandHandlers = {}, commandHelp = {},
      util = { isoEpoch = function(text)
        local y, m, d, h, mi, s = string.match(text, "^(%d+)-(%d+)-(%d+)T(%d+):(%d+):(%d+)")
        if not y then return nil end
        return ${NOW} + (tonumber(d) - 10) * 86400 + (tonumber(h) - 12) * 3600 + tonumber(mi) * 60 + tonumber(s) + (tonumber(m) - 11) * 0
      end }
    }
    NS.calendar = {
      discordRaids = function()
        local out = {}
        for _, raid in ipairs(GuildedRaids) do
          out[#out + 1] = { id = raid.id, title = raid.title, at = NS.util.isoEpoch(raid.at), core = raid.core, signups = raid.signups }
        end
        return out
      end,
      reply = function(ref, answer, done) REPLIES[#REPLIES + 1] = ref .. ":" .. answer; if done then done(true) end end
    }
    ${extra}
  `);
  session.load("Modules/RaidSignup.lua");
  return session;
}

describe("RaidSignup.lua counts", () => {
  it("counts tanks, healers and DPS for the signed up, and class numbers, with tentative and waitlist apart", () => {
    const s = withSignup();
    const text = s.run(`local e = NS.raidSignup.events()[1]; return NS.raidSignup.countText(e.counts) .. "|" .. NS.raidSignup.classText(e.counts)`);
    // Kev's saved signup counts as a DPS; Eve (tentative) and Fay (waitlist) are not in the roles.
    expect(text).toBe("1 T · 2 H · 2 D · 1 tentative · 1 waitlisted|Shaman 2 · Druid 1 · Priest 1 · Warrior 1");
  });

  it("lists only bot raids, not Discord scheduled events", () => {
    const s = withSignup();
    expect(s.run(`return #NS.raidSignup.events()`)).toBe("1");
  });
});

describe("RaidSignup.lua conflict rule: the latest change per member wins", () => {
  const first = `local e = NS.raidSignup.events()[1]; local c = e.counts; return c.T .. "T " .. c.H .. "H " .. c.D .. "D " .. c.maybe .. "M"`;

  it("a newer in-game answer replaces the player's older Discord row", () => {
    const s = withSignup();
    // Kev clicked Tank after the Discord signup (8000 s ago).
    s.run(`DB.signupAnswers = { r1 = { status = "ACCEPTED", role = "TANK", at = ${NOW - 60}, name = "Kev" } }`);
    expect(s.run(first)).toBe("2T 2H 1D 1M");
  });

  it("a newer Discord row beats an older in-game answer", () => {
    const s = withSignup();
    // The answer was given before the Discord signup (Kev is on the list as a DPS from 8000 s ago).
    s.run(`DB.signupAnswers = { r1 = { status = "ACCEPTED", role = "TANK", at = ${NOW - 20000}, name = "Kev" } }`);
    expect(s.run(first)).toBe("1T 2H 2D 1M");
  });

  it("Can't removes the player from the counts when it is the newest change", () => {
    const s = withSignup();
    s.run(`DB.signupAnswers = { r1 = { status = "DECLINED", at = ${NOW - 60}, name = "Kev" } }`);
    expect(s.run(first)).toBe("1T 2H 1D 1M");
    expect(s.run(`return NS.raidSignup.mineText(NS.raidSignup.events()[1])`)).toBe("You can't make it.");
  });

  it("Tentative moves the player out of the roles", () => {
    const s = withSignup();
    s.run(`DB.signupAnswers = { r1 = { status = "TENTATIVE", role = "HEALER", at = ${NOW - 60}, name = "Kev" } }`);
    expect(s.run(first)).toBe("1T 2H 1D 2M");
    expect(s.run(`return NS.raidSignup.mineText(NS.raidSignup.events()[1])`)).toBe("Tentative as Healer.");
  });

  it("shows a player who is not on the list yet, and stops showing an old answer once newer standings no longer list them", () => {
    const s = withSignup();
    s.run(`GuildedRaids[1].signups[7] = nil; DB.signupAnswers = { r1 = { status = "ACCEPTED", role = "TANK", at = ${NOW - 3600}, name = "Kev" } }`);
    // Standings written after the answer (plus a little grace) are the truth: the player is not on Discord any more.
    s.run(`GuildedStandings.updatedAt = "2026-11-10T11:59:00Z"`);
    expect(s.run(first)).toBe("1T 2H 1D 1M");
    // Standings older than the answer cannot know about it yet: it is shown.
    s.run(`GuildedStandings.updatedAt = "2026-11-10T10:00:00Z"`);
    expect(s.run(first)).toBe("2T 2H 1D 1M");
  });
});

describe("RaidSignup.lua answering", () => {
  it("saves the click for the companion with the role and time, and remembers the role", () => {
    const s = withSignup();
    expect(s.run(`return tostring(NS.raidSignup.answer(NS.raidSignup.events()[1], "ACCEPTED", "HEALER"))`)).toBe("true");
    expect(s.run(`local a = DB.signupAnswers.r1; return a.status .. "/" .. a.role .. "/" .. a.at .. "/" .. a.name`)).toBe(`ACCEPTED/HEALER/${NOW}/Kev`);
    expect(s.run(`return NS.raidSignup.role()`)).toBe("HEALER");
    expect(s.run(`return CHAT[#CHAT]`)).toContain("Signed up for Molten Core as Healer.");
    // No calendar event is linked to this raid, so no calendar reply is attempted.
    expect(s.run(`return #REPLIES`)).toBe("0");
  });

  it("also answers the game's calendar when the raid is a calendar event, on the click", () => {
    const s = withSignup(`DB.calendarEvents = { events = { { ref = "501", botRaidId = "r1", title = "Molten Core", startsAt = ${NOW + 100000}, invites = {} } } }`);
    s.run(`NS.raidSignup.answer(NS.raidSignup.events()[1], "TENTATIVE", "DPS")`);
    expect(s.run(`return REPLIES[1]`)).toBe("501:TENTATIVE");
    expect(s.run(`return CHAT[1]`)).toContain("Answered in the game calendar too");
  });

  it("lists calendar events that are no Discord raid and answers them in the calendar only", () => {
    const s = withSignup(`DB.calendarEvents = { events = { { ref = "900", title = "Guild picnic", startsAt = ${NOW + 200000}, invites = { { name = "Ann", status = "ACCEPTED" }, { name = "Bea", status = "TENTATIVE" }, { name = "Cy", status = "DECLINED" } } } } }`);
    expect(s.run(`return #NS.raidSignup.events()`)).toBe("2");
    expect(s.run(`local e = NS.raidSignup.events()[2]; return e.title .. "|" .. tostring(e.calendarOnly) .. "|" .. e.counts.yes .. e.counts.maybe .. e.counts.no`)).toBe("Guild picnic|true|111");
    s.run(`NS.raidSignup.answer(NS.raidSignup.events()[2], "ACCEPTED")`);
    expect(s.run(`return REPLIES[1]`)).toBe("900:ACCEPTED");
    // Nothing for the bot to apply: the calendar-only answer is not an upload.
    expect(s.run(`return tostring(DB.signupAnswers)`)).toBe("nil");
    expect(s.run(`return NS.raidSignup.mineText(NS.raidSignup.events()[2])`)).toBe("You said yes in the calendar.");
  });

  it("ignores a calendar event that is the same as a Discord raid (same title, same hour)", () => {
    const s = withSignup(`DB.calendarEvents = { events = { { ref = "502", title = "molten core", startsAt = NS.util.isoEpoch("${RAID_AT}") + 600, invites = {} } } }`);
    expect(s.run(`return #NS.raidSignup.events()`)).toBe("1");
  });

  it("does nothing when the module is turned off, and refuses an unknown status", () => {
    const s = withSignup();
    s.run(`NS.moduleActive = function() return false end`);
    expect(s.run(`return tostring(NS.raidSignup.answer(NS.raidSignup.events()[1], "ACCEPTED"))`)).toBe("false");
    s.run(`NS.moduleActive = function() return true end`);
    expect(s.run(`return tostring(NS.raidSignup.answer(NS.raidSignup.events()[1], "NONSENSE"))`)).toBe("false");
    expect(s.run(`return tostring(DB.signupAnswers)`)).toBe("nil");
  });

  it("drops answers older than thirty days", () => {
    const s = withSignup();
    s.run(`DB.signupAnswers = { old = { status = "ACCEPTED", role = "DPS", at = ${NOW - 40 * 86400}, name = "Kev" }, fresh = { status = "ACCEPTED", role = "DPS", at = ${NOW - 86400}, name = "Kev" } }; NS.raidSignup.prune()`);
    expect(s.run(`return tostring(DB.signupAnswers.old) .. "/" .. tostring(DB.signupAnswers.fresh ~= nil)`)).toBe("nil/true");
  });
});

describe("RaidSignup.lua command", () => {
  const run = (s: LuaSession, line: string) => s.run(`local a = {}; for w in string.gmatch(${JSON.stringify(line)}, "%S+") do a[#a + 1] = w end; NS.commandHandlers["signups"](a); return CHAT[#CHAT]`);

  it("lists the raids with their counts and answers by number", () => {
    const s = withSignup();
    expect(run(s, "")).toContain("1 T · 2 H · 2 D");
    expect(run(s, "yes 1 tank")).toContain("Signed up for Molten Core as Tank.");
    expect(s.run(`return DB.signupAnswers.r1.role`)).toBe("TANK");
    expect(run(s, "no 1")).toContain("You can't make Molten Core.");
    expect(s.run(`return DB.signupAnswers.r1.status`)).toBe("DECLINED");
    expect(run(s, "maybe 9")).toBe("Use the number from /guilded signups.");
  });
});

describe("RaidSignup.lua page", () => {
  // Plain widgets standing in for the tools window's helpers.
  const PAGE = String.raw`
    local function widget()
      local w = { text = "", shown = true }
      function w:SetText(t) self.text = t end
      function w:GetText() return self.text end
      function w:Show() self.shown = true end
      function w:Hide() self.shown = false end
      function w:IsShown() return self.shown end
      function w:SetWidth() end
      function w:SetScript(name, fn) self[name] = fn end
      return w
    end
    PAGE = widget()
    PAGEWIDGETS = {}
    UI = {
      newLabel = function(_, text) local w = widget(); w.text = text; PAGEWIDGETS[#PAGEWIDGETS + 1] = w; return w end,
      newButton = function(_, text, _, onClick) local w = widget(); w.text = text; w.click = onClick; PAGEWIDGETS[#PAGEWIDGETS + 1] = w; return w end,
      at = function(w) return w end,
      width = 500,
    }
    NS.raidSignup.buildPage(PAGE, UI)
  `;

  it("shows each raid with its counts and a click on Sign up saves the answer for the selected role", () => {
    const s = withSignup();
    s.run(PAGE);
    const view = (expr: string) => s.run(`return ${expr}`);
    expect(view(`NS.raidSignup.view.blocks[1].text:GetText()`)).toContain("1. Molten Core");
    expect(view(`NS.raidSignup.view.blocks[1].text:GetText()`)).toContain("1 T · 2 H · 2 D");
    expect(view(`tostring(NS.raidSignup.view.blocks[2].text:IsShown())`)).toBe("false");
    // Pick Tank, then Sign up.
    s.run(`NS.raidSignup.view.roleButtons.TANK.click()`);
    expect(view(`NS.raidSignup.view.roleButtons.TANK:GetText()`)).toBe("[Tank]");
    s.run(`NS.raidSignup.view.blocks[1].yes.click()`);
    expect(view(`DB.signupAnswers.r1.role .. "/" .. DB.signupAnswers.r1.status`)).toBe("TANK/ACCEPTED");
    expect(view(`NS.raidSignup.view.blocks[1].text:GetText()`)).toContain("2 T · 2 H · 1 D");
    expect(view(`NS.raidSignup.view.blocks[1].mine:GetText()`)).toBe("Signed up as Tank.");
    // Can't clears it.
    s.run(`NS.raidSignup.view.blocks[1].no.click()`);
    expect(view(`NS.raidSignup.view.blocks[1].mine:GetText()`)).toBe("You can't make it.");
  });

  it("says so when no raid is known", () => {
    const s = withSignup();
    s.run(`GuildedRaids = {}`);
    s.run(PAGE);
    expect(s.run(`return NS.raidSignup.view.empty:GetText()`)).toContain("No upcoming raids known yet");
  });
});
