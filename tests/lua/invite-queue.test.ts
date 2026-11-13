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
    ROSTER = { "Zed Zealot-Realm", "Dan Dorn-Realm" }
    time = function() return CLOCKS end
    function GetServerTime() return CLOCKS end
    function CanGuildInvite() return CAN end
    function GuildInvite(name) SENT[#SENT + 1] = name end
    function C_GuildInfo_Invite() end
    IN_COMBAT = false
    CLOCK = 0
    function InCombatLockdown() return IN_COMBAT end
    function GetTime() CLOCK = CLOCK + 1; return CLOCK end
    COPIED = {}; TITLES = {}; OPENED = {}; FS = {}; TEX = {}; CLOCKS = 5000
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
      local function region(list)
        return function()
          local r = setmetatable({}, { __index = function(t, k)
            if k == "SetText" then return function(self, v) rawset(self, "text", v) end end
            if k == "Show" then return function(self) rawset(self, "shown", true) end end
            if k == "Hide" then return function(self) rawset(self, "shown", false) end end
            return function() end
          end })
          list[#list + 1] = r
          return r
        end
      end
      f.CreateFontString = region(FS); f.CreateTexture = region(TEX)
      f.SetText = function(self, v) rawset(self, "text", v) end; FS[#FS + 1] = f
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
    expect(s.run(String.raw`local n, bad = 0, 0 for _, f in ipairs(INVITES()) do n = n + 1 if f.template ~= "UIPanelButtonTemplate" or rawget(f, "attrs") then bad = bad + 1 end end return n .. ":" .. bad`)).toBe("26:0");
    expect(s.run(String.raw`local t = {} for _, f in ipairs(INVITES()) do t[#t + 1] = tostring(f.inviteName()) end return table.concat(t, "|", 1, 2)`)).toBe("Amy Archer|Bob Brewer");
    // Nothing is shown or sent until the officer clicks.
    expect(s.run("return #COPIED .. #OPENED")).toBe("00");
    expect(s.run("return #SENT")).toBe("0");
  });
  it("shows the line in the copy box on a click, moves the row to the invited section and says to paste it and press Enter", () => {
    const s = withQueue();
    s.run("NS.inviteQueue.open()");
    click(s, 1);
    expect(s.run("return #COPIED .. COPIED[1]")).toBe("1/ginvite Amy Archer");
    expect(s.run("return TITLES[1]")).toBe("Copy with Ctrl+C, then paste in chat");
    expect(s.run("return #OPENED")).toBe("0");
    expect(s.run("return CHAT[#CHAT]")).toBe("Copy /ginvite Amy Archer (Ctrl+C), paste it in your chat box (Ctrl+V) and press Enter.");
    expect(s.run("return #CHAT")).toBe("1");
    expect(s.run(String.raw`return tostring(NS.inviteQueue.sections().invited[1].sent ~= nil)`)).toBe("true");
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
    expect(s.run(String.raw`return tostring(NS.inviteQueue.sections().invited[1].name)`)).toBe("Bob Brewer");
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
  it("cuts only a realm from roster names, never a hyphenated surname (same rule as the bot)", () => {
    const names = (lua: LuaSession) => lua.run(String.raw`local t = {} for _, l in ipairs(NS.inviteQueue.list()) do t[#t + 1] = l.name end return table.concat(t, "|")`);
    const s = withQueue();
    s.run(String.raw`GuildedInvites.names = { { name = "Anna Smith", at = "a" }, { name = "Anna Smith-Forever", at = "b" }, { name = "Cat Carter", at = "c" } }`);
    // Anna Smith-Jones is a surname: the request for Anna Smith stays
    s.run(String.raw`ROSTER = { "Anna Smith-Jones" }`);
    expect(names(s)).toBe("Anna Smith|Anna Smith-Forever|Cat Carter");
    // a real realm (carried by most names) is cut, on the roster and on a request typed with it
    s.run(String.raw`ROSTER = { "Anna Smith-Forever", "Bob Brewer-Forever", "Zed Zealot-Forever" }`);
    expect(names(s)).toBe("Cat Carter");
    s.run(String.raw`ROSTER = { "Anna Smith", "Bob Brewer-Forever", "Cat Zed-Forever" }`);
    expect(names(s)).toBe("Cat Carter");
    expect(s.run(String.raw`local a, b = NS.inviteQueue.splitRealm("anna smith-jones") return a .. "|" .. tostring(b)`)).toBe("anna smith|jones");
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
  it("answers Officers only to /guilded invites for a non-officer, and opens nothing", () => {
    const plain = withQueue(false);
    plain.run(String.raw`CHAT = {}; NS.commandHandlers.invites({}); NS.commandHandlers.invites({ "list" })`);
    expect(plain.run("return table.concat(CHAT, '|')")).toBe("Officers only.|Officers only.");
    expect(plain.run("return #COPIED")).toBe("0");
    const officer = withQueue();
    officer.run(String.raw`CHAT = {}; NS.commandHandlers.invites({ "list" })`);
    expect(officer.run("return #COPIED")).toBe("1");
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
  const labels = (lua: LuaSession) => lua.run(String.raw`local sec = NS.inviteQueue.sections() local t = {} for _, g in ipairs({ "todo", "invited", "handled" }) do for _, l in ipairs(sec[g]) do t[#t + 1] = g .. ":" .. l.name .. "=" .. tostring(l.state) end end return table.concat(t, "|")`);

  it("shows the game's answer on the row and removes a row that joined", () => {
    const s = withQueue();
    s.run("NS.inviteQueue.open()");
    click(s, 1); click(s, 1); // each click moves the row out of the main list
    say(s, "Player Amy Archer not found.");
    say(s, "Bob Brewer is already in a guild.");
    // Not found stays in the main list (with Remove); another guild's member is handled and out of the default view.
    expect(labels(s)).toBe("todo:Amy Archer=notfound|handled:Bob Brewer=inguild");
    say(s, "Bob Brewer declines your guild invitation.");
    // A declined invitation stays in the invited section (with Invite again): the officer may be asked to try again.
    expect(labels(s)).toBe("todo:Amy Archer=notfound|invited:Bob Brewer=declined");
    say(s, "Bob Brewer has joined the guild.");
    expect(labels(s)).toBe("todo:Amy Archer=notfound");
    // A name the officer never sent from the panel is ignored.
    say(s, "Player Zoe Zed not found.");
    expect(labels(s)).toBe("todo:Amy Archer=notfound");
  });
  it("finds the mark of a request posted with its realm: the click is saved without the realm, the game's reply may carry it", () => {
    const s = withQueue();
    s.run(String.raw`GuildedInvites.names = { { name = "Anna Smith-Realm", at = "a" } }`);
    s.run("NS.inviteQueue.open()");
    click(s, 1);
    expect(s.run(String.raw`local sec = NS.inviteQueue.sections() return #sec.todo .. ":" .. #sec.invited .. ":" .. tostring(sec.invited[1] and sec.invited[1].copied)`)).toBe("0:1:true");
    say(s, "You have invited Anna Smith-Realm to join your guild.");
    expect(labels(s)).toBe("invited:Anna Smith-Realm=sent");
    say(s, "Anna Smith declines your guild invitation.");
    expect(labels(s)).toBe("invited:Anna Smith-Realm=declined");
    // Remove clears both forms of the mark.
    s.run(String.raw`NS.inviteQueue.remove("Anna Smith-Realm")`);
    expect(labels(s)).toBe("");
  });

  it("matches the game's reply to a hyphenated surname instead of cutting it at the first hyphen", () => {
    const s = withQueue();
    s.run(String.raw`GuildedInvites.names = { { name = "Anna Smith-Jones", at = "a" } }`);
    s.run("NS.inviteQueue.open()");
    s.run(String.raw`NS.inviteQueue.markInvited("Anna Smith-Jones")`);
    say(s, "Anna Smith-Jones is already in a guild.");
    expect(labels(s)).toBe("handled:Anna Smith-Jones=inguild");
    // A reply with a realm suffix on a plain name still matches.
    s.run(String.raw`GuildedInvites.names = { { name = "Amy Archer", at = "a" } }; NS.inviteQueue.markInvited("Amy Archer")`);
    say(s, "Amy Archer-Realm declines your guild invitation.");
    expect(labels(s)).toBe("invited:Amy Archer=declined");
  });

  it("brings a name back when its requester posts it again after joining or being in another guild", () => {
    const s = withQueue();
    s.run(String.raw`GuildedInvites.names = { { name = "Amy Archer", at = "2026-11-10T10:00:00Z" } }`);
    s.run("NS.inviteQueue.open()");
    click(s, 1);
    say(s, "Amy Archer has joined the guild.");
    expect(labels(s)).toBe(""); // joined, and not on the roster list: hidden for that post
    s.run("CLOCKS = CLOCKS + 200"); // (the click's pending window is over)
    s.run(String.raw`GuildedInvites.names[1].at = "2026-11-12T10:00:00Z"`); // she left and posted again
    expect(labels(s)).toBe("todo:Amy Archer=nil");
    // Another guild's member: handled for that post, a todo again after a newer post.
    click(s, 1);
    say(s, "Amy Archer is already in a guild.");
    expect(labels(s)).toBe("handled:Amy Archer=inguild");
    s.run("CLOCKS = CLOCKS + 200");
    s.run(String.raw`GuildedInvites.names[1].at = "2026-11-13T10:00:00Z"`);
    expect(labels(s)).toBe("todo:Amy Archer=nil");
    // Without a post time to compare, an answer expires after a day.
    s.run(String.raw`GuildedInvites.names[1].at = "x"; NS.inviteQueue.markInvited("Amy Archer"); DB.inviteState["amy archer"] = { state = "inguild", at = CLOCKS }`);
    expect(labels(s)).toBe("handled:Amy Archer=inguild");
    s.run("CLOCKS = CLOCKS + 86401");
    expect(labels(s)).toBe("todo:Amy Archer=nil");
  });

  it("offers Remove on a not-found row, never lists it for sending, and shows it again only after a repost", () => {
    const s = withQueue();
    s.run("NS.inviteQueue.open()");
    click(s, 1);
    say(s, "Player Amy Archer not found.");
    expect(s.run("return NS.inviteQueue.text()")).toBe("/ginvite Bob Brewer");
    expect(s.run(String.raw`return tostring(INVITES()[1].shown)`)).not.toBe("true");
    s.run(`NS.inviteQueue.remove("Amy Archer")`);
    expect(labels(s)).toBe("todo:Bob Brewer=nil");
    s.run(String.raw`GuildedInvites.names[1].at = "2026-11-10T12:00:00Z"`);
    expect(labels(s)).toBe("todo:Amy Archer=nil|todo:Bob Brewer=nil");
  });
  // What the window shows, read from the recorded font strings and textures (creation order: header, section heads, rows).
  const shown = (lua: LuaSession) => lua.run(String.raw`local t = {} for _, r in ipairs(FS) do local x = rawget(r, "text") if type(x) == "string" and x ~= "" and rawget(r, "shown") ~= false then t[#t + 1] = x end end return table.concat(t, "\n")`);
  const highlights = (lua: LuaSession) => lua.run(String.raw`local n = 0 for _, r in ipairs(TEX) do if rawget(r, "shown") then n = n + 1 end end return n`);

  it("shows three sections: to invite now, invited and waiting with the time since, and handled behind a toggle", () => {
    const s = withQueue();
    s.run(String.raw`GuildedInvites.names = { { name = "Amy Archer", at = "a" }, { name = "Bob Brewer", at = "b" }, { name = "Cat Carter", at = "c" }, { name = "Eve Ellis", at = "d" }, { name = "Zed Zealot", at = "e" } }`);
    s.run("NS.inviteQueue.open()");
    click(s, 1); // Amy: invited
    click(s, 3); // todo is now Bob, Cat, Eve: Eve
    say(s, "Eve Ellis is already in a guild.");
    s.run("CLOCKS = CLOCKS + 90; NS.inviteQueue.refresh()");
    const text = shown(s);
    expect(text).toContain("To invite now (2)");
    expect(text).toContain("Bob Brewer");
    expect(text).toContain("Cat Carter");
    expect(text).toContain("Invited, waiting for them to accept (1)");
    // Only copied, no game message yet: "copied ... waiting", not "invited".
    expect(text).toContain("Amy Archer  |cff8c96a3copied 1 min ago, waiting|r");
    expect(text).toContain("Show handled (1)");
    expect(text).not.toContain("Eve Ellis"); // another guild: out of the default view
    expect(text).not.toContain("Zed Zealot"); // already in our guild: gone
    expect(text).not.toContain("already in a guild");
    // The toggle shows and hides the handled name.
    s.run("NS.inviteQueue.showHandled = true; NS.inviteQueue.refresh()");
    expect(shown(s)).toContain("Eve Ellis (already in a guild)");
    expect(shown(s)).toContain("Hide handled (1)");
    s.run("NS.inviteQueue.showHandled = false; NS.inviteQueue.refresh()");
    expect(shown(s)).not.toContain("Eve Ellis");
  });

  it("shows Invite again on an invited row only from 60 s, and an expired invite goes back to the main list", () => {
    const s = withQueue();
    s.run("NS.inviteQueue.open()");
    click(s, 1);
    expect(lines(s)).toBe("/ginvite Bob Brewer"); // Amy is waiting: no button yet
    expect(s.run("return #COPIED")).toBe("1");
    s.run("CLOCKS = CLOCKS + 60; NS.inviteQueue.refresh()");
    expect(lines(s)).toBe("/ginvite Bob Brewer|/ginvite Amy Archer");
    click(s, 11); // the Invite again button on the invited row (after the ten to-invite rows)
    expect(s.run("return COPIED[#COPIED]")).toBe("/ginvite Amy Archer");
    expect(lines(s)).toBe("/ginvite Bob Brewer"); // marked again: waiting afresh
    s.run("CLOCKS = CLOCKS + 121; NS.inviteQueue.refresh()");
    expect(s.run("local sec = NS.inviteQueue.sections() return #sec.todo .. ':' .. #sec.invited")).toBe("2:0");
    expect(shown(s)).not.toContain("Invited, waiting");
    expect(s.run("return #SENT .. #OPENED")).toBe("00"); // no invite API, nothing in the chat box
  });

  it("says copied until the game confirms the invite, then invited; declined and expired act at once", () => {
    const s = withQueue();
    s.run("NS.inviteQueue.open()");
    click(s, 1);
    expect(shown(s)).toContain("Amy Archer  |cff8c96a3copied just now, waiting|r");
    say(s, "You have invited Amy Archer to join your guild.");
    expect(shown(s)).toContain("Amy Archer  |cff8c96a3invited just now|r");
    expect(shown(s)).not.toContain("copied");
    say(s, "Amy Archer declines your guild invitation.");
    expect(shown(s)).toContain("Amy Archer  |cff8c96a3declined|r");
    expect(lines(s)).toBe("/ginvite Bob Brewer|/ginvite Amy Archer"); // Invite again at once
    click(s, 11);
    expect(s.run("return tostring(NS.inviteQueue.sections().invited[1].state)")).toBe("nil"); // a new click starts over
    say(s, "The guild invitation to Amy Archer has expired.");
    expect(s.run("local sec = NS.inviteQueue.sections() return #sec.todo .. ':' .. #sec.invited")).toBe("2:0");
  });

  it("keeps the window current by itself: a 30 s ticker moves an expired invite, and a roster update refreshes it", () => {
    const s = withQueue();
    s.run(String.raw`ROSTER = {}; WIN = nil; for _, f in ipairs(FRAMES) do if rawget(f, "template") == "BasicFrameTemplateWithInset" then WIN = f end end`);
    s.run("NS.inviteQueue.open()");
    s.run(String.raw`WIN = nil; for _, f in ipairs(FRAMES) do if rawget(f, "template") == "BasicFrameTemplateWithInset" then WIN = f end end`);
    // Opened before the roster loaded: Zed (already in the guild) is listed as to invite.
    expect(shown(s)).toContain("To invite now (3)");
    s.run(String.raw`ROSTER = { "Zed Zealot-Realm", "Dan Dorn-Realm" }; WIN.IsShown = function() return true end; C_Timer.After = function(_, fn) fn() end
      for _, f in ipairs(FRAMES) do if f.scripts.OnEvent and not rawget(f, "template") then f.scripts.OnEvent(f, "GUILD_ROSTER_UPDATE") end end`);
    expect(shown(s)).toContain("To invite now (2)");
    expect(s.run("return tostring(WIN.scripts.OnUpdate ~= nil)")).toBe("true");
    click(s, 1);
    expect(shown(s)).toContain("Invited, waiting for them to accept (1)");
    s.run("CLOCKS = CLOCKS + 125"); // expired, but nothing refreshed yet
    expect(shown(s)).toContain("Invited, waiting for them to accept (1)");
    s.run("WIN.scripts.OnUpdate(WIN, 10)"); // under 30 s: nothing
    expect(shown(s)).toContain("Invited, waiting for them to accept (1)");
    s.run("WIN.scripts.OnUpdate(WIN, 25)"); // 35 s in all
    expect(shown(s)).not.toContain("Invited, waiting");
    expect(shown(s)).toContain("To invite now (2)");
  });

  it("counts the waiting names for the login notice only once the roster is loaded", () => {
    const s = withQueue();
    s.run("ROSTER = {}");
    s.run("NS.inviteQueue.notify()");
    expect(s.run("return #(CHAT or {})")).toBe("0");
    s.run('ROSTER = { "Zed Zealot-Realm", "Dan Dorn-Realm" }');
    s.run("NS.inviteQueue.notify()");
    expect(s.run("return CHAT[1]")).toContain("2 waiting for a guild invite");
  });

  it("shows +N more on every section that overflows, and never grows past the screen", () => {
    const s = withQueue();
    s.run(String.raw`ROSTER = {}; local t = {} for i = 1, 24 do t[i] = { name = "First" .. string.char(96 + (i % 26) + 1) .. " Last" .. string.char(96 + ((i * 7) % 26) + 1) .. i, at = "t" .. i } end GuildedInvites.names = t
      for i = 1, 12 do DB.inviteSent = DB.inviteSent or {} DB.inviteSent[NS.inviteQueue.foldKey(t[i].name)] = CLOCKS - 70 end
      for i = 13, 24 do DB.inviteState = DB.inviteState or {} DB.inviteState[NS.inviteQueue.foldKey(t[i].name)] = nil end
      for i = 21, 24 do DB.inviteSent[NS.inviteQueue.foldKey(t[i].name)] = CLOCKS - 10; DB.inviteState = DB.inviteState or {}; DB.inviteState[NS.inviteQueue.foldKey(t[i].name)] = { state = "inguild", at = CLOCKS - 5 } end`);
    s.run("NS.inviteQueue.showHandled = true; NS.inviteQueue.open()");
    const sections = s.run(String.raw`local sec = NS.inviteQueue.sections() return #sec.todo .. ":" .. #sec.invited .. ":" .. #sec.handled`);
    expect(sections).toBe("8:12:4");
    // 8 to invite (under the cap of 10), 12 invited (cap 8), 4 handled: only the invited overflow here.
    expect(shown(s)).toContain("+4 more");
    s.run(String.raw`DB.inviteSent = {}; DB.inviteState = {}; for i = 1, 24 do DB.inviteSent[NS.inviteQueue.foldKey(GuildedInvites.names[i].name)] = nil end
      for i = 1, 24 do GuildedInvites.names[i].at = "t" .. i end; NS.inviteQueue.refresh()`);
    expect(s.run(String.raw`return #NS.inviteQueue.sections().todo`)).toBe("24");
    expect(shown(s)).toContain("+14 more"); // 24 to invite, 10 shown
    // A short screen cuts the rows (6 at least) and the window height stays on screen.
    s.run(String.raw`UIParent = { GetHeight = function() return 400 end }; HEIGHTS = {}
      for _, f in ipairs(FRAMES) do if rawget(f, "template") == "BasicFrameTemplateWithInset" then f.SetHeight = function(self, h) HEIGHTS[#HEIGHTS + 1] = h end end end
      NS.inviteQueue.refresh()`);
    expect(shown(s)).toContain("+18 more");
    expect(s.run("return HEIGHTS[#HEIGHTS] <= 400 * 0.95 and 'fits' or HEIGHTS[#HEIGHTS]")).toBe("fits");
  });

  it("says plainly that the marks stay on this computer", () => {
    const s = withQueue();
    s.run("NS.inviteQueue.open()");
    expect(shown(s)).toContain("Marks stay on this computer: another officer may invite the same names.");
  });

  it("says Nobody to invite right now when nothing needs an invite, and keeps the invited ones out of the main count", () => {
    const s = withQueue();
    s.run("GuildedInvites.names = {}; NS.inviteQueue.open()");
    expect(shown(s)).toContain("To invite now (0)");
    expect(shown(s)).toContain("Nobody to invite right now.");
    s.run(String.raw`GuildedInvites.names = { { name = "Amy Archer", at = "a" } }; NS.inviteQueue.refresh()`);
    click(s, 1);
    expect(shown(s)).toContain("To invite now (0)");
    expect(shown(s)).toContain("Nobody to invite right now.");
    expect(shown(s)).toContain("Invited, waiting for them to accept (1)");
    expect(s.run("NS.inviteQueue.notify(); return #(CHAT or {})")).toBe("1"); // only the click message: nothing is waiting to be invited
  });

  it("highlights the first name still to invite and names it in the header, never an invited one", () => {
    const s = withQueue();
    s.run("NS.inviteQueue.open()");
    expect(s.run("return NS.inviteQueue.selected")).toBe("amy archer");
    expect(highlights(s)).toBe("1");
    expect(shown(s)).toContain("Copy /ginvite Amy Archer for the highlighted row (Ctrl+C), paste it in your chat box (Ctrl+V) and press Enter.");
    click(s, 1); // Amy is invited: the next one is highlighted
    expect(s.run("return NS.inviteQueue.selected")).toBe("bob brewer");
    expect(highlights(s)).toBe("1");
    expect(shown(s)).toContain("Copy /ginvite Bob Brewer for the highlighted row");
    expect(shown(s)).not.toContain("Copy /ginvite Amy Archer");
    click(s, 1);
    expect(s.run("return tostring(NS.inviteQueue.selected)")).toBe("nil");
    expect(highlights(s)).toBe("0");
    expect(shown(s)).not.toContain("for the highlighted row");
  });

  it("names the first and last name in the invite line, even when the row waits behind a not-found name", () => {
    const s = withQueue();
    s.run("NS.inviteQueue.open()");
    click(s, 1);
    say(s, "Player Amy Archer not found.");
    // Amy needs a fix (Remove): the highlight and header go to the next name.
    expect(s.run("return NS.inviteQueue.selected")).toBe("bob brewer");
    expect(shown(s)).toContain("Copy /ginvite Bob Brewer for the highlighted row");
  });

  it("speaks French on a French client", () => {
    const s = withQueue();
    s.run(`GetLocale = function() return "frFR" end; NS.L = function(x) return x end`);
    s.load("Locale.lua");
    s.run("NS.inviteQueue.open()");
    expect(shown(s)).toContain("\u00c0 inviter maintenant (2)");
  });
});
