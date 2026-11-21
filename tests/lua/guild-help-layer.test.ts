import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

// 9.5: the call for help and the layer swap work together (Modules/CallForHelp.lua + Modules/LayerInvite.lua loaded side by side):
// On my way asks for an invite to the caller's group, the caller (or the guildmate who leads the caller's party) invites at the
// first moment it is out of combat, one window carries calls and layer requests, one switch (Help guildmates), and the quick
// layer swap stays without any call for help.
let s: LuaSession | undefined;
afterEach(() => s?.close());

const goodCall = "S|42|58|47|2500|3000|Duskwood|Raven Hill|Thug~ROGUE~60~H;Bo~MAGE~58~H|1800000100";

function setup() {
  s = newLuaSession();
  s.run(`CLOCK = 1000; CONTINENT = 12; IN_COMBAT = false; SENT = {}; CHAT_OUT = {}; MSGS = {}; COPIED = {}; INV = {}; LEFT = 0; CONVERTED = 0; BLOCK = nil
    GROUP = 1; LEADER = true; RAID = false; INST = false; PARTY = {}; ZONE = "Duskwood"; MAP = { 47, 0.5, 0.5 }
    function GetTime() return CLOCK end
    function GetServerTime() return 1800000000 + math.floor(CLOCK) end
    function UnitName(u) if u == "player" then return "Kev" end; local n = u:match("^party(%d)$"); return n and PARTY[tonumber(n)] or nil end
    function UnitLevel() return 60 end
    function UnitClass() return "Rogue", "ROGUE" end
    function UnitFactionGroup() return "Horde" end
    function GetRealZoneText() return ZONE end
    function GetSubZoneText() return "Raven Hill" end
    function IsInGuild() return true end
    function IsInInstance() return INST end
    function IsInGroup() return GROUP > 1 end
    function IsInRaid() return RAID end
    function GetNumGroupMembers() return GROUP end
    function UnitIsGroupLeader() return LEADER end
    function UnitIsGroupAssistant() return false end
    function InCombatLockdown() return IN_COMBAT end
    function PlaySound() end
    function SendChatMessage(text, channel, _, target) CHAT_OUT[#CHAT_OUT + 1] = (target and (target .. ":") or "") .. channel .. ":" .. text end
    C_PartyInfo = { InviteUnit = function(name) INV[#INV + 1] = name end,
      LeaveParty = function() LEFT = LEFT + 1 end,
      ConvertToRaid = function() CONVERTED = CONVERTED + 1; RAID = true end }
    C_Map = { GetBestMapForUnit = function() return 37 end,
      GetMapInfo = function(id)
        if id == 37 then return { mapType = 3, parentMapID = CONTINENT } end
        return { mapType = 2, parentMapID = 946 }
      end }
    DB = {}; SETTINGS = {}
    local make = CreateFrame
    FR = {}
    CreateFrame = function(kind, name, parent, template) local f = make(kind, name, parent, template); if name then FR[name] = f end; return f end
    NS = { util = {}, commandHandlers = {}, commandHelp = {},
      message = function(text) MSGS[#MSGS + 1] = text end,
      isSecret = function() return false end,
      playerName = function() return "Kev" end,
      normalizeName = function(n) return n and (n:match("^[^-]+")) end,
      isGuildMember = function(n) return n ~= "Stranger" end,
      getDb = function() return DB end,
      getSettings = function() return SETTINGS end,
      guildMap = { members = {}, myPosition = function() if MAP then return MAP[1], MAP[2], MAP[3] end end, refresh = function() end },
      logDiagnostic = function() end,
      comm = { register = function() end,
        accept = function(prefix, text, channel, sender, expected, authorize)
          if prefix ~= expected or type(text) ~= "string" or #text > 255 then return false end
          if authorize and authorize(sender, channel) ~= true then return false end
          return true
        end,
        send = function(prefix, text, channel, target, guard)
          if guard and not guard() then return false end
          SENT[#SENT + 1] = prefix .. ":" .. channel .. ":" .. (target or "") .. ":" .. text
          return true
        end } }
    function UPDATE(seconds) CLOCK = CLOCK + seconds; for _, f in ipairs(FRAMES) do if f.scripts.OnUpdate then f.scripts.OnUpdate(f, 1.5) end end end`);
  s.run("UTILNS = { message = function(text) return NS.message(text) end, showCopyText = function(text) COPIED[#COPIED + 1] = text end }");
  s.load("Util.lua", "UTILNS");
  s.run("for k, v in pairs(UTILNS.util) do NS.util[k] = v end; NS.showCopyText = UTILNS.showCopyText");
  s.load("Locale.lua");
  s.load("Modules/CallForHelp.lua");
  s.load("Modules/LayerInvite.lua");
  s.run(`fire_event("PLAYER_LOGIN")`);
  return s;
}
const run = (code: string) => s!.run(code);
const sent = () => run(`return table.concat(SENT, "\\n")`);
const invites = () => run(`return table.concat(INV, ",")`);
const msgs = () => run(`return table.concat(MSGS, "\\n")`);
const callFrom = (sender: string, text = goodCall, channel = "GUILD") =>
  run(`return NS.callForHelp.receive(${JSON.stringify(text)}, ${JSON.stringify(sender)}, ${JSON.stringify(channel)})`);
const heard = (sender: string, text: string) =>
  run(`fire_event("CHAT_MSG_ADDON", "GuildedLayer", ${JSON.stringify(text)}, "GUILD", ${JSON.stringify(sender)})`);
const notice = () => run(`return tostring(NS.callForHelp.noticeText())`);
const noticeClick = () => run(`local b = NS.callForHelp.host().noteBtn; b.scripts.OnClick(b)`);
const noticeLabel = () => run(`return tostring(NS.callForHelp.noticeAction())`);
const regen = () => run(`IN_COMBAT = false; fire_event("PLAYER_REGEN_ENABLED")`);

describe("on my way: join the caller's layer", () => {
  it("sends a JOIN targeted at the caller with the call id, next to the usual reply", () => {
    setup();
    expect(callFrom("Bob-Realm")).toBe("banner");
    run(`NS.callForHelp.reply(true)`);
    expect(sent()).toContain("GuildedSOS:WHISPER:Bob-Realm:R|42|Y");
    expect(sent()).toMatch(/GuildedLayer:GUILD::JOIN\|\d+\|12\|42\|Bob/);
    expect(notice()).toContain("Asking Bob");
    // The old Join whisper is only a fallback: its button waits 15 s for an invite.
    expect(noticeLabel()).not.toBe("Ask by whisper");
    run(`UPDATE(16)`);
    expect(noticeLabel()).toBe("Ask by whisper");
  });

  it("Can't sends no JOIN", () => {
    setup();
    callFrom("Bob-Realm");
    run(`NS.callForHelp.reply(false)`);
    expect(sent()).not.toContain("JOIN|");
  });

  it("sends the JOIN after the fight when the defender is in combat", () => {
    setup();
    callFrom("Bob-Realm");
    run(`IN_COMBAT = true`);
    run(`NS.callForHelp.reply(true)`);
    expect(sent()).not.toContain("JOIN|");
    regen();
    expect(sent()).toMatch(/JOIN\|\d+\|12\|42\|Bob/);
  });

  it("the caller invites only after combat ends, only for its own call, and tells the others (CLAIM)", () => {
    setup();
    run(`IN_COMBAT = true; NS.callForHelp.open()`);
    expect(run(`return tostring(NS.callForHelp.myCallId() ~= nil)`)).toBe("true");
    const id = run(`return NS.callForHelp.myCallId()`);
    heard("Dee-Realm", `JOIN|7|12|${id}|Kev`);
    expect(invites()).toBe("");                    // in combat: nothing, not even a refusal
    regen();
    expect(invites()).toBe("Dee");
    expect(sent()).toContain("CLAIM|Dee|7|12");
    // Someone else's call id, another continent, or a stranger's target: never invited.
    heard("Eve-Realm", "JOIN|8|12|99999|Kev");
    heard("Fay-Realm", `JOIN|9|13|${id}|Kev`);
    heard("Gus-Realm", `JOIN|10|12|${id}|Nobody`);
    run(`CLOCK = CLOCK + 30; NS.layerInvite.tick()`);
    expect(invites()).toBe("Dee");
  });

  it("without my own open call a JOIN naming me does nothing", () => {
    setup();
    heard("Dee-Realm", "JOIN|7|12|42|Kev");
    expect(invites()).toBe("");
  });

  it("one invite at a time, ten seconds apart, and no invite in an instance", () => {
    setup();
    run(`NS.callForHelp.open()`);
    const id = run(`return NS.callForHelp.myCallId()`);
    run(`INST = true`);
    heard("Dee-Realm", `JOIN|7|12|${id}|Kev`);
    expect(invites()).toBe("");
    run(`INST = false`);
    heard("Ann-Realm", `JOIN|8|12|${id}|Kev`);
    expect(invites()).toBe("Dee");
    run(`GROUP = 1`);
    run(`CLOCK = CLOCK + 5; NS.layerInvite.tick()`);
    expect(invites()).toBe("Dee");
    run(`CLOCK = CLOCK + 6; NS.layerInvite.tick()`);
    expect(invites()).toBe("Dee,Ann");
  });

  it("a guildmate who leads the caller's party invites instead of the caller", () => {
    setup();
    // I am Kev, leader of a group that holds Bob, who called for help (I heard the call).
    run(`GROUP = 3; LEADER = true; PARTY = { "Bob", "Cy" }`);
    callFrom("Bob-Realm");
    heard("Dee-Realm", "JOIN|7|12|42|Bob");
    expect(invites()).toBe("Dee");
    expect(sent()).toContain("CLAIM|Dee|7|12");
  });

  it("a member who is not the leader never invites for someone else's call, and the caller in another's group does not either", () => {
    setup();
    run(`GROUP = 3; LEADER = false; PARTY = { "Bob", "Cy" }`);
    callFrom("Bob-Realm");
    heard("Dee-Realm", "JOIN|7|12|42|Bob");
    expect(invites()).toBe("");
    // The caller in a group led by someone else: canPartyInvite is false, the leader's addon does it.
    run(`NS.callForHelp.open()`);
    const id = run(`return NS.callForHelp.myCallId()`);
    heard("Eve-Realm", `JOIN|8|12|${id}|Kev`);
    expect(invites()).toBe("");
  });

  it("a call never heard here is not trusted: the leader needs the call it heard", () => {
    setup();
    run(`GROUP = 3; LEADER = true; PARTY = { "Bob", "Cy" }`);
    heard("Dee-Realm", "JOIN|7|12|42|Bob");
    expect(invites()).toBe("");
  });

  it("a full party shows the leader a Convert to raid button, tells the defender once and never converts by itself", () => {
    setup();
    run(`NS.callForHelp.open()`);
    const id = run(`return NS.callForHelp.myCallId()`);
    run(`GROUP = 5; LEADER = true; PARTY = { "A", "B", "C", "D" }`);
    heard("Dee-Realm", `JOIN|7|12|${id}|Kev`);
    expect(invites()).toBe("");
    expect(sent()).toContain("FULL|Dee|7|12");
    expect(notice()).toContain("Group full");
    expect(noticeLabel()).toBe("Convert to raid");
    run(`CLOCK = CLOCK + 3; NS.layerInvite.tick()`);
    expect(run(`return CONVERTED`)).toBe("0");
    expect(sent().split("FULL|").length).toBe(2);   // one line only
    noticeClick();
    expect(run(`return CONVERTED`)).toBe("1");
    // Now a raid: the leader keeps inviting.
    run(`CLOCK = CLOCK + 3; NS.layerInvite.tick()`);
    expect(invites()).toBe("Dee");
  });

  it("the defender gets one chat line when the group is full", () => {
    setup();
    callFrom("Bob-Realm");
    run(`NS.callForHelp.reply(true)`);
    const id = run(`return NS.layerInvite.myJoin().id`);
    heard("Bob-Realm", `FULL|Kev|${id}|12`);
    heard("Bob-Realm", `FULL|Kev|${id}|12`);
    expect(msgs().split("is full").length).toBe(2);
  });

  it("a CLAIM from the caller's side tells the defender to accept, in the same window", () => {
    setup();
    callFrom("Bob-Realm");
    run(`NS.callForHelp.reply(true)`);
    const id = run(`return NS.layerInvite.myJoin().id`);
    heard("Bob-Realm", `CLAIM|Kev|${id}|12`);
    expect(notice()).toContain("is inviting you");
  });
});

describe("all clear: Leave group", () => {
  it("a responder in a group sees Leave group on the caller's all clear; the click leaves, nothing leaves by itself", () => {
    setup();
    callFrom("Bob-Realm");
    run(`NS.callForHelp.reply(true); GROUP = 2`);
    run(`NS.callForHelp.receive("C|42", "Bob-Realm", "GUILD")`);
    expect(noticeLabel()).toBe("Leave group");
    expect(run(`return LEFT`)).toBe("0");
    noticeClick();
    expect(run(`return LEFT`)).toBe("1");
    expect(notice()).toBe("nil");
  });

  it("the caller who invited someone sees it on its own all clear", () => {
    setup();
    run(`NS.callForHelp.open()`);
    const id = run(`return NS.callForHelp.myCallId()`);
    heard("Dee-Realm", `JOIN|7|12|${id}|Kev`);
    expect(invites()).toBe("Dee");
    run(`GROUP = 2; NS.callForHelp.allClear()`);
    expect(noticeLabel()).toBe("Leave group");
  });

  it("a refusal from the game is remembered for the build and shows the hint instead", () => {
    setup();
    callFrom("Bob-Realm");
    run(`NS.callForHelp.reply(true); GROUP = 2`);
    run(`NS.callForHelp.receive("C|42", "Bob-Realm", "GUILD")`);
    noticeClick();
    run(`fire_event("ADDON_ACTION_BLOCKED", "Guilded", "LeaveParty")`);
    expect(run(`return tostring(DB.layer.groupRefused.leave ~= nil)`)).toBe("true");
    run(`MSGS = {}; LEFT = 0`);
    run(`NS.layerInvite.leaveGroup()`);
    expect(run(`return LEFT`)).toBe("0");
    expect(msgs()).toContain("Type /leave");
  });

  it("no Leave group for a player who is not in a group", () => {
    setup();
    callFrom("Bob-Realm");
    run(`NS.callForHelp.reply(true); GROUP = 1`);
    run(`NS.callForHelp.receive("C|42", "Bob-Realm", "GUILD")`);
    expect(noticeLabel()).not.toBe("Leave group");
  });
});

describe("one window", () => {
  it("a call and a layer request share one window: the call first, the request below, one close", () => {
    setup();
    expect(callFrom("Bob-Realm")).toBe("banner");
    heard("Ann", "REQ|5|12|Elwynn Forest");
    const w = run(`local host = NS.callForHelp.host(); return table.concat({ tostring(host.isOpen), tostring(host.callOpen), tostring(FR.GuildedLayerToast.hosted), tostring(FR.GuildedLayerToast.isOpen), tostring(host.h) }, ",")`);
    expect(w).toBe("true,true,true,true,138");           // 82 call + 52 layer + 4
    expect(Number(w.split(",")[4])).toBeLessThanOrEqual(140);
    // The X closes both.
    run(`NS.callForHelp.dismiss()`);
    expect(run(`local host = NS.callForHelp.host(); return tostring(host.isOpen) .. tostring(FR.GuildedLayerToast.isOpen)`)).toBe("falsefalse");
  });

  it("a layer request alone opens the window, and it hides again by itself", () => {
    setup();
    heard("Ann", "REQ|5|12|Elwynn Forest");
    expect(run(`return tostring(NS.callForHelp.host().isOpen) .. ":" .. NS.callForHelp.host().h`)).toBe("true:84");
    run(`UPDATE(31); NS.layerInvite.tick()`);
    expect(run(`return tostring(NS.callForHelp.host().isOpen)`)).toBe("false");
  });

  it("nothing pops up for a layer request when Help guildmates is off, in combat or in an instance", () => {
    setup();
    run(`NS.commandHandlers.sos({ "guildmates", "off" })`);
    heard("Ann", "REQ|5|12|Elwynn Forest");
    expect(run(`return tostring(FR.GuildedLayerToast ~= nil and FR.GuildedLayerToast.isOpen)`)).toBe("false");
    run(`NS.commandHandlers.sos({ "guildmates", "on" }); IN_COMBAT = true`);
    heard("Bo", "REQ|6|12|Elwynn Forest");
    expect(run(`return tostring(FR.GuildedLayerToast ~= nil and FR.GuildedLayerToast.isOpen)`)).toBe("false");
    expect(msgs()).toContain("Bo wants another layer");     // one chat line
    run(`IN_COMBAT = false; INST = true`);
    heard("Cy", "REQ|7|12|Elwynn Forest");
    expect(run(`return tostring(FR.GuildedLayerToast ~= nil and FR.GuildedLayerToast.isOpen)`)).toBe("false");
  });

  it("a notice in combat is one chat line, no window", () => {
    setup();
    run(`IN_COMBAT = true`);
    expect(run(`return tostring(NS.callForHelp.notice("Hello there", "Click", function() end, 10))`)).toBe("false");
    expect(msgs()).toContain("Hello there");
    expect(run(`return tostring(NS.callForHelp.host().isOpen)`)).toBe("false");
  });
});

describe("Help guildmates: one setting", () => {
  it("is on by default", () => {
    setup();
    expect(run(`return tostring(NS.callForHelp.helpGuildmates()) .. tostring(NS.layerInvite.helper())`)).toBe("truetrue");
  });

  it("starts off when either old switch was explicitly off", () => {
    setup();
    run(`SETTINGS.helpDefender = false`);
    expect(run(`return tostring(NS.callForHelp.helpGuildmates()) .. tostring(NS.layerInvite.helper())`)).toBe("falsefalse");
    run(`SETTINGS = { }; DB.layer = { helper = false }`);
    expect(run(`return tostring(NS.callForHelp.helpGuildmates())`)).toBe("false");
    // Explicitly set once, the new value wins.
    run(`NS.callForHelp.setHelpGuildmates(true)`);
    expect(run(`return tostring(NS.callForHelp.helpGuildmates()) .. tostring(DB.layer.helper) .. tostring(SETTINGS.helpDefender)`)).toBe("truetruetrue");
  });

  it("the old commands are aliases and keep the old saved values in step", () => {
    setup();
    run(`NS.commandHandlers.sos({ "defender", "off" })`);
    expect(run(`return tostring(NS.layerInvite.helper()) .. tostring(DB.layer.helper) .. tostring(SETTINGS.helpGuildmates)`)).toBe("falsefalsefalse");
    run(`NS.commandHandlers.layer({ "helper", "on" })`);
    expect(run(`return tostring(NS.callForHelp.helpGuildmates()) .. tostring(SETTINGS.helpDefender)`)).toBe("truetrue");
    run(`NS.commandHandlers.layer({ "helper", "off" })`);
    expect(run(`return tostring(NS.callForHelp.defender())`)).toBe("false");
  });

  it("off: a call in my zone is one chat line, no window", () => {
    setup();
    run(`NS.commandHandlers.sos({ "defender", "off" })`);
    expect(callFrom("Bob-Realm")).toBe("line");
  });

  it("the opt-in auto-invite for plain layer requests stays separate and off by default", () => {
    setup();
    expect(run(`return tostring(NS.layerInvite.autoInvite())`)).toBe("false");
    heard("Ann", "REQ|5|12|Elwynn Forest");
    expect(invites()).toBe("");
    run(`NS.callForHelp.dismiss(); NS.layerInvite.setAutoInvite(true)`);
    heard("Bo", "REQ|6|12|Elwynn Forest");
    expect(invites()).toBe("Bo");
  });
});

describe("the quick layer swap without a call for help", () => {
  it("the key binding function asks for a layer, with no call open", () => {
    setup();
    expect(run(`return tostring(NS.callForHelp.myCallId())`)).toBe("nil");
    run(`Guilded_AskForLayer()`);
    expect(sent()).toMatch(/GuildedLayer:GUILD::REQ\|\d+\|12\|Duskwood/);
    expect(run(`return BINDING_NAME_GUILDED_ASK_LAYER`)).toBe("Ask for a layer invite");
  });

  it("is declared next to Call for help in Bindings.xml, and /guilded layer still asks", () => {
    const xml = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "addon", "Guilded", "Bindings.xml"), "utf8");
    expect(xml).toContain('name="GUILDED_CALL_FOR_HELP"');
    expect(xml).toMatch(/name="GUILDED_ASK_LAYER"[^>]*>\s*Guilded_AskForLayer\(\)/);
    setup();
    run(`NS.commandHandlers.layer({})`);
    expect(sent()).toMatch(/REQ\|/);
  });
});

describe("older addons (9.4.4 formats)", () => {
  it("a plain REQ from an older addon still shows in the window, and its CLAIM and DONE still close it", () => {
    setup();
    heard("Ann", "REQ|5|12|Elwynn Forest");
    expect(run(`return tostring(FR.GuildedLayerToast.isOpen)`)).toBe("true");
    heard("Bo", "CLAIM|Ann|5|12");
    expect(run(`return tostring(FR.GuildedLayerToast.isOpen)`)).toBe("false");
  });

  it("an old call (S|... with ten fields) is understood, and unknown kinds are ignored", () => {
    setup();
    expect(callFrom("Bob-Realm")).toBe("banner");
    heard("Bob-Realm", "NEWKIND|1|2|3|4|5|6");
    heard("Bob-Realm", "JOIN|short");
    expect(invites()).toBe("");
  });

  it("our own S message keeps its ten fields, so older addons still decode it", () => {
    setup();
    run(`NS.callForHelp.open()`);
    const line = sent().split("\n").find((l) => l.startsWith("GuildedSOS:GUILD::S|"))!;
    expect((line.split(":GUILD::")[1] ?? "").split("|")).toHaveLength(10);
  });
});

describe("French and the key binding", () => {
  it("translates the new texts", () => {
    setup();
    run(`NS.getSettings().language = "fr"`);
    expect(run(`return NS.L("Leave group")`)).toBe("Quitter le groupe");
    expect(run(`return NS.L("Guild calls")`)).toBe("Appels de la guilde");
  });
});
