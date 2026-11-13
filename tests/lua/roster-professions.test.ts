import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";
import { rosterPrelude } from "./roster-tools.test.js";
import { noteIsWritable, professionNoteTag } from "../../src/services/profession-note.js";
import { mixinHookLines } from "../../scripts/validate-mixin-hooks.mjs";

let s: LuaSession;
afterEach(() => s?.close());

// RosterTools plus the two 8.5 track C modules on the same fake namespace and guild.
function setup() {
  s = newLuaSession();
  s.run(rosterPrelude);
  s.run(String.raw`
    DB = { peerRoster = { ["Amy-Realm"] = { professions = "Alchemy:300,Herbalism:225" }, ["Bob-Realm"] = { professions = "Mining:150" } } }
    NS.getDb = function() return DB end
    NS.displayName = function(n) return n end
    NS.message = function(m) MESSAGES = MESSAGES or {}; MESSAGES[#MESSAGES + 1] = m end
    function GetGuildRosterInfo(i) READS = READS + 1; local r = ROWS[i]; return r.name, r.rankName or "Rank", r.rank, r.level or 60, "Mage", "Zone", r.public, r.officer, true, nil, "MAGE", 0, 0, false, false, 0, r.guid end
  `);
  s.load("Modules/RosterTools.lua");
  s.load("Modules/RosterProfessions.lua");
  s.load("Modules/Promotion.lua");
  s.run('NS.util.gameEdition=function() return EDITION end; NS.util.address=function(n) return n end; fire_event("GUILD_ROSTER_UPDATE")');
  return s;
}

describe("profession tags match the bot's definition", () => {
  const samples = [
    [{ name: "Herbalism", skill: 300 }, { name: "Alchemy", skill: 300 }, { name: "Cooking", skill: 150 }],
    [{ name: "Mining", skill: 225 }],
    ["Alchemy", "Blacksmithing", "Enchanting", "Engineering", "Herbalism", "Leatherworking", "Mining"].map((name, i) => ({ name, skill: 300 - i })),
    []
  ];
  it.each(samples.map((x, i) => [i, x] as const))("tag sample %i", (_i, skills) => {
    setup();
    const lua = skills.map((k) => `{ name = "${k.name}", skill = ${k.skill} }`).join(",");
    expect(s.run(`return NS.rosterProfessions.tag({ ${lua} })`)).toBe(professionNoteTag(skills));
  });
  it.each(["", "Alch300 Herb300", "Alt of Kevin", "Alch300 raid lead", "Alch1000", "Mine150"])("noteIsWritable %j", (note) => {
    setup();
    expect(s.run(`return tostring(NS.rosterProfessions.noteIsWritable(${JSON.stringify(note)}))`)).toBe(String(noteIsWritable(note)));
  });
});

describe("guild roster tooltip", () => {
  it("adds profession lines with icons and survives a missing tooltip", () => {
    setup();
    s.run(String.raw`
      LINES = {}; GAME_CALLS = 0; OWNER = nil
      GameTooltip = {}
      for _, m in ipairs({ "AddLine", "Show", "Hide", "SetOwner", "ClearLines", "SetPoint" }) do GameTooltip[m] = function() GAME_CALLS = GAME_CALLS + 1 end end
      -- Guilded's own tooltip frame (9.3.0): the professions go there, never onto the game's tooltip.
      CreateFrame = function(kind, name)
        local f = { name = name }
        for _, m in ipairs({ "ClearLines", "SetPoint", "Show", "Hide" }) do f[m] = function() end end
        f.SetOwner = function(_, owner) OWNER = owner end
        f.AddLine = function(_, t) LINES[#LINES + 1] = t end
        return f
      end
      BUTTON = { memberInfo = { name = "Amy-Realm" }, HookScript = function() end }
      NS.rosterProfessions.decorate(BUTTON)`);
    expect(s.run('return table.concat(LINES, "|")')).toContain("Alchemy 300|");
    expect(s.run('return table.concat(LINES, "|")')).toContain("Trade_Alchemy");
    expect(s.run("return GAME_CALLS")).toBe("0");
    expect(s.run("return tostring(OWNER == BUTTON)")).toBe("true");
    s.run("CreateFrame = nil; NS.rosterProfessions.decorate({ memberInfo = { name = 'Amy-Realm' } })");
  });
  it("hooks Blizzard's roster button once and tolerates a missing hook API", () => {
    setup();
    s.run(`HOOKS = {}; hooksecurefunc = function(name, fn) HOOKS[#HOOKS + 1] = name end; GuildRosterButton_OnEnter = function() end`);
    s.run("NS.rosterProfessions.install(); NS.rosterProfessions.install()");
    expect(s.run('return table.concat(HOOKS, ",")')).toBe("GuildRosterButton_OnEnter");
    s.run("hooksecurefunc = nil; NS.rosterProfessions.install()");
  });
  // 9.0.4: hooking CommunitiesMemberListEntryMixin made every roster entry frame inherit tainted
  // code (ADDON_ACTION_FORBIDDEN on each login). Now each entry frame's own OnEnter is hooked.
  it("never hooks the Communities mixin table; hooks each member entry frame once", () => {
    setup();
    s.run(`HOOKED = {}; hooksecurefunc = function(t, k) HOOKED[#HOOKED + 1] = type(t) == "string" and t or ("table." .. tostring(k)) end
      CommunitiesMemberListEntryMixin = { OnEnter = function() end }
      ORIGINAL = CommunitiesMemberListEntryMixin.OnEnter
      LINES = {}
      CreateFrame = function()
        local f = {}
        for _, m in ipairs({ "ClearLines", "SetPoint", "Show", "Hide", "SetOwner" }) do f[m] = function() end end
        f.AddLine = function(_, t) LINES[#LINES + 1] = t end
        return f
      end
      function ENTRY(name)
        local f = { scripts = {}, hooks = 0, memberInfo = { name = name } }
        function f:HookScript(script, fn) self.hooks = self.hooks + 1; self.scripts[script] = fn end
        return f
      end
      EXISTING = ENTRY("Amy-Realm")
      CALLBACKS = {}
      ScrollUtil = { AddInitializedFrameCallback = function(box, fn, owner, iterateExisting)
        CALLBACKS[#CALLBACKS + 1] = fn
        if iterateExisting then fn(owner, EXISTING, {}) end
      end }
      CommunitiesFrame = { MemberList = { ScrollBox = {} } }
      GuildRosterButton_OnEnter = function() end`);
    s.run("NS.rosterProfessions.install(); NS.rosterProfessions.install()");
    // The mixin is untouched; only the plain global function got a secure hook.
    expect(s.run("return tostring(CommunitiesMemberListEntryMixin.OnEnter == ORIGINAL) .. ' ' .. table.concat(HOOKED, ',')")).toBe("true GuildRosterButton_OnEnter");
    // One list callback; the frame already on screen and a new one are hooked once each.
    s.run("NEW = ENTRY('Bob-Realm'); CALLBACKS[1](NS.rosterProfessions, NEW, {}); CALLBACKS[1](NS.rosterProfessions, NEW, {})");
    expect(s.run("return #CALLBACKS .. ' ' .. EXISTING.hooks .. ' ' .. NEW.hooks")).toBe("1 1 1");
    s.run("EXISTING.scripts.OnEnter(EXISTING)");
    expect(s.run('return table.concat(LINES, "|")')).toContain("Alchemy 300");
  });

  it("hooks the older member list's fixed buttons when there is no ScrollBox", () => {
    setup();
    s.run(`hooksecurefunc = function() end
      B1 = { hooks = 0, HookScript = function(self) self.hooks = self.hooks + 1 end }
      B2 = { hooks = 0, HookScript = function(self) self.hooks = self.hooks + 1 end }
      CommunitiesFrame = { MemberList = { ListScrollFrame = { buttons = { B1, B2 } } } }`);
    s.run("NS.rosterProfessions.install(); NS.rosterProfessions.install()");
    expect(s.run("return B1.hooks .. ' ' .. B2.hooks")).toBe("1 1");
  });
});

describe("ready to promote panel", () => {
  const rows = String.raw`
    ROWS[2].rankName = "Initiate"; ROWS[2].level = 22; ROWS[3].rankName = "Initiate"; ROWS[3].level = 12
    CLOCK = 100; fire_event("GUILD_ROSTER_UPDATE"); NS.promotion.observe()`;
  it("lists members after the rule's days, longest first, and not before", () => {
    setup(); s.run(rows);
    expect(s.run('local r=NS.promotion.ready(); return #r')).toBe("0");
    s.run("DB.rankSince['Amy-Realm'].since = DB.rankSince['Amy-Realm'].since - 9 * 86400; DB.rankSince['Bob-Realm'].since = DB.rankSince['Bob-Realm'].since - 20 * 86400");
    expect(s.run('local r=NS.promotion.ready(); return r[1].name..":"..r[1].days..","..r[2].name..":"..r[2].days')).toBe("Bob-Realm:20,Amy-Realm:9");
  });
  it("restarts the clock when the rank changes and honors the configured rule", () => {
    setup(); s.run(rows);
    s.run("DB.rankSince['Amy-Realm'].since = DB.rankSince['Amy-Realm'].since - 9 * 86400");
    s.run("ROWS[2].rankName = 'Member'; CLOCK = 150; fire_event('GUILD_ROSTER_UPDATE'); NS.promotion.observe()");
    expect(s.run("return DB.rankSince['Amy-Realm'].rank")).toBe("Member");
    s.run("NS.promotion.setRule('Member', 0)");
    expect(s.run("local r=NS.promotion.ready(); return #r..':'..r[1].name")).toBe("1:Amy-Realm");
  });
  it("adds members the bot already lists", () => {
    setup(); s.run(rows);
    s.run('GuildedPromotion = { ready = { "Bob-Realm" } }');
    expect(s.run("local r=NS.promotion.ready(); return #r..':'..r[1].name..':'..tostring(r[1].fromBot)")).toBe("1:Bob-Realm:true");
  });
  it("promotes one member per click through the reviewed engine and waits for verification", () => {
    setup(); s.run(rows);
    s.run('GuildedPromotion = { ready = { "Amy-Realm", "Bob-Realm" } }');
    expect(s.run('local ok=NS.promotion.promote("Amy-Realm"); return tostring(ok)')).toBe("true");
    expect(s.run("return #CALLS")).toBe("1");
    expect(s.run('local ok,msg=NS.promotion.promote("Bob-Realm"); return tostring(ok)')).toBe("false");
    expect(s.run("return #CALLS")).toBe("1");
    expect(s.run("return NS.rosterTools.store().audit[1].action")).toBe("promote");
  });
  it("refuses without permission and never promotes on open", () => {
    setup(); s.run(rows);
    s.run("PERMISSION=false");
    expect(s.run('local ok=NS.promotion.promote("Amy-Realm"); return tostring(ok)')).toBe("false");
    s.run("PERMISSION=true; GuildedPromotion = { ready = { 'Amy-Realm' } }");
    s.load("Modules/RosterAdmin.lua");
    s.run(`local original=CreateFrame;function CreateFrame(kind,...)
      local f=original(kind,...); f.TitleText={SetText=function() end}
      f.text=""; f.SetText=function(self,v) self.text=v end
      f.CreateFontString=function() return CreateFrame("Font") end
      return f
    end`);
    s.run("NS.isOfficer=function() return true end; NS.showCopyText=function() end; NS.promotion.open(); NS.commandHandlers.promote({ 'promote' }); fire_event('PLAYER_LOGIN')");
    expect(s.run("return #CALLS")).toBe("0");
  });
  it("rejects names that could carry extra rows", () => {
    setup(); s.run(rows);
    expect(s.run('local ok=NS.promotion.promote("Amy-Realm\\tpromote\\t\\nBob-Realm"); return tostring(ok)')).toBe("false");
    expect(s.run("return #CALLS")).toBe("0");
  });
});

describe("validator: no secure hooks on Blizzard mixin tables", () => {
  it("flags hooksecurefunc on a *Mixin, directly, through pcall or a local wrapper", () => {
    expect(mixinHookLines('hooksecurefunc(CommunitiesMemberListEntryMixin, "OnEnter", fn)')).toEqual([1]);
    expect(mixinHookLines(['x = 1', 'local ok = pcall(hooksecurefunc, Some.FooMixin, "OnShow", fn)'].join(String.fromCharCode(10)))).toEqual([2]);
    expect(mixinHookLines('if CommunitiesMemberListEntryMixin then hook(CommunitiesMemberListEntryMixin, "OnEnter") end')).toEqual([1]);
  });
  it("allows global-function hooks, frame HookScript and comments", () => {
    expect(mixinHookLines([
      'hooksecurefunc("GuildRosterButton_OnEnter", fn)',
      'frame:HookScript("OnEnter", fn)',
      '-- never hooksecurefunc(CommunitiesMemberListEntryMixin, "OnEnter")',
      'local f = CreateFrame("Frame", nil, UIParent, BackdropTemplateMixin and "BackdropTemplate")',
    ].join(String.fromCharCode(10)))).toEqual([]);
  });
});
