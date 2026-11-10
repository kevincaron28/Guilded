import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

// Levelling partners (Modules/LevelPartners.lua): online guildmates within 3 levels, Whisper and Invite.
let s: LuaSession | undefined;
afterEach(() => s?.close());

function setup(level = 30) {
  s = newLuaSession();
  s.run(`LEVEL = ${level}; ZONE = "Duskwood"; MSGS = {}; INVITES = {}; TELLS = {}
    function UnitName(u) return "Kev" end
    function UnitLevel() return LEVEL end
    function GetMaxPlayerLevel() return 60 end
    function GetRealZoneText() return ZONE end
    function IsInGuild() return true end
    function InviteUnit(name) INVITES[#INVITES + 1] = name end
    IN_COMBAT = false
    function InCombatLockdown() return IN_COMBAT end
    COPIED = {}; TITLES = {}; OPENED = {}
    -- Spy: an Invite click must never open the game chat box (the Whisper button uses ChatFrame_SendTell).
    function ChatFrame_OpenChat(line) OPENED[#OPENED + 1] = line end
    local make = CreateFrame
    CreateFrame = function(kind, name, parent, template)
      local f = make(kind, name, parent, template)
      f.template = template
      return f
    end
    function ChatFrame_SendTell(name) TELLS[#TELLS + 1] = name end
    ROSTER = {
      { "Kev", 30, "ROGUE", "Duskwood", true }, { "Ann-Realm", 31, "MAGE", "Redridge Mountains", true },
      { "Bo-Realm", 30, "WARRIOR", "Duskwood", true }, { "Cy-Realm", 33, "PRIEST", "Duskwood", true },
      { "Dee-Realm", 34, "HUNTER", "Duskwood", true }, { "Eve-Realm", 29, "ROGUE", "Elwynn Forest", true },
      { "Fay-Realm", 30, "DRUID", "Duskwood", false }, { "Gus-Realm", 28, "MAGE", "Duskwood", true },
      { "Hal-Realm", 28, "MAGE", "Redridge Mountains", true } }
    function GetNumGuildMembers() return #ROSTER end
    function GetGuildRosterInfo(i) local r = ROSTER[i]; return r[1], "Member", 3, r[2], r[3], r[4], "", "", r[5], 0, r[3] end
    NS = { util = {}, commandHandlers = {}, commandHelp = {},
      message = function(text) MSGS[#MSGS + 1] = text end,
      showCopyText = function(text, title) COPIED[#COPIED + 1] = text; TITLES[#TITLES + 1] = title end,
      isSecret = function() return false end,
      playerName = function() return "Kev" end,
      normalizeName = function(n) return n and (n:match("^[^-]+")) end }`);
  s.load("Locale.lua");
  s.load("Modules/LevelPartners.lua");
  return s;
}
const names = () => s!.run(`local t = {} for _, p in ipairs(NS.levelPartners.partners()) do t[#t + 1] = p.name end return table.concat(t, ",")`);
const msgs = () => s!.run(`return table.concat(MSGS, " | ")`);

describe("levelling partners", () => {
  it("lists online guildmates within 3 levels, closest level first then same zone, never me or offline", () => {
    setup();
    // diff 0: Bo (Duskwood); diff 1: Eve (Elwynn) and Ann (Redridge), Eve before Ann by name; diff 2: Gus (Duskwood) before Hal;
    // diff 3: Cy. Dee is 4 away and Fay is offline.
    expect(names()).toBe("Bo-Realm,Ann-Realm,Eve-Realm,Gus-Realm,Hal-Realm,Cy-Realm");
  });

  it("puts a guildmate in my zone before one of the same level elsewhere", () => {
    setup();
    s!.run(`ROSTER[2][2] = 30; ROSTER[2][4] = "Elwynn Forest"; ROSTER[3][4] = "Elwynn Forest"; ROSTER[6][2] = 30; ROSTER[6][4] = "Duskwood"`);
    expect(names().split(",").slice(0, 3)).toEqual(["Eve-Realm", "Ann-Realm", "Bo-Realm"]);
  });

  it("caps the list at eight", () => {
    setup();
    s!.run(`for i = 1, 10 do ROSTER[#ROSTER + 1] = { "Extra" .. i .. "-Realm", 30, "MAGE", "Duskwood", true } end`);
    expect(s!.run(`return tostring(#NS.levelPartners.partners())`)).toBe("8");
  });

  it("is hidden at the top level", () => {
    setup(60);
    expect(s!.run(`return tostring(NS.levelPartners.available())`)).toBe("false");
    expect(names()).toBe("");
    expect(s!.run(`return tostring(NS.levelPartners.open())`)).toBe("false");
    expect(msgs()).toContain("top level");
  });

  it("opens the window while levelling and fills a row per partner", () => {
    setup();
    expect(s!.run(`return tostring(NS.levelPartners.open())`)).toBe("true");
    expect(s!.run(`return tostring(NS.levelPartners.refresh())`)).toBe("6");
  });

  // The Invite buttons (frames with setInvite/inviteLine; the test frames answer any method, so rawget) and their lines.
  const buttons = `local function buttons() local t = {} for _, f in ipairs(FRAMES) do if rawget(f, "inviteLine") then t[#t + 1] = f end end return t end `;
  const lines = () => s!.run(buttons + `local t = {} for _, f in ipairs(buttons()) do local l = f.inviteLine() if l then t[#t + 1] = l end end table.sort(t) return table.concat(t, "|")`);
  const click = (line: string) => s!.run(buttons + `for _, f in ipairs(buttons()) do if f.inviteLine() == "${line}" then f.scripts.OnClick(f) return end end error("no button for ${line}")`);

  it("whispers and invites only on a click", () => {
    setup();
    expect(msgs()).toBe("");
    expect(s!.run(`return tostring(NS.levelPartners.whisper("Bo-Realm"))`)).toBe("true");
    expect(s!.run(`return table.concat(TELLS, ",")`)).toBe("Bo-Realm");
    expect(msgs()).toBe("");
    // invited() only runs after the button's click: it prints and shows nothing by itself.
    expect(s!.run(`return tostring(NS.levelPartners.invited("Bo"))`)).toBe("true");
    expect(msgs()).toBe("");
    expect(s!.run(`return #COPIED`)).toBe("0");
    s!.run(`NS.levelPartners.open()`);
    click("/invite Bo");
    expect(s!.run(`return #COPIED .. COPIED[1]`)).toBe("1/invite Bo");
    expect(s!.run(`return TITLES[1]`)).toBe("Copy with Ctrl+C, then paste in chat");
    expect(s!.run(`return #OPENED`)).toBe("0");
    expect(msgs()).toBe("Copy /invite Bo (Ctrl+C), paste it in your chat box (Ctrl+V) and press Enter.");
    expect(s!.run(`return table.concat(INVITES, ",")`)).toBe("");   // the invite API is never called from addon code
  });

  it("tells the player which line to type when there is no copy box", () => {
    setup();
    s!.run(`NS.showCopyText = nil; NS.levelPartners.open()`);
    click("/invite Cy");
    expect(msgs()).toBe("Type /invite Cy to invite them.");
    expect(s!.run(`return #OPENED`)).toBe("0");
    expect(s!.run(`return table.concat(INVITES, ",")`)).toBe("");
  });

  it("makes every Invite button a plain /invite button that shows the copy box, rows refreshed after combat", () => {
    setup();
    s!.run(`NS.levelPartners.open()`);
    expect(lines()).toBe("/invite Ann|/invite Bo|/invite Cy|/invite Eve|/invite Gus|/invite Hal");
    expect(s!.run(buttons + `local n, bad = 0, 0 for _, f in ipairs(buttons()) do if f.inviteLine() then n = n + 1 if f.template ~= "UIPanelButtonTemplate" then bad = bad + 1 end end end return n .. ":" .. bad`)).toBe("6:0");
    s!.run(`IN_COMBAT = true; ROSTER[3][1] = "Zed-Realm"`);
    s!.run(`NS.levelPartners.refresh()`);
    expect(lines()).toContain("/invite Bo");
    click("/invite Bo");   // plain buttons: a click in combat still shows the copy box
    expect(s!.run(`return COPIED[#COPIED]`)).toBe("/invite Bo");
    expect(s!.run(`return #OPENED`)).toBe("0");
    s!.run(`IN_COMBAT = false; fire_event("PLAYER_REGEN_ENABLED")`);
    expect(lines()).toContain("/invite Zed");
    expect(lines()).not.toContain("/invite Bo");
  });

  it("registers /guilded partners and translates", () => {
    const lua = setup();
    expect(lua.run(`return type(NS.commandHandlers.partners)`)).toBe("function");
    expect(lua.run(`return NS.L("Levelling partners")`)).toBe("Levelling partners");
  });
});

describe("levelling partners window background (8.5 in-game fix)", () => {
  it("draws a solid background of its own, so it is never see-through over the panel", () => {
    setup();
    s!.run(`SOLID = 0
      local make = CreateFrame
      CreateFrame = function(...)
        local f = make(...)
        local create = f.CreateTexture
        f.CreateTexture = function(self, ...)
          local t = create(self, ...)
          if type(t) == "table" then t.SetColorTexture = function() SOLID = SOLID + 1 end end
          return t
        end
        return f
      end`);
    expect(s!.run(`return tostring(NS.levelPartners.open())`)).toBe("true");
    expect(s!.run(`return SOLID`)).toBe("1");
  });
});
