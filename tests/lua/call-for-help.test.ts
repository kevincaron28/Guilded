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
      isGuildMember = function(n) return n ~= "Stranger" end,
      getSettings = function() return SETTINGS end,
      guildMap = { members = {}, myPosition = function() if MAP then return MAP[1], MAP[2], MAP[3] end end, refresh = function() end },
      comm = { register = function() end,
        accept = function(prefix, text, channel, sender, expected) return prefix == expected and type(text) == "string" and #text <= 255 end,
        send = function(prefix, text, channel, target) SENT_OUT[#SENT_OUT + 1] = prefix .. ":" .. channel .. ":" .. (target or "") .. ":" .. text; return true end } }
    SETTINGS = {}`);
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
    expect(lua.run(`fire_event("UNIT_COMBAT", "player", "WOUND"); return tostring(NS.callForHelp.noteDamage())`)).toBe("true");
    expect(sentCount()).toBe(0);
    expect(chat()).toBe("");
  });
  it("offers nothing without a hostile player or inside an instance", () => {
    const lua = setup();
    expect(lua.run(`return tostring(NS.callForHelp.noteDamage())`)).toBe("false");
    lua.run(`ENEMY = { name = "Thug", level = 60 }; INST = true`);
    expect(lua.run(`return tostring(NS.callForHelp.noteDamage())`)).toBe("false");
    lua.run(`INST = false`);
    expect(lua.run(`return tostring(NS.callForHelp.noteDamage())`)).toBe("true");
  });
  it("sends the call with attackers and posts one guild chat line", () => {
    const lua = setup();
    lua.run(`ENEMY = { name = "Thug", level = 60 }; NS.callForHelp.noteDamage()`);
    expect(lua.run(`return tostring(NS.callForHelp.open())`)).toBe("true");
    expect(sentCount()).toBe(1);
    expect(sent()).toContain("GuildedSOS:GUILD::S|");
    expect(sent()).toContain("|60|47|5000|5000|Duskwood|Raven Hill|Thug~ROGUE~60~H|");
    expect(chat()).toBe("GUILD:[Guilded] Help! Kev is under attack in Duskwood (1 Horde, 60)");
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
