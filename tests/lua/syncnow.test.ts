import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

let session: LuaSession | undefined;
afterEach(() => { session?.close(); session = undefined; });

// Newer clients block ReloadUI() from addon code, so SyncNow never calls it: saving is a
// secure button whose click runs the macro "/reload".
function withSync(officer = true): LuaSession {
  session = newLuaSession();
  session.run(`
    DB = {}
    NOW = 100000
    time = function() return NOW end
    RELOADS = 0
    ReloadUI = function() RELOADS = RELOADS + 1 end
    COMBAT = false
    INSTANCE = false
    InCombatLockdown = function() return COMBAT end
    UnitAffectingCombat = function() return COMBAT end
    IsInInstance = function() return INSTANCE end
    NS = {
      isOfficer = function() return ${officer} end,
      getDb = function() return DB end,
      message = function(text) CHAT_LOG = CHAT_LOG or {}; CHAT_LOG[#CHAT_LOG + 1] = text end,
      commandHandlers = {}, commandHelp = {}
    }
    -- Frames that remember their template and attributes.
    local base = CreateFrame
    CreateFrame = function(kind, name, parent, template)
      local f = base(kind, name, parent, template)
      f.template = template
      f.attributes = {}
      f.SetAttribute = function(self, key, value) self.attributes[key] = value end
      f.shown = false
      f.Show = function(self) self.shown = true end
      f.Hide = function(self) self.shown = false end
      if name then _G[name] = f end
      return f
    end
  `);
  session.load("Modules/SyncNow.lua");
  session.run(`fire_event("PLAYER_LOGIN")`);
  return session;
}

const advance = (s: LuaSession, seconds: number) => s.run(`NOW = NOW + ${seconds}`);

describe("SyncNow.lua", () => {
  it("the Send to Discord button is a secure button that runs /reload (ReloadUI is never called)", () => {
    const s = withSync();
    s.run(`BUTTON = NS.syncNow.reloadButton(UIParent, "Send to Discord", 140, 22)`);
    expect(s.run(`return BUTTON.template`)).toContain("SecureActionButtonTemplate");
    expect(s.run(`return BUTTON.attributes.type .. "|" .. BUTTON.attributes.macrotext`)).toBe("macro|/reload");
    expect(Number(s.run(`return RELOADS`))).toBe(0);
  });

  it("in combat it makes a plain button that says to type /reload", () => {
    const s = withSync();
    s.run(`COMBAT = true; BUTTON = NS.syncNow.reloadButton(UIParent, "Send to Discord", 140, 22)`);
    expect(s.run(`return tostring(BUTTON.template)`)).toBe("UIPanelButtonTemplate");
    s.run(`BUTTON:GetScript("OnClick")()`);
    expect(s.chat().join("\n")).toContain("Type /reload");
  });

  it("officers get the banner once data changed and settled, never in combat or an instance", () => {
    const s = withSync(true);
    const shown = () => s.run(`return tostring(GuildedSyncBanner ~= nil and GuildedSyncBanner.shown)`);
    s.run(`NS.syncNow.tick()`);
    expect(shown()).toBe("false");        // nothing changed yet
    s.run(`NS.syncNow.mark()`);
    advance(s, 30);
    s.run(`NS.syncNow.tick()`);
    expect(shown()).toBe("false");        // still settling
    advance(s, 100);
    s.run(`INSTANCE = true; NS.syncNow.tick()`);
    expect(shown()).toBe("false");        // inside an instance
    s.run(`INSTANCE = false; COMBAT = true; NS.syncNow.tick()`);
    expect(shown()).toBe("false");        // in combat
    s.run(`COMBAT = false; NS.syncNow.tick()`);
    expect(shown()).toBe("true");
    expect(Number(s.run(`return RELOADS`))).toBe(0);
  });

  it("members never get the banner", () => {
    const s = withSync(false);
    s.run(`NS.syncNow.mark()`);
    advance(s, 1000);
    s.run(`NS.syncNow.tick()`);
    expect(s.run(`return tostring(GuildedSyncBanner)`)).toBe("nil");
  });

  it("/guilded sync explains to type /reload; the old auto option says it is gone", () => {
    const s = withSync();
    s.run(`NS.commandHandlers["sync"]({})`);
    expect(s.chat().join("\n")).toContain("type /reload");
    s.run(`NS.commandHandlers["sync"]({ "auto", "on" })`);
    expect(s.chat().join("\n")).toContain("Automatic saving is no longer possible");
    expect(Number(s.run(`return RELOADS`))).toBe(0);
  });

  it("Core marks data as changed when it logs an event", () => {
    session = newLuaSession();
    session.run(`GuildedDB = nil; NS = {}; MOCK_UNITS = { player = { name = "Kev", buffs = {} } }; time = function() return 5 end`);
    session.load("Core.lua");
    session.load("Compat.lua");
    session.load("Modules/SyncNow.lua");
    session.run(`fire_event("PLAYER_LOGIN"); SlashCmdList["GUILDED"]("attune Onyxia Key")`);
    expect(session.run(`return tostring(NS.syncNow.isDirty())`)).toBe("true");
  });
});
