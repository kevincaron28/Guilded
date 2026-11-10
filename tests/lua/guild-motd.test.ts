import { afterEach, describe, expect, it } from "vitest";
import { addonSource, newLuaSession, type LuaSession } from "./harness.js";

let session: LuaSession | undefined;
afterEach(() => { session?.close(); session = undefined; });

function setup() {
  const s = session = newLuaSession();
  s.run(`
    CLOCK = 1000; EPOCH = 1792929600; MOTD = "old message"; WRITES = {}; SENT = {}; COMBAT = false
    CAN = true; OFFICER = true; RAIDS = {}; DB = {}
    date = os.date
    function GetTime() return CLOCK end
    function GetServerTime() return EPOCH end
    function IsInGuild() return true end
    function InCombatLockdown() return COMBAT end
    function CanEditMOTD() return CAN end
    function GetGuildRosterMOTD() return MOTD end
    -- The officer copies the ready text and pastes it into the guild info frame.
    function ENTER()
      local text = NS.guildMotd.config().intended.text
      WRITES[#WRITES + 1] = text; MOTD = text
    end
    function ADVANCE(n) CLOCK = CLOCK + n; EPOCH = EPOCH + n end
    NS = {
      getDb = function() return DB end,
      now = function() return EPOCH end,
      isOfficer = function() return OFFICER end,
      isOfficerName = function(name) return name ~= "Pleb" end,
      normalizeName = function(name) return name end,
      playerName = function() return "Mira" end,
      message = function(t) LAST_MESSAGE = t end,
      calendar = { discordRaids = function() return RAIDS end },
      commandHandlers = {},
      comm = { send = function(prefix, text) SENT[#SENT + 1] = text; return true end, register = function() end, accept = function() return true end }
    }
  `);
  s.load("Modules/GuildMotd.lua");
  // Skip the short wait for other officers' hello messages unless a test wants it.
  s.run(`M = NS.guildMotd; M.helloAt = CLOCK - 100; CFG = M.config()`);
  return s;
}
const on = (s: LuaSession, extra = "") => s.run(`M.set("enabled", true); ${extra}`);
// The officer clicks the "Update guild message" button: the only way a write happens.
const click = (s: LuaSession) => s.run("local code = M.tick(); if code == \"due\" then M.apply(); ENTER(); return M.tick() end return code");

describe("automatic guild message of the day", () => {
  it("is off by default and writes nothing", () => {
    const s = setup();
    expect(s.run("return M.tick()")).toBe("off");
    expect(s.run("return #WRITES")).toBe("0");
  });

  it("keeps messages within 128 bytes, keeps the suffix, and never splits a UTF-8 character", () => {
    const s = setup();
    expect(s.run(`return #M.fit(string.rep("a", 300), "")`)).toBe("128");
    const fitted = s.run(`return M.fit(string.rep("a", 300), "Lie ton perso: Guilded Companion")`);
    expect(fitted.length).toBeLessThanOrEqual(128);
    expect(fitted.endsWith("Lie ton perso: Guilded Companion")).toBe(true);
    // 130 two-byte characters: the cut must land on a character boundary.
    const accented = s.run(`return M.fit(string.rep("\\195\\169", 130), "")`);
    expect(Buffer.byteLength(accented)).toBe(128);
    expect(accented).not.toContain("�");
    expect(s.run(`local t = M.fit(string.rep("\\195\\169", 130), ""); return #t % 2`)).toBe("0");
    expect(s.run(`return M.clean("a|cffff0000red|r\\nb")`)).toBe("a/cffff0000red/r b");
    s.run(`M.setLines("one\\n\\n" .. string.rep("x", 400))`);
    expect(s.run("return #CFG.lines .. ':' .. #CFG.lines[2]")).toBe("2:128");
  });

  it("rotates its lines every N hours and wraps around", () => {
    const s = setup();
    on(s, `M.setLines("Alpha\\nBravo\\nCharlie"); M.set("hours", 24)`);
    expect(s.run("return M.tick()")).toBe("due");
    expect(s.run("return #WRITES")).toBe("0"); // a timer never writes: the officer clicks
    expect(click(s)).toBe("written");
    expect(s.run("return WRITES[1]")).toBe("Alpha");
    s.run("ADVANCE(23 * 3600)");
    expect(s.run("return M.tick()")).toBe("same");
    s.run("ADVANCE(3600)");
    expect(click(s)).toBe("written");
    expect(s.run("return WRITES[2]")).toBe("Bravo");
    s.run("ADVANCE(24 * 3600)");
    click(s); s.run("ADVANCE(24 * 3600)"); click(s);
    expect(s.run("return WRITES[3] .. ':' .. WRITES[4]")).toBe("Charlie:Alpha");
  });

  it("pauses on a manual edit instead of overwriting it, until an officer resumes", () => {
    const s = setup();
    on(s, `M.setLines("Alpha\\nBravo"); M.set("hours", 1)`);
    click(s);
    s.run(`MOTD = "Raid Friday!"; ADVANCE(3 * 3600)`);
    expect(s.run("return M.tick()")).toBe("paused");
    expect(s.run("return #WRITES .. ':' .. MOTD")).toBe("1:Raid Friday!");
    expect(s.run("return SENT[#SENT]")).toBe("P");
    s.run("ADVANCE(3 * 3600)");
    expect(s.run("return M.tick()")).toBe("paused");
    s.run("M.resume()");
    expect(s.run("return M.tick()")).toBe("due");
    expect(click(s)).toBe("written");
    expect(s.run("return MOTD")).not.toBe("Raid Friday!");
  });

  it("never pauses before our first confirmed write, and counts a write only once the MOTD reads back", () => {
    const s = setup();
    on(s, `M.setLines("Alpha")`);
    expect(s.run("return M.tick()")).toBe("due");
    expect(s.run("return M.apply()")).toBe("ready");
    expect(s.run("return CFG.intended.text")).toBe("Alpha");
    // Enter not pressed yet: the roster still shows the old text. No pause, no "updated".
    s.run("ADVANCE(300)");
    expect(s.run("return M.tick()")).not.toBe("paused");
    expect(s.run("return M.statusText()")).not.toContain("updated");
    expect(s.run("return tostring(CFG.confirmed)")).toBe("nil");
    s.run("ENTER()");
    expect(s.run("return M.tick()")).toBe("written");
    expect(s.run("return CFG.confirmed")).toBe("Alpha");
    // From here on a different roster text is someone else's edit.
    s.run(`MOTD = "by hand"; ADVANCE(5)`);
    expect(s.run("return M.tick()")).toBe("paused");
  });

  it("lets only the lowest-named officer who can edit write, and takes over when it goes quiet", () => {
    const s = setup();
    on(s, `M.setLines("Alpha")`);
    s.run(`M.receive("H|1", "Aaron")`);
    expect(s.run("return M.tick()")).toBe("notwriter");
    expect(s.run("return #WRITES")).toBe("0");
    // An officer who cannot edit does not block the writer.
    s.run(`M.peers = {}; M.receive("H|0", "Aaron")`);
    expect(s.run("return M.tick()")).toBe("due");
    expect(s.run("return #WRITES")).toBe("0");
    // A later name does not win either.
    s.run(`M.peers = {}; M.receive("H|1", "Zed")`);
    expect(s.run("return tostring(M.isWriter(true))")).toBe("true");
    // The lowest name vanishes: after the hello window it no longer blocks.
    s.run(`M.peers = {}; M.receive("H|1", "Aaron")`);
    expect(s.run("return tostring(M.isWriter(true))")).toBe("false");
    s.run("ADVANCE(151)");
    expect(s.run("return tostring(M.isWriter(true))")).toBe("true");
  });

  it("waits briefly for other officers' hellos before the first write, and ignores non-officers", () => {
    const s = setup();
    on(s, `M.setLines("Alpha"); M.helloAt = nil`);
    expect(s.run("return M.tick()")).toBe("waiting");
    expect(s.run("return SENT[1]")).toBe("H|1");
    s.run(`M.receive("H|1", "Pleb")`); // not an officer: ignored
    s.run("ADVANCE(11)");
    expect(s.run("return M.tick()")).toBe("due"); // alone: the elected writer is this officer
    expect(s.run("return M.statusText()")).not.toContain("Another officer");
    s.run(`M.receive("P", "Pleb")`);
    expect(s.run("return tostring(CFG.paused == true)")).toBe("false");
  });

  it("adopts another officer's write so the rotation timer carries over", () => {
    const s = setup();
    on(s, `M.setLines("Alpha\\nBravo"); M.set("hours", 24); M.receive("H|1", "Aaron")`);
    s.run(`M.receive("W|2|" .. (EPOCH - 3600) .. "|Bravo", "Aaron"); MOTD = "Bravo"`);
    s.run(`M.peers = {}`);
    s.run("ADVANCE(22 * 3600)");
    expect(s.run("return M.tick() .. ':' .. #WRITES")).toBe("same:0");
    s.run("ADVANCE(3600)");
    expect(s.run("return M.tick()")).toBe("due");
    expect(click(s)).toBe("written");
    expect(s.run("return WRITES[1]")).toBe("Alpha");
  });

  it("fails quietly when the client cannot set the message or the rank cannot edit it", () => {
    const s = setup();
    on(s, `M.setLines("Alpha")`);
    s.run("CanEditMOTD = nil");
    expect(s.run("return M.tick()")).toBe("noapi");
    expect(s.run("return M.statusText()")).toContain("does not say");
    s.run(`CanEditMOTD = function() return CAN end; CAN = false`);
    expect(s.run("return M.tick()")).toBe("cannot");
    s.run("CAN = true; OFFICER = false");
    expect(s.run("return M.tick()")).toBe("notofficer");
    expect(s.run("return #WRITES")).toBe("0");
  });

  it("builds the next-raid message from the bot's raids, with the suffix, within the limit", () => {
    const s = setup();
    on(s, `M.set("mode", "event"); M.set("suffix", "Lie ton perso: Guilded Companion")`);
    s.run(`RAIDS = { { id = "1", title = "Hyjal", at = EPOCH + 86400 } }`);
    expect(s.run("return M.tick()")).toBe("due");
    s.run("M.apply(); ENTER()");
    const written = s.run("return WRITES[1]");
    expect(written).toMatch(/^Next raid: Hyjal \w+ \d+:\d\d - sign up on Discord! - Lie ton perso: Guilded Companion$/);
    expect(written.length).toBeLessThanOrEqual(128);
    // No raid known: falls back to the lines, or writes nothing.
    expect(s.run("return M.tick()")).toBe("written"); // read back from the roster
    s.run(`RAIDS = {}; CFG.confirmed = nil`);
    expect(s.run("return M.tick()")).toBe("empty");
  });

  it("never touches the chat box or any MOTD function, and only offers the copy box from a click", () => {
    const source = addonSource("Modules/GuildMotd.lua");
    const code = source.split(/\r?\n/).filter(line => !/^\s*--/.test(line)).join("\n");
    expect(code).not.toMatch(/GuildSetMOTD|SetMOTD|ChatFrame_OpenChat|DEFAULT_CHAT_FRAME|editBox|ChatEdit/);
    // Every call to motd.apply comes from a click handler.
    for (const line of source.split(/\r?\n/)) {
      if (/motd\.apply\(\)/.test(line) && !/function motd\.apply|^\s*--/.test(line)) expect(line, line).toMatch(/OnClick|newButton\(/);
    }
    const s = setup();
    on(s, `M.setLines("Alpha")`);
    s.run("for _ = 1, 20 do ADVANCE(3600); M.tick() end; M.receive('H|1', 'Zed')");
    expect(s.run("return #WRITES .. ':' .. tostring(CFG.intended)")).toBe("0:nil");
  });

  it("does not pause right after Turn on + Save with an empty message, nor from stale saved data", () => {
    const s = setup();
    s.run(`MOTD = ""`);
    on(s, `M.setLines("Alpha")`);
    expect(s.run("return M.tick()")).toBe("due");
    expect(s.run("return tostring(CFG.paused)")).toBe("false");
    // Saved data left by an earlier build: a "written" text that never reached the game.
    s.run(`DB.motd = { enabled = true, mode = "rotate", hours = 24, lines = { "Alpha" }, suffix = "", index = 0, lastWritten = "Test line one", paused = true }`);
    expect(s.run("return M.tick()")).toBe("due");
    expect(s.run("return tostring(DB.motd.paused)")).toBe("false");
  });

  it("answers the /guilded motd command for officers only", () => {
    const s = setup();
    s.run(`NS.commandHandlers.motd({ "add", "First", "line" }); NS.commandHandlers.motd({ "on" })`);
    expect(s.run("return CFG.lines[1] .. ':' .. tostring(CFG.enabled)")).toBe("First line:true");
    s.run("OFFICER = false; NS.commandHandlers.motd({ 'off' })");
    expect(s.run("return tostring(CFG.enabled)")).toBe("true");
  });
});

// Taint guard: WoW Forever refuses guild reads to addons in combat ("Guilded tried to call UNKNOWN()", 10 Nov 2026).
describe("GuildMotd.lua reads nothing from the guild in combat", () => {
  it("never calls GetGuildRosterMOTD or CanEditMOTD while in combat", () => {
    const s = setup();
    s.run(`COMBAT = true; CALLS = 0
      GetGuildRosterMOTD = function() CALLS = CALLS + 1; return MOTD end
      CanEditMOTD = function() CALLS = CALLS + 1; return true end
      CFG.enabled = true; CFG.confirmed = "old message"
      M.tick(); M.checkManualEdit(CFG); M.confirm(CFG)`);
    expect(s.run("return CALLS")).toBe("0");
    s.run("COMBAT = false; M.tick()");
    expect(Number(s.run("return CALLS"))).toBeGreaterThan(0);
  });
});
