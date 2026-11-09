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
    function C_GuildInfo_Invite() end
    IN_COMBAT = false
    CLOCK = 0
    function InCombatLockdown() return IN_COMBAT end
    function GetTime() CLOCK = CLOCK + 1; return CLOCK end
    SECURE = {}
    local make = CreateFrame
    CreateFrame = function(kind, name, parent, template)
      local f = make(kind, name, parent, template)
      f.template = template; f.attrs = {}; f.TitleText = { SetText = function() end }
      f.SetAttribute = function(self, k, v) self.attrs[k] = v end
      if type(template) == "string" and template:find("SecureActionButtonTemplate") then SECURE[#SECURE + 1] = f end
      return f
    end
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
  // The real shared helpers on a scratch namespace (ns.util.inviteButton), so NS keeps its stubs.
  session.run("UTILNS = {}");
  session.load("Util.lua", "UTILNS");
  session.run("NS.util = UTILNS.util");
  session.load("Modules/InviteQueue.lua");
  return session;
}

describe("InviteQueue.lua", () => {
  it("lists the waiting names and hides those already in the guild", () => {
    const s = withQueue();
    expect(s.run(String.raw`local l = NS.inviteQueue.list(); return #l .. ":" .. l[1].name .. "," .. l[2].name`)).toBe("2:Amy Archer,Bob Brewer");
  });
  const macros = (lua: LuaSession) => lua.run(String.raw`local t = {} for _, f in ipairs(SECURE) do if f.attrs.macrotext and f.attrs.macrotext ~= "" then t[#t + 1] = f.attrs.macrotext end end return table.concat(t, "|")`);

  it("makes each row a secure button that runs /ginvite with the full two-word name, never the invite API", () => {
    const s = withQueue();
    s.run("NS.inviteQueue.open()");
    expect(macros(s)).toBe("/ginvite Amy Archer|/ginvite Bob Brewer");
    expect(s.run(String.raw`local ok = true for _, f in ipairs(SECURE) do if f.attrs.type ~= "macro" then ok = false end end return tostring(ok) .. #SECURE`)).toBe("true12");
    expect(s.run("return #SENT")).toBe("0");
  });
  it("marks the row invited after the click and says what was sent, not that it worked", () => {
    const s = withQueue();
    s.run("NS.inviteQueue.open()");
    s.run(String.raw`SECURE[1].scripts.PostClick(SECURE[1], "LeftButton", false)`);
    expect(s.run("return CHAT[#CHAT]")).toBe("Sent /ginvite Amy Archer. The game's own message tells you if it did not work.");
    expect(s.run("return CHAT[#CHAT]")).not.toContain("Invite sent");
    expect(s.run(String.raw`return tostring(NS.inviteQueue.list()[1].sent ~= nil)`)).toBe("true");
    expect(s.run("return #SENT")).toBe("0");
  });
  it("does not touch the macros in combat and refreshes them afterwards", () => {
    const s = withQueue();
    s.run("NS.inviteQueue.open()");
    s.run(String.raw`IN_COMBAT = true; GuildedInvites.names[1].name = "Cat Carter"`);
    s.run("NS.inviteQueue.refresh()");
    expect(macros(s)).toBe("/ginvite Amy Archer|/ginvite Bob Brewer");
    s.run(String.raw`IN_COMBAT = false; fire_event("PLAYER_REGEN_ENABLED")`);
    expect(macros(s)).toBe("/ginvite Cat Carter|/ginvite Bob Brewer");
  });
  it("builds the window after combat when opened in combat", () => {
    const s = withQueue();
    s.run("IN_COMBAT = true; NS.inviteQueue.open()");
    expect(s.run("return #SECURE")).toBe("0");
    s.run(String.raw`IN_COMBAT = false; fire_event("PLAYER_REGEN_ENABLED")`);
    expect(macros(s)).toBe("/ginvite Amy Archer|/ginvite Bob Brewer");
  });
  it("refuses when the rank cannot invite and for non-officers", () => {
    const s = withQueue();
    expect(s.run(String.raw`return tostring((NS.inviteQueue.canInvite()))`)).toBe("true");
    s.run("CAN = false");
    expect(s.run(String.raw`return tostring((NS.inviteQueue.canInvite()))`)).toBe("false");
    expect(s.run(String.raw`return tostring((NS.inviteQueue.markInvited("Amy\nArcher")))`)).toBe("false");
    const plain = withQueue(false);
    expect(plain.run(String.raw`return tostring((NS.inviteQueue.canInvite()))`)).toBe("false");
    expect(plain.run(String.raw`return tostring((NS.inviteQueue.list()))`)).toBe("nil");
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
