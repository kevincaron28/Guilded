import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

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
    function GuildSetMOTD(text) WRITES[#WRITES + 1] = text; MOTD = text end
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
    expect(s.run("return M.tick()")).toBe("written");
    expect(s.run("return WRITES[1]")).toBe("Alpha");
    s.run("ADVANCE(23 * 3600)");
    expect(s.run("return M.tick()")).toBe("same");
    s.run("ADVANCE(3600)");
    expect(s.run("return M.tick() .. ':' .. WRITES[2]")).toBe("written:Bravo");
    s.run("ADVANCE(24 * 3600)");
    s.run("M.tick(); ADVANCE(24 * 3600); M.tick()");
    expect(s.run("return WRITES[3] .. ':' .. WRITES[4]")).toBe("Charlie:Alpha");
  });

  it("pauses on a manual edit instead of overwriting it, until an officer resumes", () => {
    const s = setup();
    on(s, `M.setLines("Alpha\\nBravo"); M.set("hours", 1)`);
    s.run("M.tick()");
    s.run(`MOTD = "Raid Friday!"; ADVANCE(3 * 3600)`);
    expect(s.run("return M.tick()")).toBe("paused");
    expect(s.run("return #WRITES .. ':' .. MOTD")).toBe("1:Raid Friday!");
    expect(s.run("return SENT[#SENT]")).toBe("P");
    s.run("ADVANCE(3 * 3600)");
    expect(s.run("return M.tick()")).toBe("paused");
    s.run("M.resume()");
    expect(s.run("return M.tick()")).toBe("written");
    expect(s.run("return MOTD")).not.toBe("Raid Friday!");
  });

  it("does not mistake the roster's stale text right after our own write for a manual edit", () => {
    const s = setup();
    on(s, `M.setLines("Alpha")`);
    s.run(`GuildSetMOTD = function(text) WRITES[#WRITES + 1] = text end`); // roster still shows "old message"
    s.run("M.tick(); ADVANCE(5)");
    expect(s.run("return M.tick()")).not.toBe("paused");
    s.run(`ADVANCE(120)`);
    expect(s.run("return M.tick()")).toBe("paused"); // later the same mismatch means someone else changed it
  });

  it("lets only the lowest-named officer who can edit write, and takes over when it goes quiet", () => {
    const s = setup();
    on(s, `M.setLines("Alpha")`);
    s.run(`M.receive("H|1", "Aaron")`);
    expect(s.run("return M.tick()")).toBe("notwriter");
    expect(s.run("return #WRITES")).toBe("0");
    // An officer who cannot edit does not block the writer.
    s.run(`M.peers = {}; M.receive("H|0", "Aaron")`);
    expect(s.run("return M.tick()")).toBe("written");
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
    expect(s.run("return M.tick()")).toBe("notwriter");
    expect(s.run("return SENT[1]")).toBe("H|1");
    s.run(`M.receive("H|1", "Pleb")`); // not an officer: ignored
    s.run("ADVANCE(11)");
    expect(s.run("return M.tick()")).toBe("written");
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
    expect(s.run("return M.tick() .. ':' .. WRITES[1]")).toBe("written:Alpha");
  });

  it("fails quietly when the client cannot set the message or the rank cannot edit it", () => {
    const s = setup();
    on(s, `M.setLines("Alpha")`);
    s.run("GuildSetMOTD = nil");
    expect(s.run("return M.tick()")).toBe("noapi");
    expect(s.run("return M.statusText()")).toContain("cannot change the guild message");
    s.run(`GuildSetMOTD = function(t) WRITES[#WRITES + 1] = t end; CAN = false`);
    expect(s.run("return M.tick()")).toBe("cannot");
    s.run("CAN = true; OFFICER = false");
    expect(s.run("return M.tick()")).toBe("notofficer");
    s.run("OFFICER = true; COMBAT = true");
    expect(s.run("return M.tick()")).toBe("combat");
    expect(s.run("return #WRITES")).toBe("0");
  });

  it("builds the next-raid message from the bot's raids, with the suffix, within the limit", () => {
    const s = setup();
    on(s, `M.set("mode", "event"); M.set("suffix", "Lie ton perso: Guilded Companion")`);
    s.run(`RAIDS = { { id = "1", title = "Hyjal", at = EPOCH + 86400 } }`);
    expect(s.run("return M.tick()")).toBe("written");
    const written = s.run("return WRITES[1]");
    expect(written).toMatch(/^Next raid: Hyjal \w+ \d+:\d\d - sign up on Discord! - Lie ton perso: Guilded Companion$/);
    expect(written.length).toBeLessThanOrEqual(128);
    // No raid known: falls back to the lines, or writes nothing.
    s.run(`RAIDS = {}; CFG.lastWritten = nil`);
    expect(s.run("return M.tick()")).toBe("empty");
  });

  it("answers the /guilded motd command for officers only", () => {
    const s = setup();
    s.run(`NS.commandHandlers.motd({ "add", "First", "line" }); NS.commandHandlers.motd({ "on" })`);
    expect(s.run("return CFG.lines[1] .. ':' .. tostring(CFG.enabled)")).toBe("First line:true");
    s.run("OFFICER = false; NS.commandHandlers.motd({ 'off' })");
    expect(s.run("return tostring(CFG.enabled)")).toBe("true");
  });
});
