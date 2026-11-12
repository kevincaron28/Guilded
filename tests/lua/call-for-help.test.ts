import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

// Call for help (Modules/CallForHelp.lua): trigger, cooldown, receiver filter, message encode/decode.
let s: LuaSession | undefined;
afterEach(() => s?.close());

function setup() {
  s = newLuaSession();
  s.run(`CLOCK = 100; LEVEL = 60; INST = false; SENT_OUT = {}; CHAT_OUT = {}; MSGS = {}; SOUNDS = 0
    ZONE = "Duskwood"; MAP = { 47, 0.5, 0.5 }; ENEMY = nil
    function GetTime() return CLOCK end
    function GetServerTime() return 1800000000 + math.floor(CLOCK) end
    function UnitName(u) if u == "player" then return "Kev" end; return ENEMY and ENEMY.name end
    function UnitLevel(u) if u == "player" then return LEVEL end; return ENEMY and ENEMY.level or 0 end
    function UnitClass(u) return "Rogue", "ROGUE" end
    function UnitFactionGroup() return "Horde" end
    function GetMaxPlayerLevel() return 60 end
    function GetRealZoneText() return ZONE end
    function GetSubZoneText() return "Raven Hill" end
    function IsInInstance() return INST end
    function IsInGuild() return true end
    function UnitExists(u) return u == "target" and ENEMY ~= nil end
    function UnitIsPlayer() return true end
    function UnitCanAttack() return true end
    function UnitIsUnit(a, b) return ENEMY ~= nil and a == "targettarget" and b == "player" end
    function PlaySound() SOUNDS = SOUNDS + 1 end
    function SendChatMessage(text, channel) CHAT_OUT[#CHAT_OUT + 1] = channel .. ":" .. text end
    NS = { util = {}, commandHandlers = {}, commandHelp = {},
      message = function(text) MSGS[#MSGS + 1] = text end,
      isSecret = function() return false end,
      playerName = function() return "Kev" end,
      normalizeName = function(n) return n and (n:match("^[^-]+")) end,
      isGuildMember = function(n) return n ~= "Stranger" and n ~= "Thug" end,
      getSettings = function() return SETTINGS end,
      guildMap = { members = {}, myPosition = function() if MAP then return MAP[1], MAP[2], MAP[3] end end, refresh = function() end },
      comm = { register = function() end,
        accept = function(prefix, text, channel, sender, expected) return prefix == expected and type(text) == "string" and #text <= 255 end,
        send = function(prefix, text, channel, target) SENT_OUT[#SENT_OUT + 1] = prefix .. ":" .. channel .. ":" .. (target or "") .. ":" .. text; return true end } }
    SETTINGS = {}
    -- Two hits from an enemy player in combat who targets me: a real attack.
    function ATTACK() ENEMY = { name = "Thug", level = 60 }; NS.callForHelp.noteDamage(5); CLOCK = CLOCK + 1; NS.callForHelp.noteDamage(5) end`);
  // The real shared helpers (ns.util.inviteButton, afterCombat), loaded on a scratch namespace so NS keeps its stubs.
  s.run("COPIED = {}; TITLES = {}; OPENED = {}; UTILNS = { message = function(text) return NS.message(text) end, showCopyText = function(text, title) COPIED[#COPIED + 1] = text; TITLES[#TITLES + 1] = title end }"); s.load("Util.lua", "UTILNS"); s.run("for k, v in pairs(UTILNS.util) do NS.util[k] = v end");
  s.load("Locale.lua");
  s.load("Modules/CallForHelp.lua");
  return s;
}
const sent = () => s!.run(`return table.concat(SENT_OUT, "\\n")`);
const sentCount = () => Number(s!.run(`return tostring(#SENT_OUT)`));
const msgs = () => s!.run(`return table.concat(MSGS, "\\n")`);
const chat = () => s!.run(`return table.concat(CHAT_OUT, "\\n")`);
const callFrom = (sender: string, text: string, channel = "GUILD") =>
  s!.run(`return NS.callForHelp.receive(${JSON.stringify(text)}, ${JSON.stringify(sender)}, ${JSON.stringify(channel)})`);
const goodCall = "S|42|58|47|2500|3000|Duskwood|Raven Hill|Thug~ROGUE~60~H;Bo~MAGE~58~H|1800000100";
const tick = (seconds: number) => s!.run(`CLOCK = CLOCK + ${seconds}`);

describe("call for help: message", () => {
  it("encodes and decodes a call with position and attackers", () => {
    const lua = setup();
    const text = lua.run(`return NS.callForHelp.encode({ id = "42", level = 58, mapId = 47, x = 0.25, y = 0.3, zone = "Duskwood", subzone = "Raven Hill",
      attackers = { { name = "Thug", class = "ROGUE", level = 60, faction = "Horde" }, { name = "Bo", class = "MAGE", level = 58, faction = "Horde" } }, time = 1800000100 })`);
    expect(text).toBe(goodCall);
    const decoded = lua.run(`local c = NS.callForHelp.decode("${goodCall}")
      return table.concat({ c.kind, c.id, c.level, c.mapId, c.x, c.y, c.zone, c.subzone, #c.attackers, c.attackers[1].name, c.attackers[2].level }, ",")`);
    expect(decoded).toBe("call,42,58,47,0.25,0.3,Duskwood,Raven Hill,2,Thug,58");
  });
  it("strips separators from free text and keeps the message under the limit", () => {
    const lua = setup();
    const text = lua.run(`return NS.callForHelp.encode({ id = "7", level = 60, zone = "A|B;C~D", subzone = string.rep("x", 90), attackers = {}, time = 1 })`);
    expect(text.split("|")).toHaveLength(10);
    expect(text.length).toBeLessThan(255);
  });
  it("decodes replies and all clears, and rejects malformed text", () => {
    const lua = setup();
    expect(lua.run(`local r = NS.callForHelp.decode("R|42|Y"); return r.kind .. tostring(r.coming)`)).toBe("replytrue");
    expect(lua.run(`return NS.callForHelp.decode("C|42").kind`)).toBe("clear");
    for (const bad of ["", "S|only|few", "S|42|x|47|1|1|a|b||1", "R|42|Z", "S|42|58|47|20000|3000|a|b||1"]) {
      expect(lua.run(`return tostring(NS.callForHelp.decode(${JSON.stringify(bad)}))`)).toBe("nil");
    }
  });
  it("gives the guild chat line, distance and direction", () => {
    const lua = setup();
    expect(lua.run(`return NS.callForHelp.guildChatLine({ name = "Lebowski", zone = "Duskwood", attackers = { { level = 60, faction = "Horde" }, { level = 58, faction = "Horde" } } })`))
      .toBe("[Guilded] Help! Lebowski is under attack in Duskwood (2 Horde, 58-60)");
    expect(lua.run(`return NS.callForHelp.guildChatLine({ name = "Lebowski", zone = "Duskwood", attackers = {} })`)).toBe("[Guilded] Help! Lebowski is under attack in Duskwood");
    expect(lua.run(`local d, c = NS.callForHelp.bearing(0.5, 0.5, 0.5, 0.4, 1000, 1000); return d .. c`)).toBe("100north");
    expect(lua.run(`local d, c = NS.callForHelp.bearing(0.5, 0.5, 0.6, 0.6, 1000, 1000); return d .. c`)).toBe("141southeast");
    expect(lua.run(`local d, c = NS.callForHelp.bearing(0.5, 0.5, 0.3, 0.5); return tostring(d) .. c`)).toBe("nilwest");
  });
});

describe("call for help: trigger and cooldown", () => {
  it("offers the button on player damage and never sends by itself", () => {
    const lua = setup();
    lua.run(`ENEMY = { name = "Thug", level = 60 }`);
    expect(lua.run(`return tostring(NS.callForHelp.noteDamage(5))`)).toBe("false"); // one hit is not an attack
    expect(lua.run(`CLOCK = CLOCK + 1; return tostring(NS.callForHelp.noteDamage(5))`)).toBe("true");
    expect(sentCount()).toBe(0);
    expect(chat()).toBe("");
  });
  it("offers nothing without a hostile player or inside an instance", () => {
    const lua = setup();
    expect(lua.run(`return tostring(NS.callForHelp.noteDamage(5))`)).toBe("false");
    lua.run(`ENEMY = { name = "Thug", level = 60 }; INST = true`);
    expect(lua.run(`NS.callForHelp.noteDamage(5); return tostring(NS.callForHelp.noteDamage(5))`)).toBe("false");
    lua.run(`INST = false; CLOCK = CLOCK + 20`);
    expect(lua.run(`NS.callForHelp.noteDamage(5); CLOCK = CLOCK + 1; return tostring(NS.callForHelp.noteDamage(5))`)).toBe("true");
  });
  it("sends the call with attackers and posts one guild chat line", () => {
    const lua = setup();
    lua.run(`ATTACK()`);
    expect(lua.run(`return tostring(NS.callForHelp.open())`)).toBe("true");
    expect(sentCount()).toBe(1);
    expect(sent()).toContain("GuildedSOS:GUILD::S|");
    expect(sent()).toContain("|60|47|5000|5000|Duskwood|Raven Hill|Thug~ROGUE~60~H|");
    expect(chat()).toBe("GUILD:[Guilded] Help! Kev is under attack in Duskwood, Raven Hill (50, 50) (1 Horde, 60)");
  });
  it("skips the guild chat line when turned off", () => {
    const lua = setup();
    lua.run(`NS.commandHandlers.sos({ "chat", "off" }); NS.callForHelp.open()`);
    expect(sentCount()).toBe(1);
    expect(chat()).toBe("");
  });
  it("allows one call per two minutes, then all clear and expiry", () => {
    const lua = setup();
    lua.run(`NS.callForHelp.open()`);
    expect(lua.run(`return tostring(NS.callForHelp.open())`)).toBe("false"); // still open
    lua.run(`NS.callForHelp.allClear()`);
    expect(sent()).toMatch(/GuildedSOS:GUILD::C\|\d+$/);
    tick(60);
    expect(lua.run(`return tostring(NS.callForHelp.open())`)).toBe("false"); // cooldown
    expect(msgs()).toContain("in 60 seconds");
    tick(61);
    expect(lua.run(`return tostring(NS.callForHelp.open())`)).toBe("true");
    tick(301); // the open call expires by itself
    expect(lua.run(`return tostring(NS.callForHelp.open())`)).toBe("true");
    expect(sentCount()).toBe(4);
  });
  it("uses the last known position when the map gives none in combat", () => {
    const lua = setup();
    lua.run(`NS.callForHelp.open(); NS.callForHelp.allClear()`);
    tick(130);
    lua.run(`MAP = nil`);
    lua.run(`NS.callForHelp.open()`);
    expect(sent().split("\n").pop()).toContain("|47|5000|5000|");
  });
});

describe("call for help: confirm and all clear", () => {
  it("a bare /guilded sos and /gsos show the options and ask, and send nothing", () => {
    const lua = setup();
    lua.run(`POPUPS = {}; StaticPopupDialogs = {}; function StaticPopup_Show(name) POPUPS[#POPUPS + 1] = name; return true end`);
    lua.run(`NS.commandHandlers.sos({})`);
    lua.run(`SlashCmdList["GUILDEDSOS"]("")`);
    expect(sentCount()).toBe(0);
    expect(chat()).toBe("");
    expect(lua.run(`return table.concat(POPUPS, ",")`)).toBe("GUILDED_CALL_FOR_HELP,GUILDED_CALL_FOR_HELP");
    expect(msgs()).toContain("/guilded sos now");
    lua.run(`StaticPopupDialogs.GUILDED_CALL_FOR_HELP.OnAccept()`); // Yes
    expect(sentCount()).toBe(1);
  });
  it("now sends at once, status only shows the options", () => {
    const lua = setup();
    lua.run(`NS.commandHandlers.sos({ "status" })`);
    expect(sentCount()).toBe(0);
    lua.run(`ATTACK(); NS.commandHandlers.sos({ "now" })`);
    expect(sentCount()).toBe(1);
    expect(chat()).toContain("[Guilded] Help! Kev");
  });
  it("posts an all clear line in guild chat when the call did", () => {
    const lua = setup();
    lua.run(`ATTACK(); NS.callForHelp.open(); NS.callForHelp.allClear()`);
    expect(chat().split("\n")).toEqual(["GUILD:[Guilded] Help! Kev is under attack in Duskwood, Raven Hill (50, 50) (1 Horde, 60)", "GUILD:[Guilded] All clear: Kev is safe."]);
  });
  it("posts no all clear line when the call stayed on Guilded", () => {
    const lua = setup();
    lua.run(`NS.commandHandlers.sos({ "chat", "off" }); NS.callForHelp.open(); NS.commandHandlers.sos({ "clear" })`);
    expect(chat()).toBe("");
    expect(sent()).toMatch(/C\|\d+$/);
  });
});

describe("call for help: receiver", () => {
  it("shows the banner and sound to a defender in the same zone and moves the caller's pin", () => {
    const lua = setup();
    lua.run(`NS.guildMap.members.Bob = { class = "WARRIOR", at = 0 }`);
    expect(callFrom("Bob-Realm", goodCall)).toBe("banner");
    expect(lua.run(`return tostring(SOUNDS)`)).toBe("1");
    expect(msgs()).toContain("Bob is under attack in Duskwood (Raven Hill), 2 Horde");
    expect(lua.run(`return NS.guildMap.members.Bob.x`)).toBe("0.25");
    expect(lua.run(`return NS.guildMap.members.Bob.class`)).toBe("WARRIOR");
  });
  it("gives a plain chat line to a non-defender or someone in another zone", () => {
    const lua = setup();
    lua.run(`NS.commandHandlers.sos({ "defender", "off" })`);
    expect(callFrom("Bob", goodCall)).toBe("line");
    lua.run(`NS.commandHandlers.sos({ "defender", "on" }); MAP = { 99, 0.5, 0.5 }; ZONE = "Elwynn Forest"`);
    expect(callFrom("Cy", goodCall)).toBe("line");
    expect(lua.run(`return tostring(SOUNDS)`)).toBe("0");
  });
  it("is a defender by default at any level, and the member can turn it off", () => {
    const lua = setup();
    lua.run(`LEVEL = 12`);
    expect(lua.run(`return tostring(NS.callForHelp.defender())`)).toBe("true");
    lua.run(`NS.commandHandlers.sos({ "defender", "off" })`);
    expect(lua.run(`return tostring(NS.callForHelp.defender())`)).toBe("false");
    lua.run(`NS.commandHandlers.sos({ "defender", "on" })`);
    expect(lua.run(`return tostring(NS.callForHelp.defender())`)).toBe("true");
  });
  it("ignores myself, non-guildmates, other channels, malformed text and repeat calls inside two minutes", () => {
    setup();
    expect(callFrom("Kev", goodCall)).toBe("self");
    expect(callFrom("Stranger", goodCall)).toBe("not guild");
    expect(callFrom("Bob", goodCall, "WHISPER")).toBe("other channel");
    expect(callFrom("Bob", "S|junk")).toBe("invalid payload");
    expect(callFrom("Bob", goodCall)).toBe("banner");
    tick(60);
    expect(callFrom("Bob", goodCall)).toBe("cooldown");
    tick(61);
    expect(callFrom("Bob", goodCall)).toBe("banner");
  });
  it("replies to the caller by whisper and the caller sees who is coming", () => {
    const lua = setup();
    callFrom("Bob-Realm", goodCall);
    lua.run(`NS.callForHelp.reply(true)`);
    expect(sent()).toBe("GuildedSOS:WHISPER:Bob-Realm:R|42|Y");
    lua.run(`NS.callForHelp.open()`);
    const id = lua.run(`return SENT_OUT[#SENT_OUT]:match("^GuildedSOS:GUILD::S|(%w+)|")`);
    expect(callFrom("Cy-Realm", `R|${id}|Y`, "WHISPER")).toBe("reply");
    expect(callFrom("Bob-Realm", `R|${id}|N`, "WHISPER")).toBe("reply");
    expect(callFrom("Dee-Realm", `R|99999|Y`, "WHISPER")).toBe("ignored");
    expect(callFrom("Eve-Realm", `R|${id}|Y`, "GUILD")).toBe("ignored");
    expect(msgs()).toContain("Cy is on the way.");
    expect(msgs()).toContain("Bob can't come.");
  });
  it("closes the banner on an all clear from that caller", () => {
    setup();
    callFrom("Bob", goodCall);
    expect(callFrom("Bob", "C|42")).toBe("clear");
    expect(callFrom("Bob", "C|42")).toBe("ignored");
    expect(msgs()).toContain("Bob: all clear.");
  });
  it("registers the command and the key binding function, and translates to French", () => {
    const lua = setup();
    expect(lua.run(`return type(NS.commandHandlers.sos) .. type(Guilded_CallForHelp)`)).toBe("functionfunction");
  });
});

describe("call for help: guildmates in the zone and party invites", () => {
  function withRoster() {
    const lua = setup();
    lua.run(`INVITES = {}; WHISPERS = {}
      ROSTER = { { "Kev", 60, "ROGUE", "Duskwood", true }, { "Ann-Realm", 58, "MAGE", "Duskwood", true },
        { "Bo-Realm", 40, "WARRIOR", "Duskwood", false }, { "Cy-Realm", 60, "PRIEST", "Stranglethorn Vale", true },
        { "Dee-Realm", 52, "HUNTER", "Duskwood", true } }
      function GetNumGuildMembers() return #ROSTER end
      function GetGuildRosterInfo(i) local r = ROSTER[i]; return r[1], "Member", 3, r[2], r[3], r[4], "", "", r[5] end
      function InviteUnit(name) INVITES[#INVITES + 1] = name end
      IN_COMBAT = false
      function InCombatLockdown() return IN_COMBAT end
      -- Spy: an Invite click must never touch the game chat box (nor call InviteUnit).
      function ChatFrame_OpenChat(line) OPENED[#OPENED + 1] = line end
      local make = CreateFrame
      CreateFrame = function(kind, name, parent, template)
        local f = make(kind, name, parent, template)
        f.template = template
        return f
      end
      function SendChatMessage(text, channel, _, target) if channel == "WHISPER" then WHISPERS[#WHISPERS + 1] = target .. ":" .. text else CHAT_OUT[#CHAT_OUT + 1] = channel .. ":" .. text end end`);
    return lua;
  }
  const invites = () => s!.run(`return table.concat(INVITES, ",")`);
  // The Invite buttons (frames with setInvite/inviteLine; the test frames answer any method, so rawget) and their lines.
  const buttons = `local function buttons() local t = {} for _, f in ipairs(FRAMES) do if rawget(f, "inviteLine") then t[#t + 1] = f end end return t end `;
  const lines = () => s!.run(buttons + `local t = {} for _, f in ipairs(buttons()) do local l = f.inviteLine() if l then t[#t + 1] = l end end table.sort(t) return table.concat(t, "|")`);
  const clickLine = (line: string) => s!.run(buttons + `for _, f in ipairs(buttons()) do if f.inviteLine() == "${line}" then f.scripts.OnClick(f) return end end error("no button for ${line}")`);

  it("lists online guildmates in my zone, not me, offline members or other zones", () => {
    const lua = withRoster();
    expect(lua.run(`local t = {} for _, m in ipairs(NS.callForHelp.zoneMates()) do t[#t + 1] = m.name end return table.concat(t, ",")`)).toBe("Ann-Realm,Dee-Realm");
  });

  it("shows them under the caller's call as plain /invite buttons that show the line in the copy box on a click", () => {
    const lua = withRoster();
    lua.run(`NS.callForHelp.open()`);
    expect(lua.run(`return tostring(NS.callForHelp.refreshMates())`)).toBe("2");
    expect(lines()).toBe("/invite Ann|/invite Dee");
    expect(lua.run(buttons + `local n, bad = 0, 0 for _, f in ipairs(buttons()) do if f.inviteLine() then n = n + 1 if f.template ~= "UIPanelButtonTemplate" then bad = bad + 1 end end end return n .. ":" .. bad`)).toBe("2:0");
    expect(lua.run(`return #COPIED`)).toBe("0");   // nothing before the click
    clickLine("/invite Ann");
    expect(lua.run(`return #COPIED .. COPIED[1]`)).toBe("1/invite Ann");
    expect(lua.run(`return TITLES[1]`)).toBe("Copy with Ctrl+C, then paste in chat");
    expect(lua.run(`return #OPENED`)).toBe("0");
    expect(msgs()).toContain("Copy /invite Ann (Ctrl+C), paste it in your chat box (Ctrl+V) and press Enter.");
    expect(invites()).toBe("");   // the invite API is never called from addon code
    expect(lua.run(`return tostring(NS.callForHelp.invited("Ann"))`)).toBe("true");
    expect(lua.run(`return #COPIED`)).toBe("1");   // invited() prints and shows nothing itself
    expect(lua.run(`local n = 0 for _, m in ipairs(MSGS) do if m:find("Ctrl+C", 1, true) then n = n + 1 end end return n`)).toBe("1");
  });

  it("tells the player which line to type when there is no copy box", () => {
    const lua = withRoster();
    lua.run(`UTILNS.showCopyText = nil; NS.callForHelp.open(); NS.callForHelp.refreshMates()`);
    clickLine("/invite Dee");
    expect(msgs()).toContain("Type /invite Dee to invite them.");
    expect(msgs()).not.toContain("Ctrl+C");
    expect(lua.run(`return #OPENED`)).toBe("0");
    expect(invites()).toBe("");
  });

  it("keeps the rows after combat, and a click in combat still shows the copy box", () => {
    const lua = withRoster();
    lua.run(`NS.callForHelp.open()`);
    lua.run(`NS.callForHelp.refreshMates()`);
    lua.run(`IN_COMBAT = true; ROSTER[2][1] = "Eli-Realm"`);
    lua.run(`NS.callForHelp.refreshMates()`);
    expect(lines()).toBe("/invite Ann|/invite Dee");
    clickLine("/invite Ann");   // plain buttons: no lockdown, the click works in combat
    expect(lua.run(`return COPIED[#COPIED]`)).toBe("/invite Ann");
    lua.run(`IN_COMBAT = false; fire_event("PLAYER_REGEN_ENABLED")`);
    expect(lines()).toBe("/invite Dee|/invite Eli");
  });

  it("keeps the list to five names", () => {
    const lua = withRoster();
    lua.run(`for i = 1, 8 do ROSTER[#ROSTER + 1] = { "Extra" .. i .. "-Realm", 30, "MAGE", "Duskwood", true } end`);
    expect(lua.run(`return tostring(#NS.callForHelp.zoneMates())`)).toBe("5");
  });

  it("gives a defender Join (whisper inv) and Invite caller", () => {
    const lua = withRoster();
    expect(callFrom("Bob-Realm", goodCall)).toBe("banner");
    expect(lua.run(`return tostring(NS.callForHelp.join())`)).toBe("true");
    expect(lua.run(`return table.concat(WHISPERS, ",")`)).toBe("Bob-Realm:inv");
    expect(lines()).toContain("/invite Bob");
    clickLine("/invite Bob");
    expect(lua.run(`return COPIED[#COPIED]`)).toBe("/invite Bob");
    expect(lua.run(`return #OPENED`)).toBe("0");
    expect(invites()).toBe("");
  });

  it("does nothing without a banner", () => {
    const lua = withRoster();
    expect(lua.run(`return tostring(NS.callForHelp.join())`)).toBe("false");
    expect(lines()).toBe("");
  });

  it("translates the new buttons to French", () => {
    const lua = setup();
    lua.run(`NS.locale = "frFR"`);
    expect(lua.run(`return NS.L("Invite caller")`)).toBeTruthy();
  });
});

  it("posts the call and the all-clear in French on a French client", () => {
    const lua = setup();
    lua.run(`SETTINGS.language = "fr"`);
    expect(lua.run(`return NS.callForHelp.guildChatLine({ name = "Kev", zone = "Duskwood", attackers = {} })`)).toContain("l'aide ! Kev est attaqu");
    expect(lua.run(`return NS.callForHelp.guildChatLine({ name = "Kev", zone = "", attackers = {} })`)).toContain("dans le monde ouvert");
    lua.run(`SETTINGS.language = "en"`);
    expect(lua.run(`return NS.callForHelp.guildChatLine({ name = "Kev", zone = "", attackers = {} })`)).toBe("[Guilded] Help! Kev is under attack in the open world");
  });
  it("tells the world PvP stats which zone the call named when I answer", () => {
    const lua = setup();
    lua.run(`NS.worldPvp = { note = function(kind, zone, map) NOTED = kind .. ":" .. tostring(zone) .. ":" .. tostring(map) end }`);
    callFrom("Ann-Realm", goodCall);
    lua.run(`NS.callForHelp.reply(true)`);
    expect(lua.run(`return NOTED`)).toBe("responded:Duskwood:47");
  });

describe("call for help: only a real attack counts, and the chat line is limited", () => {
  it("ignores a hit while no enemy player is targeting me (an NPC, a trap, a fall)", () => {
    const lua = setup();
    for (let i = 0; i < 4; i++) expect(lua.run(`CLOCK = CLOCK + 1; return tostring(NS.callForHelp.noteDamage(5))`)).toBe("false");
    expect(lua.run(`return tostring(NS.callForHelp.attacked())`)).toBe("false");
  });
  it("ignores zero damage, a duel, a guildmate and a party member", () => {
    const lua = setup();
    lua.run(`ENEMY = { name = "Thug", level = 60 }`);
    expect(lua.run(`NS.callForHelp.noteDamage(0); CLOCK = CLOCK + 1; return tostring(NS.callForHelp.noteDamage(0))`)).toBe("false");
    lua.run(`fire_event("DUEL_INBOUNDS")`);
    expect(lua.run(`NS.callForHelp.noteDamage(5); CLOCK = CLOCK + 1; return tostring(NS.callForHelp.noteDamage(5))`)).toBe("false");
    lua.run(`fire_event("DUEL_FINISHED"); ENEMY = { name = "Ann", level = 60 }`); // a guildmate
    expect(lua.run(`NS.callForHelp.noteDamage(5); CLOCK = CLOCK + 1; return tostring(NS.callForHelp.noteDamage(5))`)).toBe("false");
    lua.run(`ENEMY = { name = "Thug", level = 60 }; function UnitInParty() return true end`);
    expect(lua.run(`NS.callForHelp.noteDamage(5); CLOCK = CLOCK + 1; return tostring(NS.callForHelp.noteDamage(5))`)).toBe("false");
    expect(lua.run(`return tostring(NS.callForHelp.attacked())`)).toBe("false");
  });
  // DUEL_INBOUNDS fires only on walking back into the duel area; a normal duel starts with a request.
  it("treats a duel as a duel from its request, until it finishes", () => {
    const lua = setup();
    lua.run(`ENEMY = { name = "Thug", level = 60 }; fire_event("DUEL_REQUESTED", "Thug")`);
    expect(lua.run(`NS.callForHelp.noteDamage(5); CLOCK = CLOCK + 1; return tostring(NS.callForHelp.noteDamage(5))`)).toBe("false");
    lua.run(`fire_event("DUEL_FINISHED"); CLOCK = CLOCK + 60`);
    expect(lua.run(`NS.callForHelp.noteDamage(5); CLOCK = CLOCK + 1; return tostring(NS.callForHelp.noteDamage(5))`)).toBe("true");
  });
  // A declined or timed-out request may never fire DUEL_FINISHED; it must not hide a real attack for the whole session.
  it("stops treating an unaccepted duel request as a duel after a minute", () => {
    const lua = setup();
    lua.run(`ENEMY = { name = "Thug", level = 60 }; fire_event("DUEL_REQUESTED", "Thug")`);
    lua.run(`CLOCK = CLOCK + 61`);
    expect(lua.run(`NS.callForHelp.noteDamage(5); CLOCK = CLOCK + 1; return tostring(NS.callForHelp.noteDamage(5))`)).toBe("true");
  });
  it("keeps a started duel a duel however long it lasts, until it finishes", () => {
    const lua = setup();
    lua.run(`ENEMY = { name = "Thug", level = 60 }; fire_event("DUEL_REQUESTED", "Thug"); fire_event("DUEL_COUNTDOWN", 3)`);
    lua.run(`CLOCK = CLOCK + 300`);
    expect(lua.run(`NS.callForHelp.noteDamage(5); CLOCK = CLOCK + 1; return tostring(NS.callForHelp.noteDamage(5))`)).toBe("false");
    lua.run(`fire_event("DUEL_FINISHED")`);
    lua.run(`CLOCK = CLOCK + 60`);
    expect(lua.run(`NS.callForHelp.noteDamage(5); CLOCK = CLOCK + 1; return tostring(NS.callForHelp.noteDamage(5))`)).toBe("true");
  });
  it("ignores an enemy that is not in combat, and hits too far apart", () => {
    const lua = setup();
    lua.run(`ENEMY = { name = "Thug", level = 60 }; function UnitAffectingCombat() return false end`);
    expect(lua.run(`NS.callForHelp.noteDamage(5); CLOCK = CLOCK + 1; return tostring(NS.callForHelp.noteDamage(5))`)).toBe("false");
    lua.run(`function UnitAffectingCombat() return true end`);
    expect(lua.run(`NS.callForHelp.noteDamage(5); CLOCK = CLOCK + 11; return tostring(NS.callForHelp.noteDamage(5))`)).toBe("false");
  });
  it("offers the button once per attack, not on every hit", () => {
    const lua = setup();
    lua.run(`ATTACK()`);
    expect(lua.run(`CLOCK = CLOCK + 5; return tostring(NS.callForHelp.noteDamage(5))`)).toBe("false");
    expect(lua.run(`CLOCK = CLOCK + 5; return tostring(NS.callForHelp.noteDamage(5))`)).toBe("false");
    lua.run(`CLOCK = CLOCK + 40`); // a new attack
    expect(lua.run(`NS.callForHelp.noteDamage(5); CLOCK = CLOCK + 1; return tostring(NS.callForHelp.noteDamage(5))`)).toBe("true");
  });
  it("posts no guild chat line without a confirmed attack, but still calls Guilded users", () => {
    const lua = setup();
    expect(lua.run(`return tostring(NS.callForHelp.open())`)).toBe("true");
    expect(sentCount()).toBe(1);
    expect(chat()).toBe("");
    expect(msgs()).toContain("No attack was seen");
    lua.run(`NS.callForHelp.allClear()`);
    expect(chat()).toBe(""); // no all clear line either
  });
  it("posts no line when the attack was more than a minute ago", () => {
    const lua = setup();
    lua.run(`ATTACK(); CLOCK = CLOCK + 70`);
    lua.run(`NS.callForHelp.open()`);
    expect(chat()).toBe("");
  });
  it("posts one line per zone every five minutes and per attack window", () => {
    const lua = setup();
    lua.run(`ATTACK(); NS.callForHelp.open(); NS.callForHelp.allClear()`);
    expect(chat().split("\n")).toHaveLength(2); // call line + all clear
    lua.run(`CLOCK = CLOCK + 130; ATTACK(); NS.callForHelp.open()`); // new call, same zone, 2 minutes later
    expect(chat().split("\n")).toHaveLength(2);
    expect(msgs()).toContain("posted a moment ago");
    lua.run(`NS.callForHelp.allClear(); CLOCK = CLOCK + 400; ATTACK(); NS.callForHelp.open()`);
    expect(chat().split("\n")).toHaveLength(3);
  });
  it("puts the zone, subzone and coordinates in the line", () => {
    const lua = setup();
    expect(lua.run(`return NS.callForHelp.guildChatLine({ name = "Lebowski Holyroller", zone = "Silverpine Forest", subzone = "The Sepulcher", x = 0.4312, y = 0.3871, attackers = {} })`))
      .toBe("[Guilded] Help! Lebowski Holyroller is under attack in Silverpine Forest, The Sepulcher (43, 39)");
  });
});

// The toast and the caller's offer (9.2.x): small, click-through, closable in and out of combat, never takes the keyboard.
describe("call for help: the toast is never in the way", () => {
  function withFrames() {
    const lua = setup();
    lua.run(`IN_COMBAT = false; KB = {}; MOUSE = {}
      function InCombatLockdown() return IN_COMBAT end
      local make = CreateFrame
      CreateFrame = function(kind, name, parent, template)
        local f = make(kind, name, parent, template)
        f.kind = kind
        f.pts = {}
        f.EnableKeyboard = function(self, v) KB[#KB + 1] = tostring(v); return self end
        f.EnableMouse = function(self, v) if kind == "Frame" and v then MOUSE[#MOUSE + 1] = "frame" end return self end
        f.Show = function(self) self.vis = true; return self end
        f.Hide = function(self) self.vis = false; return self end
        f.SetPoint = function(self, ...) self.pts[#self.pts + 1] = { ... }; return self end
        f.ClearAllPoints = function(self) self.pts = {}; return self end
        return f
      end
      function FIND(field) for _, f in ipairs(FRAMES) do if rawget(f, field) then return f end end end
      function ICON() for _, f in ipairs(FRAMES) do if f.kind == "Button" and rawget(f, "text") then return f end end end
      function ANCHOR() for _, f in ipairs(FRAMES) do if rawget(f, "pts") then for _, p in ipairs(f.pts) do if p[2] == UIParent then return f, p end end end end end
      function UPDATE(seconds) CLOCK = CLOCK + seconds; for _, f in ipairs(FRAMES) do if f.scripts.OnUpdate then f.scripts.OnUpdate(f, 1.5) end end end
      fire_event("PLAYER_LOGIN")`);
    return lua;
  }
  const vis = (field: string) => s!.run(`local f = FIND("${field}"); return tostring(f and rawget(f, "vis"))`);
  const toastShown = () => vis("coming");
  const offerShown = () => vis("clear");
  const iconShown = () => s!.run(`local f = ICON(); return tostring(f and rawget(f, "vis"))`);
  const callFromCy = () => callFrom("Cy", "S|43|58|47|2600|3100|Duskwood|Raven Hill|Bo~MAGE~58~H|1800000100");
  const attack = (lua: LuaSession) => lua.run(`ATTACK()`);

  it("closes with the X and with a right-click on the title strip, out of combat and in combat", () => {
    const lua = withFrames();
    expect(callFrom("Bob", goodCall)).toBe("banner");
    expect(toastShown()).toBe("true");
    lua.run(`local t = FIND("coming"); t.grip.scripts.OnClick(t.grip, "LeftButton")`);
    expect(toastShown()).toBe("true");   // a left click on the strip only drags
    lua.run(`local t = FIND("coming"); t.grip.scripts.OnClick(t.grip, "RightButton")`);
    expect(toastShown()).toBe("false");
    lua.run(`SETTINGS.helpQuiet = false; IN_COMBAT = true; CLOCK = CLOCK + 200`);
    expect(callFromCy()).toBe("banner");
    expect(toastShown()).toBe("true");   // quiet mode off: the window shows in combat too
    lua.run(`local t = FIND("coming"); t.close.scripts.OnClick(t.close)`);
    expect(toastShown()).toBe("false");
  });

  it("never enables the keyboard and never makes a plain frame take the mouse", () => {
    const lua = withFrames();
    callFrom("Bob", goodCall);
    lua.run(`NS.callForHelp.open(); NS.callForHelp.showOffer()`);
    expect(toastShown()).toBe("true");
    expect(offerShown()).toBe("true");
    expect(lua.run(`return #KB .. "/" .. #MOUSE`)).toBe("0/0");
  });

  it("hides by itself: 15 seconds out of combat, 6 in combat", () => {
    const lua = withFrames();
    callFrom("Bob", goodCall);
    lua.run(`UPDATE(14)`);
    expect(toastShown()).toBe("true");
    lua.run(`UPDATE(2)`);
    expect(toastShown()).toBe("false");
    lua.run(`SETTINGS.helpQuiet = false; IN_COMBAT = true`);
    callFromCy();
    lua.run(`UPDATE(5)`);
    expect(toastShown()).toBe("true");
    lua.run(`UPDATE(2)`);
    expect(toastShown()).toBe("false");
  });

  it("is quiet in combat: a chat line and a small icon, no window and no sound, then the full toast after combat", () => {
    const lua = withFrames();
    lua.run(`IN_COMBAT = true`);
    expect(callFrom("Bob", goodCall)).toBe("banner");
    expect(toastShown()).toBe("nil");
    expect(iconShown()).toBe("true");
    expect(lua.run(`return tostring(SOUNDS)`)).toBe("0");
    expect(msgs()).toContain("Bob is under attack in Duskwood");
    lua.run(`IN_COMBAT = false; fire_event("PLAYER_REGEN_ENABLED")`);
    expect(toastShown()).toBe("true");
    expect(iconShown()).toBe("false");
  });

  it("drops a call that went stale during the fight and one its caller cleared", () => {
    const lua = withFrames();
    lua.run(`IN_COMBAT = true`);
    callFrom("Bob", goodCall);
    lua.run(`CLOCK = CLOCK + 130; IN_COMBAT = false; fire_event("PLAYER_REGEN_ENABLED")`);
    expect(toastShown()).toBe("nil");
    expect(iconShown()).toBe("false");
    lua.run(`IN_COMBAT = true`);
    callFrom("Bob", goodCall);
    expect(iconShown()).toBe("true");
    expect(callFrom("Bob", "C|42")).toBe("clear");
    expect(iconShown()).toBe("false");
    lua.run(`IN_COMBAT = false; fire_event("PLAYER_REGEN_ENABLED")`);
    expect(toastShown()).toBe("nil");
  });

  it("the icon opens the waiting call even in combat, and a right-click dismisses it", () => {
    const lua = withFrames();
    lua.run(`IN_COMBAT = true`);
    callFrom("Bob", goodCall);
    lua.run(`local i = ICON(); i.scripts.OnClick(i, "LeftButton")`);
    expect(toastShown()).toBe("true");
    expect(iconShown()).toBe("false");
    lua.run(`CLOCK = CLOCK + 200`);
    callFromCy();
    lua.run(`local i = ICON(); i.scripts.OnClick(i, "RightButton")`);
    expect(iconShown()).toBe("false");
  });

  it("puts a second call in the same window, behind the first", () => {
    const lua = withFrames();
    callFrom("Bob", goodCall);
    expect(callFromCy()).toBe("banner");
    expect(lua.run(`local n = 0 for _, f in ipairs(FRAMES) do if rawget(f, "coming") then n = n + 1 end end return n`)).toBe("1");
    expect(lua.run(`return tostring(SOUNDS)`)).toBe("1");   // one sound for the window, not one per call
    lua.run(`local t = FIND("coming"); t.close.scripts.OnClick(t.close)`);
    expect(toastShown()).toBe("true");   // the waiting call takes the window
    expect(lua.run(`return FIND("coming").sender`)).toBe("Cy");
    lua.run(`local t = FIND("coming"); t.close.scripts.OnClick(t.close)`);
    expect(toastShown()).toBe("false");
  });

  it("closes when the caller says all clear", () => {
    const lua = withFrames();
    callFrom("Bob", goodCall);
    callFrom("Bob", "C|42");
    expect(toastShown()).toBe("false");
    expect(lua.run(`return tostring(rawget(FIND("coming"), "call"))`)).toBe("nil");
  });

  it("replying closes the toast", () => {
    const lua = withFrames();
    callFrom("Bob", goodCall);
    lua.run(`NS.callForHelp.reply(true)`);
    expect(toastShown()).toBe("false");
    expect(sent()).toContain(":R|42|Y");
  });

  it("respects the alert style, the sound switch and a ten-minute mute", () => {
    const lua = withFrames();
    lua.run(`SETTINGS.helpAlert = "chat"`);
    expect(callFrom("Bob", goodCall)).toBe("line");
    expect(toastShown()).toBe("nil");
    expect(msgs()).toContain("Bob is under attack");
    lua.run(`SETTINGS.helpAlert = "off"; MSGS = {}`);
    expect(callFrom("Cy", goodCall)).toBe("off");
    expect(msgs()).toBe("");
    lua.run(`SETTINGS.helpAlert = nil; SETTINGS.helpSound = false`);
    expect(callFrom("Di", goodCall)).toBe("banner");
    expect(lua.run(`return tostring(SOUNDS)`)).toBe("0");
    lua.run(`NS.callForHelp.dismissAll(); NS.commandHandlers.sos({ "mute" })`);
    expect(toastShown()).toBe("false");
    expect(callFrom("Ed", goodCall)).toBe("line");
    tick(601);
    expect(callFrom("Flo", goodCall)).toBe("banner");
    lua.run(`NS.callForHelp.dismissAll(); NS.commandHandlers.sos({ "mute" }); NS.commandHandlers.sos({ "unmute" })`);
    expect(callFrom("Gus", goodCall)).toBe("banner");
  });

  it("saves the position, uses it, and starts at the default for old or damaged settings", () => {
    const lua = withFrames();
    lua.run(`SETTINGS.helpPos = { "TOPLEFT", "TOPLEFT", 30, -40 }`);
    callFrom("Bob", goodCall);
    expect(lua.run(`local a, p = ANCHOR(); return table.concat({ p[1], p[3], p[4], p[5] }, ",")`)).toBe("TOPLEFT,TOPLEFT,30,-40");
    expect(lua.run(`return tostring(NS.callForHelp.setPosition("TOP", "TOP", 10.4, -20.6))`)).toBe("true");
    expect(lua.run(`return table.concat(SETTINGS.helpPos, ",")`)).toBe("TOP,TOP,10,-21");
    expect(lua.run(`return tostring(NS.callForHelp.setPosition(nil, "TOP", 1, 2))`)).toBe("false");
    expect(lua.run(`return table.concat(SETTINGS.helpPos, ",")`)).toBe("TOP,TOP,10,-21");
    lua.run(`NS.commandHandlers.sos({ "reset" })`);
    expect(lua.run(`return tostring(SETTINGS.helpPos)`)).toBe("nil");
    expect(lua.run(`local a, p = ANCHOR(); return table.concat({ p[1], p[3], p[4], p[5] }, ",")`)).toBe("TOPRIGHT,TOPRIGHT,-20,-220");
  });

  it("loads old SavedVariables cleanly: every new setting has a safe default", () => {
    const lua = withFrames();
    lua.run(`SETTINGS = { helpDefender = true, helpGuildChat = false, helpPos = "junk", helpAlert = 42 }`);
    expect(lua.run(`return NS.callForHelp.alertMode() .. tostring(NS.callForHelp.sound()) .. tostring(NS.callForHelp.quiet())`)).toBe("toasttruetrue");
    expect(callFrom("Bob", goodCall)).toBe("banner");
    expect(toastShown()).toBe("true");
    expect(lua.run(`local a, p = ANCHOR(); return table.concat({ p[1], p[3], p[4], p[5] }, ",")`)).toBe("TOPRIGHT,TOPRIGHT,-20,-220");
  });

  it("the caller's offer closes with X or a right-click and hides after its 20 seconds", () => {
    const lua = withFrames();
    attack(lua);
    expect(offerShown()).toBe("true");
    lua.run(`local o = FIND("clear"); o.close.scripts.OnClick(o.close)`);
    expect(offerShown()).toBe("false");
    lua.run(`CLOCK = CLOCK + 40`);
    attack(lua);
    expect(offerShown()).toBe("true");
    lua.run(`local o = FIND("clear"); o.grip.scripts.OnClick(o.grip, "RightButton")`);
    expect(offerShown()).toBe("false");
    lua.run(`CLOCK = CLOCK + 40`);
    attack(lua);
    lua.run(`UPDATE(19)`);
    expect(offerShown()).toBe("true");
    lua.run(`UPDATE(3)`);
    expect(offerShown()).toBe("false");
    expect(sentCount()).toBe(0);   // nothing was ever sent by itself
  });

  it("after calling, the offer closes by itself after a minute but the call stays open", () => {
    const lua = withFrames();
    lua.run(`NS.callForHelp.open()`);
    expect(offerShown()).toBe("true");
    lua.run(`UPDATE(61)`);
    expect(offerShown()).toBe("false");
    expect(lua.run(`return tostring(NS.callForHelp.allClear())`)).toBe("true");
    expect(sent()).toContain(":C|");
  });

  it("folds the guildmate list away until Nearby is pressed", () => {
    const lua = withFrames();
    lua.run(`ROSTER = { { "Kev", 60, "ROGUE", "Duskwood", true }, { "Ann-Realm", 58, "MAGE", "Duskwood", true } }
      function GetNumGuildMembers() return #ROSTER end
      function GetGuildRosterInfo(i) local r = ROSTER[i]; return r[1], "Member", 3, r[2], r[3], r[4], "", "", r[5] end`);
    lua.run(`NS.callForHelp.open(); NS.callForHelp.refreshMates()`);
    const shownInvites = `local n = 0 for _, r in ipairs(FRAMES) do if rawget(r, "inviteLine") and rawget(r, "vis") then n = n + 1 end end return n`;
    expect(lua.run(shownInvites)).toBe("0");
    lua.run(`local o = FIND("clear"); o.nearby.scripts.OnClick(o.nearby)`);
    expect(lua.run(shownInvites)).toBe("1");
  });

  it("has the new command options", () => {
    const lua = withFrames();
    lua.run(`NS.commandHandlers.sos({ "alert", "chat" }); NS.commandHandlers.sos({ "sound", "off" }); NS.commandHandlers.sos({ "quiet", "off" })`);
    expect(lua.run(`return NS.callForHelp.alertMode() .. tostring(NS.callForHelp.sound()) .. tostring(NS.callForHelp.quiet())`)).toBe("chatfalsefalse");
    expect(msgs()).toContain("Call alerts: chat line only, sound off, quiet in combat off.");
  });

  it("speaks French on a French client", () => {
    const lua = withFrames();
    lua.run(`SETTINGS.language = "fr"`);
    expect(lua.run(`return NS.L("Mute 10 min")`)).toBe("Muet 10 min");
    expect(lua.run(`return NS.L("(+%d more)")`)).toBe("(+%d autres)");
  });
});
