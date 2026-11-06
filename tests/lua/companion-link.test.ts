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
    expect(s.run(`return MSGS[1]`)).toContain("guilded.kcaron.top/companion");
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

  it("the bare command shows both links", () => {
    const s = withLink();
    s.run(`NS.commandHandlers["companion"]({})`);
    const out = s.run(`return table.concat(MSGS, "|")`);
    expect(out).toContain("guilded.kcaron.top/companion/");
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
