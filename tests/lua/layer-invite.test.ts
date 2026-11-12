import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

// Layer invite (Modules/LayerInvite.lua): one ask per helper, same-continent reach only, the first accept closes the request,
// nothing sent in combat, and the invite stays a copy-box line (the game refuses addon-sent invites on Forever).
let s: LuaSession | undefined;
afterEach(() => s?.close());

function setup(continent = 12) {
  s = newLuaSession();
  s.run(`CLOCK = 1000; CONTINENT = ${continent}; IN_COMBAT = false; SENT = {}; MSGS = {}; COPIED = {}; INV = {}; OPENED = {}
    GROUP = 1; INST = false
    function GetTime() return CLOCK end
    function GetServerTime() return 1800000000 + math.floor(CLOCK) end
    function UnitName(u) return "Kev" end
    function IsInGuild() return true end
    function IsInInstance() return INST end
    function IsInGroup() return GROUP > 1 end
    function GetNumGroupMembers() return GROUP end
    function GetRealZoneText() return "Elwynn Forest" end
    function InCombatLockdown() return IN_COMBAT end
    function InviteUnit(name) INV[#INV + 1] = name end
    function ChatFrame_OpenChat(line) OPENED[#OPENED + 1] = line end
    C_Map = { GetBestMapForUnit = function() return 37 end,
      GetMapInfo = function(id)
        if id == 37 then return { mapType = 3, parentMapID = CONTINENT } end
        return { mapType = 2, parentMapID = 946 }
      end }
    DB = {}; FR = {}; DIAG = ''; NS_LOG = nil
    local make = CreateFrame
    CreateFrame = function(kind, name, parent, template) local f = make(kind, name, parent, template); if name then FR[name] = f; local sp = f.SetPoint; f.SetPoint = function(self, ...) if type(self.pts) ~= "table" then self.pts = {} end; self.pts[#self.pts + 1] = { ... }; if sp then return sp(self, ...) end end end; return f end
    NS = { util = {}, commandHandlers = {}, commandHelp = {},
      message = function(text) MSGS[#MSGS + 1] = text end,
      isSecret = function() return false end,
      playerName = function() return "Kev" end,
      normalizeName = function(n) return n and (n:match("^[^-]+")) end,
      isGuildMember = function(n) return n ~= "Stranger" end,
      getDb = function() return DB end,
      logDiagnostic = function(kind, text) DIAG = DIAG .. text .. ';' end,
      comm = { register = function() end,
        accept = function(prefix, text, channel, sender, expected, authorize)
          if prefix ~= expected or type(text) ~= "string" or #text > 255 then return false end
          if authorize and authorize(sender, channel) ~= true then return false end
          return true
        end,
        send = function(prefix, text, channel, target, guard)
          if guard and not guard() then return false end
          SENT[#SENT + 1] = prefix .. ":" .. channel .. ":" .. text
          return true
        end } }`);
  // The real shared helpers (ns.util.inviteButton, inCombat, serverTime) on a scratch namespace so NS keeps its stubs.
  s.run("UTILNS = { message = function(text) return NS.message(text) end, showCopyText = function(text) COPIED[#COPIED + 1] = text end }");
  s.load("Util.lua", "UTILNS");
  s.run("for k, v in pairs(UTILNS.util) do NS.util[k] = v end; NS.showCopyText = UTILNS.showCopyText");
  s.load("Locale.lua");
  s.load("Modules/LayerInvite.lua");
  return s;
}
const sent = () => s!.run(`return table.concat(SENT, "\\n")`);
const sentCount = () => Number(s!.run(`return tostring(#SENT)`));
const msgs = () => s!.run(`return table.concat(MSGS, "\\n")`);
const heard = (sender: string, text: string) =>
  s!.run(`fire_event("CHAT_MSG_ADDON", "GuildedLayer", ${JSON.stringify(text)}, "GUILD", ${JSON.stringify(sender)})`);
const toastShown = () => s!.run(`return tostring(FR.GuildedLayerToast ~= nil and FR.GuildedLayerToast.isOpen == true)`);
const openList = () => s!.run(`local t = {} for _, r in ipairs(NS.layerInvite.openRequests()) do t[#t + 1] = r.name end return table.concat(t, ",")`);
const login = () => s!.run(`fire_event("PLAYER_LOGIN")`);

describe("layer invite: asking", () => {
  it("sends one request on the guild channel with my continent and zone, and no more within the pause", () => {
    setup(); login();
    expect(s!.run(`return tostring(NS.layerInvite.ask())`)).toBe("true");
    expect(sentCount()).toBe(1);
    expect(sent()).toMatch(/^GuildedLayer:GUILD:REQ\|\d+\|12\|Elwynn Forest$/);
    expect(s!.run(`return tostring(NS.layerInvite.ask())`)).toBe("false");
    expect(sentCount()).toBe(1);
    expect(msgs()).toContain("again in");
    s!.run(`CLOCK = CLOCK + 121`);
    expect(s!.run(`return tostring(NS.layerInvite.ask())`)).toBe("true");
    expect(sentCount()).toBe(2);
  });

  it("sends nothing in combat, in an instance, in a group or when the continent is unknown", () => {
    setup(); login();
    s!.run(`IN_COMBAT = true`);
    expect(s!.run(`return tostring(NS.layerInvite.ask())`)).toBe("false");
    s!.run(`IN_COMBAT = false; INST = true`);
    expect(s!.run(`return tostring(NS.layerInvite.ask())`)).toBe("false");
    s!.run(`INST = false; GROUP = 3`);
    expect(s!.run(`return tostring(NS.layerInvite.ask())`)).toBe("false");
    s!.run(`GROUP = 1; C_Map.GetBestMapForUnit = function() return nil end`);
    expect(s!.run(`return tostring(NS.layerInvite.ask())`)).toBe("false");
    expect(sentCount()).toBe(0);
  });

  it("the slash command asks, and cancel closes my request for everyone", () => {
    setup(); login();
    s!.run(`NS.commandHandlers.layer({ "layer" })`);
    expect(sentCount()).toBe(1);
    s!.run(`NS.commandHandlers.layer({ "layer", "cancel" })`);
    expect(sent()).toMatch(/GuildedLayer:GUILD:DONE\|\d+$/);
    s!.run(`NS.commandHandlers.layer({ "layer", "cancel" })`);
    expect(msgs()).toContain("no open layer request");
  });
});

describe("layer invite: a helper", () => {
  it("is asked only once per request and sees nothing from another continent", () => {
    setup(12); login();
    s!.run(`DB.layer = { helper = true }`);
    heard("Ann", "REQ|77|13|Stormwind");
    expect(toastShown()).toBe("false");
    expect(openList()).toBe("");
    heard("Bo", "REQ|78|12|Duskwood");
    
    expect(toastShown()).toBe("true");
    expect(openList()).toBe("Bo");
    // The same request again (a resend) never shows a second time, even after the helper closed the first.
    s!.run(`FR.GuildedLayerToast:Hide(); FR.GuildedLayerToast.isOpen = false`);
    heard("Bo", "REQ|78|12|Duskwood");
    expect(openList()).toBe("Bo");
    expect(toastShown()).toBe("false");
  });

  it("ignores my own echo and non-members and bad messages", () => {
    setup(12); login();
    s!.run(`DB.layer = { helper = true }`);
    heard("Kev", "REQ|1|12|Elwynn Forest");
    heard("Stranger", "REQ|2|12|Elwynn Forest");
    heard("Ann", "REQ|3|x|Elwynn Forest");
    heard("Ann", "REQ||12|Elwynn Forest");
    heard("Ann", "NONSENSE");
    expect(openList()).toBe("");
    expect(toastShown()).toBe("false");
  });

  it("asks a first-time helper once whether to help at all, and remembers No", () => {
    setup(12); login();
    heard("Ann", "REQ|5|12|Elwynn Forest");
    expect(s!.run(`return FR.GuildedLayerToast.mode`)).toBe("ask");
    s!.run(`FR.GuildedLayerToast.no:GetScript("OnClick")(FR.GuildedLayerToast.no)`);
    expect(s!.run(`return tostring(DB.layer.helper)`)).toBe("false");
    expect(toastShown()).toBe("false");
    heard("Bo", "REQ|6|12|Elwynn Forest");
    expect(toastShown()).toBe("false");
    expect(openList()).toBe("Ann,Bo");
  });

  it("does not show requests to a helper in a raid, in an instance or with a full party", () => {
    setup(12); login();
    s!.run(`DB.layer = { helper = true }; GROUP = 5`);
    heard("Ann", "REQ|5|12|Elwynn Forest");
    s!.run(`GROUP = 1; INST = true`);
    heard("Bo", "REQ|6|12|Elwynn Forest");
    expect(toastShown()).toBe("false");
  });

  it("in combat only prints one chat line: no toast, no message sent, nothing stolen from the keyboard", () => {
    setup(12); login();
    s!.run(`DB.layer = { helper = true }; IN_COMBAT = true`);
    heard("Ann", "REQ|5|12|Elwynn Forest");
    expect(toastShown()).toBe("false");
    expect(sentCount()).toBe(0);
    expect(msgs()).toContain("Ann wants another layer");
    s!.run(`IN_COMBAT = false; fire_event("PLAYER_REGEN_ENABLED")`);
    expect(openList()).toBe("Ann");
    // The queued request is not pushed on screen unasked after combat only once; claiming in combat sends nothing.
    s!.run(`IN_COMBAT = true`);
    expect(s!.run(`return tostring(NS.layerInvite.claim(NS.layerInvite.openRequests()[1]))`)).toBe("false");
    expect(sentCount()).toBe(0);
    // The refused send did not mark it claimed: it is still open.
    expect(openList()).toBe("Ann");
  });

  it("Invite shows the /invite line in the copy box and never calls the invite API or the chat box", () => {
    setup(12); login();
    s!.run(`DB.layer = { helper = true }`);
    heard("Ann", "REQ|5|12|Elwynn Forest");
    s!.run(`FR.GuildedLayerToast.invite:GetScript("OnClick")(FR.GuildedLayerToast.invite)`);
    expect(s!.run(`return COPIED[1]`)).toBe("/invite Ann");
    expect(s!.run(`return #INV .. "," .. #OPENED`)).toBe("0,0");
  });
});

describe("layer invite: the first accept closes the request", () => {
  it("the helper's click sends CLAIM, closes it for the helper and for every other helper who hears it", () => {
    setup(12); login();
    s!.run(`DB.layer = { helper = true }`);
    heard("Ann", "REQ|5|12|Elwynn Forest");
    s!.run(`FR.GuildedLayerToast.invite:GetScript("OnClick")(FR.GuildedLayerToast.invite)`);
    expect(sent()).toBe("GuildedLayer:GUILD:CLAIM|Ann|5|12");
    expect(openList()).toBe("");
    expect(toastShown()).toBe("false");
    // A second helper's toast for the same request closes when the first CLAIM arrives.
    setup(12); login();
    s!.run(`DB.layer = { helper = true }`);
    heard("Ann", "REQ|5|12|Elwynn Forest");
    expect(toastShown()).toBe("true");
    heard("Bo", "CLAIM|Ann|5|12");
    expect(toastShown()).toBe("false");
    expect(openList()).toBe("");
    // A late claim from a helper who did not hear it is refused locally once the request is no longer open.
    expect(s!.run(`return tostring(NS.layerInvite.claim({ name = "Ann", id = "5", state = "claimed" }))`)).toBe("false");
  });

  it("the asker is told who will invite them, and the request closes once they are in the group", () => {
    setup(12); login();
    s!.run(`NS.layerInvite.ask()`);
    const id = s!.run(`return NS.layerInvite.myRequest().id`);
    heard("Bo", `CLAIM|Kev|${id}|12`);
    expect(msgs()).toContain("Bo will invite you");
    // Someone else's claim for a different request does not count.
    heard("Cy", "CLAIM|Kev|nope|12");
    expect(s!.run(`return NS.layerInvite.myRequest().claimedBy`)).toBe("Bo");
    s!.run(`GROUP = 2; fire_event("GROUP_ROSTER_UPDATE")`);
    expect(msgs()).toContain("type /leave");
    expect(s!.run(`return tostring(NS.layerInvite.myRequest())`)).toBe("nil");
    expect(sent()).toMatch(/DONE\|\d+$/);
  });

  it("a request and a claim run out on their own", () => {
    setup(12); login();
    s!.run(`DB.layer = { helper = true }`);
    heard("Ann", "REQ|5|12|Elwynn Forest");
    s!.run(`CLOCK = CLOCK + 301; NS.layerInvite.tick()`);
    expect(openList()).toBe("");
    s!.run(`CLOCK = CLOCK + 200; NS.layerInvite.ask()`);
    s!.run(`CLOCK = CLOCK + 301; NS.layerInvite.tick()`);
    expect(msgs()).toContain("expired");
    expect(s!.run(`return tostring(NS.layerInvite.myRequest())`)).toBe("nil");
  });
});

describe("layer invite: receiver-side limits", () => {
  it("ignores a second request from the same sender within the pause, whatever the id", () => {
    setup(12); login();
    s!.run(`DB.layer = { helper = true }`);
    heard("Ann", "REQ|1|12|Elwynn Forest");
    heard("Ann", "REQ|2|12|Elwynn Forest");
    heard("Ann", "REQ|3|12|Elwynn Forest");
    expect(s!.run(`return #NS.layerInvite.openRequests()`)).toBe("1");
    s!.run(`CLOCK = CLOCK + 121`);
    heard("Ann", "REQ|4|12|Elwynn Forest");
    expect(s!.run(`return #NS.layerInvite.openRequests()`)).toBe("2");
  });

  it("bounds what it remembers and what it queues", () => {
    setup(12); login();
    s!.run(`DB.layer = { helper = true }`);
    for (let i = 0; i < 150; i++) heard(`P${i}`, `REQ|${i}|99|Somewhere`);
    expect(s!.run(`local seen = NS.layerInvite.counts(); return seen`)).toBe("100");
    setup(12); login();
    s!.run(`DB.layer = { helper = true }`);
    for (let i = 0; i < 12; i++) heard(`Q${i}`, `REQ|${i}|12|Elwynn Forest`);
    expect(s!.run(`local _, waiting = NS.layerInvite.counts(); return waiting`)).toBe("5");
  });

  it("does not lose a request when the continent cannot be read yet", () => {
    setup(12); login();
    s!.run(`DB.layer = { helper = true }; REAL = C_Map.GetBestMapForUnit; C_Map.GetBestMapForUnit = function() return nil end`);
    heard("Ann", "REQ|1|12|Elwynn Forest");
    expect(openList()).toBe("");
    s!.run(`C_Map.GetBestMapForUnit = REAL`);
    heard("Ann", "REQ|1|12|Elwynn Forest");
    expect(openList()).toBe("Ann");
    expect(toastShown()).toBe("true");
  });
});

describe("layer invite: CLAIM rules", () => {
  it("does nothing for a request this client does not hold, from the asker, or from a non-member", () => {
    setup(12); login();
    s!.run(`DB.layer = { helper = true }`);
    heard("Ann", "REQ|5|12|Elwynn Forest");
    heard("Ann", "CLAIM|Ann|5|12");
    heard("Bo", "CLAIM|Zed|9|12");
    heard("Bo", "CLAIM|Ann|6|12");
    heard("Stranger", "CLAIM|Ann|5|12");
    expect(openList()).toBe("Ann");
    expect(toastShown()).toBe("true");
  });

  it("the asker accepts only the first claim, from a guildmate on the same continent", () => {
    setup(12); login();
    s!.run(`NS.layerInvite.ask()`);
    const id = s!.run(`return NS.layerInvite.myRequest().id`);
    heard("Kev", `CLAIM|Kev|${id}|12`);
    heard("Stranger", `CLAIM|Kev|${id}|12`);
    heard("Bo", `CLAIM|Kev|${id}|13`);
    expect(s!.run(`return tostring(NS.layerInvite.myRequest().claimedBy)`)).toBe("nil");
    heard("Cy", `CLAIM|Kev|${id}|12`);
    heard("Dee", `CLAIM|Kev|${id}|12`);
    expect(s!.run(`return NS.layerInvite.myRequest().claimedBy`)).toBe("Cy");
  });
});

describe("layer invite: combat and placement", () => {
  it("hides the window when combat starts and brings it back after, if the request is still open", () => {
    setup(12); login();
    s!.run(`DB.layer = { helper = true }`);
    heard("Ann", "REQ|5|12|Elwynn Forest");
    expect(toastShown()).toBe("true");
    s!.run(`IN_COMBAT = true; fire_event("PLAYER_REGEN_DISABLED")`);
    expect(toastShown()).toBe("false");
    s!.run(`IN_COMBAT = false; fire_event("PLAYER_REGEN_ENABLED")`);
    expect(toastShown()).toBe("true");
    // A claim heard during the fight keeps it gone.
    s!.run(`IN_COMBAT = true; fire_event("PLAYER_REGEN_DISABLED")`);
    heard("Bo", "CLAIM|Ann|5|12");
    s!.run(`IN_COMBAT = false; fire_event("PLAYER_REGEN_ENABLED")`);
    expect(toastShown()).toBe("false");
  });

  it("hangs below the call-for-help toast's box when that exists", () => {
    setup(12); login();
    s!.run(`DB.layer = { helper = true }; CFH = CreateFrame("Frame"); NS.callForHelp = { footprint = function() return CFH end }`);
    heard("Ann", "REQ|5|12|Elwynn Forest");
    expect(s!.run(`local p = FR.GuildedLayerToast.pts; local last = p[#p]; return tostring(last[1]) .. ":" .. tostring(last[2] == CFH) .. ":" .. tostring(last[3])`)).toBe("TOPLEFT:true:BOTTOMLEFT");
  });
});

describe("layer invite: the old levelling partners module", () => {
  it("is gone: no module table, and the lane is low value", () => {
    setup();
    expect(s!.run(`return type(NS.levelPartners)`)).toBe("nil");
    expect(s!.run(`return type(NS.layerInvite.ask)`)).toBe("function");
  });
});
