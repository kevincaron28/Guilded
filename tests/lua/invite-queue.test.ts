import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

let session: LuaSession | undefined;
afterEach(() => { session?.close(); session = undefined; });

function withQueue(officer = true): LuaSession {
  session = newLuaSession();
  session.run(String.raw`
    DB = {}
    SENT = {}
    CAN = true
    ROSTER = { "Zed Zealot-Realm" }
    time = function() return 5000 end
    function CanGuildInvite() return CAN end
    function GuildInvite(name) SENT[#SENT + 1] = name end
    function GetNumGuildMembers() return #ROSTER end
    function GetGuildRosterInfo(i) return ROSTER[i] end
    GuildedInvites = { fetchedAt = "x", names = {
      { name = "Amy Archer", at = "2026-11-06T10:00:00Z" },
      { name = "Zed Zealot", at = "2026-11-06T10:05:00Z" },
      { name = "Bob Brewer", at = "2026-11-06T10:10:00Z" } } }
    NS = {
      isOfficer = function() return ${officer} end,
      getDb = function() return DB end,
      message = function(text) CHAT = CHAT or {}; CHAT[#CHAT + 1] = text end,
      commandHandlers = {}, commandHelp = {}
    }
  `);
  session.load("Modules/InviteQueue.lua");
  return session;
}

describe("InviteQueue.lua", () => {
  it("lists the waiting names and hides those already in the guild", () => {
    const s = withQueue();
    expect(s.run(String.raw`local l = NS.inviteQueue.list(); return #l .. ":" .. l[1].name .. "," .. l[2].name`)).toBe("2:Amy Archer,Bob Brewer");
  });
  it("sends one guild invite per call, with the full two-word name, and remembers it", () => {
    const s = withQueue();
    expect(s.run(String.raw`local ok = NS.inviteQueue.invite("Amy Archer"); return tostring(ok) .. ":" .. #SENT .. ":" .. SENT[1]`)).toBe("true:1:Amy Archer");
    expect(s.run(String.raw`return tostring(NS.inviteQueue.list()[1].sent ~= nil)`)).toBe("true");
  });
  it("refuses when the rank cannot invite, for odd names, and for non-officers", () => {
    const s = withQueue();
    s.run("CAN = false");
    expect(s.run(String.raw`return tostring((NS.inviteQueue.invite("Amy Archer")))`)).toBe("false");
    s.run("CAN = true");
    expect(s.run(String.raw`return tostring((NS.inviteQueue.invite("Amy\nArcher")))`)).toBe("false");
    expect(s.run("return #SENT")).toBe("0");
    const plain = withQueue(false);
    expect(plain.run(String.raw`return tostring((NS.inviteQueue.invite("Amy Archer")))`)).toBe("false");
    expect(plain.run(String.raw`return tostring((NS.inviteQueue.list()))`)).toBe("nil");
    expect(plain.run("return #SENT")).toBe("0");
  });
  it("prints a copyable ginvite list and a one-line reminder", () => {
    const s = withQueue();
    expect(s.run("return NS.inviteQueue.text()")).toBe("/ginvite Amy Archer\n/ginvite Bob Brewer");
    s.run("NS.inviteQueue.notify()");
    expect(s.run("return CHAT[1]")).toContain("2 waiting for a guild invite");
    s.run("NS.inviteQueue.notify()");
    expect(s.run("return #CHAT")).toBe("1");
  });
});
