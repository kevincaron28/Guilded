import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

// Track E4: "Get the companion" links and the weekly reminder.
let session: LuaSession | undefined;
afterEach(() => { session?.close(); session = undefined; });

function withLink(extra = ""): LuaSession {
  session = newLuaSession();
  session.run(String.raw`
    NOW = 1800000000
    time = function() return NOW end
    MSGS = {}
    DB = {}
    SETTINGS = {}
    NS = { getSettings = function() return SETTINGS end, getDb = function() return DB end, commandHandlers = {}, commandHelp = {},
           message = function(t) MSGS[#MSGS + 1] = t end, playerName = function() return "Ann" end,
           normalizeName = function(n) return (string.gsub(n, "%-.*$", "")) end }
    ${extra}
  `);
  session.load("Modules/CompanionLink.lua");
  return session;
}

describe("companion link and weekly reminder", () => {
  it("reminds a member with no companion file, then waits a week", () => {
    const s = withLink();
    expect(s.run(`return tostring(NS.companionLink.remind())`)).toBe("true");
    expect(s.run(`return MSGS[1]`)).toContain("guildedwow.com/companion");
    expect(s.run(`return tostring(NS.companionLink.remind())`)).toBe("false");
    s.run(`NOW = NOW + 6 * 86400`);
    expect(s.run(`return tostring(NS.companionLink.remind())`)).toBe("false");
    s.run(`NOW = NOW + 2 * 86400`);
    expect(s.run(`return tostring(NS.companionLink.remind())`)).toBe("true");
  });

  it("stays quiet when the player has a companion file, unless the officer bridge lists them", () => {
    const s = withLink(`GuildedStandings = { updatedAt = "2026-11-06T00:00:00Z" }`);
    expect(s.run(`return tostring(NS.companionLink.remind())`)).toBe("false");
    s.run(`DB.officerBridge = { snapshot = { needsCompanion = { "Ann-Realm" } } }`);
    expect(s.run(`return tostring(NS.companionLink.remind())`)).toBe("true");
  });

  it("is on by default and /guilded companion off turns it off", () => {
    const s = withLink();
    expect(s.run(`return tostring(NS.companionLink.enabled())`)).toBe("true");
    s.run(`NS.commandHandlers["companion"]({ "off" })`);
    expect(s.run(`return tostring(NS.companionLink.enabled())`)).toBe("false");
    expect(s.run(`return tostring(NS.companionLink.remind())`)).toBe("false");
    s.run(`NS.commandHandlers["companion"]({ "on" })`);
    expect(s.run(`return tostring(NS.companionLink.remind())`)).toBe("true");
  });

  it("says the three steps in the reminder and the command, with the install facts", () => {
    const s = withLink();
    s.run(`NS.companionLink.remind()`);
    let out = s.run(`return table.concat(MSGS, "|")`);
    expect(out).toContain("1) Download it");
    expect(out).toContain("2) Run the installer");
    expect(out).toContain("3) Keep it open");
    expect(out).toContain("Signing in with Discord is optional");
    s.run(`MSGS = {}; NS.commandHandlers["companion"]({})`);
    out = s.run(`return table.concat(MSGS, "|")`);
    expect(out).toContain("Microsoft Store");
    expect(out).toContain("1) Download it");
  });

  it("the bare command shows both links", () => {
    const s = withLink();
    s.run(`NS.commandHandlers["companion"]({})`);
    const out = s.run(`return table.concat(MSGS, "|")`);
    expect(out).toContain("guildedwow.com/companion/");
    expect(out).toContain("Guilded.Companion.Setup.exe");
  });
});

// Track L 14: "Linked to Discord as <name>" once after the companion's first sync.
describe("linked to Discord line", () => {
  it("says it once per name, from the line the companion writes", () => {
    const s = withLink(`GuildedLinkedAs = "Kev"`);
    expect(s.run(`return tostring(NS.companionLink.announceLinked())`)).toBe("true");
    expect(s.run(`return MSGS[1]`)).toContain("Linked to Discord as Kev");
    expect(s.run(`return tostring(NS.companionLink.announceLinked())`)).toBe("false");
    s.run(`GuildedLinkedAs = "Kev Two"`);
    expect(s.run(`return tostring(NS.companionLink.announceLinked())`)).toBe("true");
  });

  it("says it again at every login, not only the first (9.0.1)", () => {
    // An older version saved "already told" in the database and then never spoke again.
    const s = withLink(`GuildedLinkedAs = "Kev"; DB.linkedAnnouncedAs = "Kev"`);
    expect(s.run(`return tostring(NS.companionLink.announceLinked())`)).toBe("true");
    expect(s.run(`return MSGS[1]`)).toContain("Linked to Discord as Kev");
    expect(s.run(`return tostring(NS.companionLink.announceLinked())`)).toBe("false");
    s.close();
    const next = withLink(`GuildedLinkedAs = "Kev"`);
    expect(next.run(`return tostring(NS.companionLink.announceLinked())`)).toBe("true");
  });

  it("stays quiet without a linked name, and a linked PC is never reminded to get the companion", () => {
    const s = withLink(`GuildedLinkedAs = nil`);
    expect(s.run(`return tostring(NS.companionLink.announceLinked())`)).toBe("false");
    s.run(`GuildedLinkedAs = "Kev"`);
    expect(s.run(`return tostring(NS.companionLink.needed())`)).toBe("false");
    s.run(`GuildedLinkedAs = "a|cffff0000b"`);
    expect(s.run(`return NS.companionLink.linkedAs()`)).toBe("acffff0000b");
  });

  it("/guilded companion shows the linked line first", () => {
    const s = withLink(`GuildedLinkedAs = "Kev"`);
    s.run(`NS.commandHandlers["companion"]({})`);
    expect(s.run(`return MSGS[1]`)).toContain("Linked to Discord as Kev");
  });
});

// 9.1.4: the line is per character, from the map the companion writes for this PC's own characters.
describe("linked to Discord, per character", () => {
  const fresh = `GuildedLinkedMeta = { updatedAt = "2027-01-14T00:00:00Z", }`;
  const state = (s: LuaSession) => s.run(`local st = NS.companionLink.linkedState(); return st and (st.confirmed and ("linked:" .. st.name) or "reported") or "nil"`);

  it("says the Discord name only for the character being played", () => {
    const s = withLink(`GuildedLinked = { ann = { discord = "Kev", confirmed = true }, bob = { discord = "Kev", confirmed = true } }; ${fresh}`);
    expect(state(s)).toBe("linked:Kev");
    s.run(`NS.playerName = function() return "Zed" end`);
    expect(state(s)).toBe("nil");
    expect(s.run(`return tostring(NS.companionLink.announceLinked())`)).toBe("false");
  });

  it("says 'Reported, not confirmed' for a reported character and never shows a Discord name for it", () => {
    const s = withLink(`GuildedLinked = { ann = { confirmed = false } }; ${fresh}`);
    expect(state(s)).toBe("reported");
    expect(s.run(`return tostring(NS.companionLink.announceLinked())`)).toBe("true");
    expect(s.run(`return MSGS[1]`)).toBe("Reported, not confirmed");
    expect(s.run(`return tostring(NS.companionLink.linkedAs())`)).toBe("nil");
    expect(s.run(`return tostring(NS.companionLink.needed())`)).toBe("false");
  });

  it("matches a Forever full name in any letter case", () => {
    const s = withLink(`GuildedLinked = { ["meo gratton"] = { discord = "Kev", confirmed = true } }; ${fresh}; NS.playerName = function() return "Meo  Gratton" end`);
    expect(state(s)).toBe("linked:Kev");
  });

  it("ignores a map older than 14 days, or one with no timestamp", () => {
    const old = withLink(`GuildedLinked = { ann = { discord = "Kev", confirmed = true } }; GuildedLinkedMeta = { updatedAt = "2026-12-20T00:00:00Z", }`);
    expect(state(old)).toBe("nil");
    old.close();
    const undated = withLink(`GuildedLinked = { ann = { discord = "Kev", confirmed = true } }`);
    expect(state(undated)).toBe("nil");
  });

  it("reads the old PC-wide name only when there is no map, and never for a character missing from a map", () => {
    const legacy = withLink(`GuildedLinkedAs = "Kev"`);
    expect(state(legacy)).toBe("linked:Kev");
    legacy.close();
    const mapped = withLink(`GuildedLinkedAs = "Kev"; GuildedLinked = { bob = { discord = "Kev", confirmed = true } }; ${fresh}`);
    expect(state(mapped)).toBe("nil");
    mapped.close();
    const empty = withLink(`GuildedLinkedAs = "Kev"; GuildedLinked = {}; ${fresh}`);
    expect(state(empty)).toBe("nil");
  });

  it("an unsigned companion's old name is never shown, but its reported map is", () => {
    const s = withLink(`GuildedCompanion = { mode = "device" }; GuildedLinkedAs = "Meo Gratton"`);
    expect(state(s)).toBe("nil");
    s.run(`GuildedLinked = { ann = { confirmed = false } }; ${fresh}`);
    expect(state(s)).toBe("reported");
  });

  it("/guilded companion shows the reported line too", () => {
    const s = withLink(`GuildedLinked = { ann = { confirmed = false } }; ${fresh}`);
    s.run(`NS.commandHandlers["companion"]({})`);
    expect(s.run(`return MSGS[1]`)).toBe("Reported, not confirmed");
  });
});
