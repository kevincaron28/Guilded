import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";
import { foldKey } from "../../src/services/invite-queue.js";

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
    COPIED = {}; TITLES = {}; OPENED = {}
    -- The Invite buttons (frames inviteButton gave setInvite/inviteLine to), in row order.
    function INVITES()
      local t = {}
      for _, f in ipairs(FRAMES) do if rawget(f, "inviteLine") then t[#t + 1] = f end end
      return t
    end
    -- Spy: an Invite click must never touch the game chat box.
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
      showCopyText = function(text, title) COPIED[#COPIED + 1] = text; TITLES[#TITLES + 1] = title end,
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
    // Nothing is shown or sent until the officer clicks.
    expect(s.run("return #COPIED .. #OPENED")).toBe("00");
    expect(s.run("return #SENT")).toBe("0");
  });
  it("shows the line in the copy box on a click, marks the row invited and says to paste it and press Enter", () => {
    const s = withQueue();
    s.run("NS.inviteQueue.open()");
    click(s, 1);
    expect(s.run("return #COPIED .. COPIED[1]")).toBe("1/ginvite Amy Archer");
    expect(s.run("return TITLES[1]")).toBe("Copy with Ctrl+C, then paste in chat");
    expect(s.run("return #OPENED")).toBe("0");
    expect(s.run("return CHAT[#CHAT]")).toBe("Copy /ginvite Amy Archer (Ctrl+C), paste it in your chat box (Ctrl+V) and press Enter.");
    expect(s.run("return #CHAT")).toBe("1");
    expect(s.run(String.raw`return tostring(NS.inviteQueue.list()[1].sent ~= nil)`)).toBe("true");
    expect(s.run("return #SENT")).toBe("0");
  });
  it("says which line to type when there is no copy box", () => {
    const s = withQueue();
    s.run("NS.showCopyText = nil; NS.inviteQueue.open()");
    click(s, 2);
    expect(s.run("return CHAT[#CHAT]")).toBe("Type /ginvite Bob Brewer to invite them.");
    expect(s.run("return #OPENED")).toBe("0");
    expect(s.run("return #CHAT")).toBe("1");
    // The click is still remembered, and the invite API is still never called.
    expect(s.run(String.raw`return tostring(NS.inviteQueue.list()[2].sent ~= nil)`)).toBe("true");
    expect(s.run("return #SENT")).toBe("0");
  });
  it("takes the invite from the click in combat and refreshes the rows afterwards", () => {
    const s = withQueue();
    s.run("NS.inviteQueue.open()");
    s.run("IN_COMBAT = true");
    // The button is plain (no secure frame): a click in combat still shows the copy box.
    click(s, 1);
    expect(s.run("return COPIED[1]")).toBe("/ginvite Amy Archer");
    s.run(String.raw`GuildedInvites.names[1].name = "Cat Carter"`);
    s.run("NS.inviteQueue.refresh()");
    expect(lines(s)).toBe("/ginvite Amy Archer|/ginvite Bob Brewer");
    s.run(String.raw`IN_COMBAT = false; fire_event("PLAYER_REGEN_ENABLED")`);
    expect(lines(s)).toBe("/ginvite Cat Carter|/ginvite Bob Brewer");
    click(s, 1);
    expect(s.run("return COPIED[#COPIED]")).toBe("/ginvite Cat Carter");
    expect(s.run("return #OPENED")).toBe("0");
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
  it("matches a name in the guild with accents and capitals folded like the bot does", () => {
    const s = withQueue();
    s.run(String.raw`ROSTER = { "\195\137lise Dupont-Realm", "Zo\195\171 Quinn-Realm" }`);
    s.run(String.raw`GuildedInvites.names = { { name = "Elise Dupont", at = "a" }, { name = "\195\169lise Dupont", at = "b" }, { name = "Zoe Quinn", at = "c" }, { name = "Amy Archer", at = "d" } }`);
    expect(s.run(String.raw`local t = {} for _, l in ipairs(NS.inviteQueue.list()) do t[#t + 1] = l.name end return table.concat(t, "|")`)).toBe("Amy Archer");
  });
  it("folds every letter exactly like the bot's foldKey (shared table, Latin-1 and Latin Extended-A)", () => {
    const s = withQueue();
    const mismatches: string[] = [];
    for (let cp = 0xc0; cp <= 0x17f; cp++) {
      if (cp === 0xd7 || cp === 0xf7) continue;
      const letter = String.fromCodePoint(cp);
      const name = `Ab${letter}Cd Xy`;
      const escaped = [...Buffer.from(name, "utf8")].map((b) => `\\${b}`).join("");
      const lua = s.run(`return NS.inviteQueue.foldKey("${escaped}")`);
      // The bot's key for the same name (letters outside the shared set stay as they are on both sides).
      if (lua !== foldKey(name)) mismatches.push(`${letter} U+${cp.toString(16)}: lua ${lua} bot ${foldKey(name)}`);
    }
    expect(mismatches).toEqual([]);
  });
  it("prints a copyable ginvite list and a one-line reminder", () => {
    const s = withQueue();
    expect(s.run("return NS.inviteQueue.text()")).toBe("/ginvite Amy Archer\n/ginvite Bob Brewer");
    s.run("NS.inviteQueue.notify()");
    expect(s.run("return CHAT[1]")).toContain("2 waiting for a guild invite");
    s.run("NS.inviteQueue.notify()");
    expect(s.run("return #CHAT")).toBe("1");
  });
  const say = (lua: LuaSession, text: string) => lua.run(`NS.inviteQueue.onSystemMessage(${JSON.stringify(text)})`);
  const labels = (lua: LuaSession) => lua.run(String.raw`local t = {} for _, l in ipairs(NS.inviteQueue.list()) do t[#t + 1] = l.name .. "=" .. tostring(l.state) end return table.concat(t, "|")`);

  it("shows the game's answer on the row and removes a row that joined", () => {
    const s = withQueue();
    s.run("NS.inviteQueue.open()");
    click(s, 1); click(s, 2);
    say(s, "Player Amy Archer not found.");
    say(s, "Bob Brewer is already in a guild.");
    expect(labels(s)).toBe("Amy Archer=notfound|Bob Brewer=inguild");
    say(s, "Bob Brewer declines your guild invitation.");
    expect(labels(s)).toBe("Amy Archer=notfound|Bob Brewer=declined");
    say(s, "Bob Brewer has joined the guild.");
    expect(labels(s)).toBe("Amy Archer=notfound");
    // A name the officer never sent from the panel is ignored.
    say(s, "Player Zoe Zed not found.");
    expect(labels(s)).toBe("Amy Archer=notfound");
  });
  it("offers Remove on a not-found row, never lists it for sending, and shows it again only after a repost", () => {
    const s = withQueue();
    s.run("NS.inviteQueue.open()");
    click(s, 1);
    say(s, "Player Amy Archer not found.");
    expect(s.run("return NS.inviteQueue.text()")).toBe("/ginvite Bob Brewer");
    expect(s.run(String.raw`return tostring(INVITES()[1].shown)`)).not.toBe("true");
    s.run(`NS.inviteQueue.remove("Amy Archer")`);
    expect(labels(s)).toBe("Bob Brewer=nil");
    s.run(String.raw`GuildedInvites.names[1].at = "2026-11-10T12:00:00Z"`);
    expect(labels(s)).toBe("Amy Archer=nil|Bob Brewer=nil");
  });
  it("highlights the row the copy box refers to and names it in the header", () => {
    const s = withQueue();
    s.run("NS.inviteQueue.open()");
    click(s, 2);
    expect(s.run("return NS.inviteQueue.selected")).toBe("bob brewer");
    expect(s.run(String.raw`local f = FRAMES[1] return tostring(NS.inviteQueue.markInvited("Bob Brewer"))`)).toBe("true");
    expect(s.run(String.raw`local _, m = NS.inviteQueue.markInvited("Bob Brewer") return m`)).toBe("Copy /ginvite Bob Brewer for the highlighted row (Ctrl+C), paste it in your chat box (Ctrl+V) and press Enter.");
  });
});
