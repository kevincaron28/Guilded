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
    OPENED = {}
    -- The Invite buttons (frames inviteButton gave setInvite/inviteLine to), in row order.
    function INVITES()
      local t = {}
      for _, f in ipairs(FRAMES) do if rawget(f, "inviteLine") then t[#t + 1] = f end end
      return t
    end
    function ChatFrame_OpenChat(line) OPENED[#OPENED + 1] = line end
    local make = CreateFrame
    CreateFrame = function(kind, name, parent, template)
      local f = make(kind, name, parent, template)
      f.template = template; f.TitleText = { SetText = function() end }
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
  // The Invite buttons, in row order (every frame that has an inviteLine; hidden rows have none).
  const lines = (lua: LuaSession) => lua.run(String.raw`local t = {} for _, f in ipairs(INVITES()) do if f.inviteLine() then t[#t + 1] = f.inviteLine() end end return table.concat(t, "|")`);
  const click = (lua: LuaSession, index: number) => lua.run(String.raw`local f = INVITES()[${index}] f.scripts.OnClick(f)`);

  it("makes each row a plain button that holds /ginvite with the full two-word name, never the invite API", () => {
    const s = withQueue();
    s.run("NS.inviteQueue.open()");
    expect(lines(s)).toBe("/ginvite Amy Archer|/ginvite Bob Brewer");
    expect(s.run(String.raw`local n, bad = 0, 0 for _, f in ipairs(INVITES()) do n = n + 1 if f.template ~= "UIPanelButtonTemplate" or rawget(f, "attrs") then bad = bad + 1 end end return n .. ":" .. bad`)).toBe("12:0");
    expect(s.run(String.raw`local t = {} for _, f in ipairs(INVITES()) do t[#t + 1] = tostring(f.inviteName()) end return table.concat(t, "|", 1, 2)`)).toBe("Amy Archer|Bob Brewer");
    // Nothing is put in the chat box and nothing sent until the officer clicks.
    expect(s.run("return #OPENED")).toBe("0");
    expect(s.run("return #SENT")).toBe("0");
  });
  it("puts the line in the chat box on a click, marks the row invited and says to press Enter", () => {
    const s = withQueue();
    s.run("NS.inviteQueue.open()");
    click(s, 1);
    expect(s.run("return #OPENED .. OPENED[1]")).toBe("1/ginvite Amy Archer");
    expect(s.run("return CHAT[#CHAT]")).toBe("/ginvite Amy Archer is in your chat box: press Enter to send it.");
    expect(s.run("return #CHAT")).toBe("1");
    expect(s.run(String.raw`return tostring(NS.inviteQueue.list()[1].sent ~= nil)`)).toBe("true");
    expect(s.run("return #SENT")).toBe("0");
  });
  it("says which line to type when the chat box cannot be opened", () => {
    const s = withQueue();
    s.run("ChatFrame_OpenChat = nil; NS.inviteQueue.open()");
    click(s, 2);
    expect(s.run("return CHAT[#CHAT]")).toBe("Type /ginvite Bob Brewer to invite them.");
    expect(s.run("return #CHAT")).toBe("1");
    // The click is still remembered, and the invite API is still never called.
    expect(s.run(String.raw`return tostring(NS.inviteQueue.list()[2].sent ~= nil)`)).toBe("true");
    expect(s.run("return #SENT")).toBe("0");
  });
  it("takes the invite from the click in combat and refreshes the rows afterwards", () => {
    const s = withQueue();
    s.run("NS.inviteQueue.open()");
    s.run("IN_COMBAT = true");
    // The button is plain (no secure frame): a click in combat still fills the chat box.
    click(s, 1);
    expect(s.run("return OPENED[1]")).toBe("/ginvite Amy Archer");
    s.run(String.raw`GuildedInvites.names[1].name = "Cat Carter"`);
    s.run("NS.inviteQueue.refresh()");
    expect(lines(s)).toBe("/ginvite Amy Archer|/ginvite Bob Brewer");
    s.run(String.raw`IN_COMBAT = false; fire_event("PLAYER_REGEN_ENABLED")`);
    expect(lines(s)).toBe("/ginvite Cat Carter|/ginvite Bob Brewer");
    click(s, 1);
    expect(s.run("return OPENED[#OPENED]")).toBe("/ginvite Cat Carter");
  });
  it("builds the window after combat when opened in combat", () => {
    const s = withQueue();
    s.run("IN_COMBAT = true; NS.inviteQueue.open()");
    expect(s.run("return #INVITES()")).toBe("0");
    s.run(String.raw`IN_COMBAT = false; fire_event("PLAYER_REGEN_ENABLED")`);
    expect(lines(s)).toBe("/ginvite Amy Archer|/ginvite Bob Brewer");
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
