import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

// P0 (7 Nov): the Guilded window opened from the minimap button or the guild tab could not be closed.
// These tests use frames that behave like the game's: Show and Hide run OnShow and OnHide (and every
// hooked script), and Escape hides each frame named in UISpecialFrames.
let session: LuaSession | undefined;
afterEach(() => { session?.close(); session = undefined; });

const windowTests = readFileSync(new URL("./window.test.ts", import.meta.url), "utf8");
const RICH_FRAMES = windowTests.slice(windowTests.indexOf("String.raw`", windowTests.indexOf("const RICH_FRAMES")) + 11, windowTests.indexOf("`;", windowTests.indexOf("const RICH_FRAMES")));

const REALISTIC = String.raw`
  local base = CreateFrame
  function CreateFrame(kind, frameName, parent, ...)
    local f = base(kind, frameName, parent, ...)
    f.hooks = {}
    f.SetScript = function(self, name, fn) self.scripts[name] = fn end
    f.HookScript = function(self, name, fn) self.hooks[name] = self.hooks[name] or {}; table.insert(self.hooks[name], fn) end
    local function fire(self, name, ...)
      if self.scripts[name] then self.scripts[name](self, ...) end
      for _, fn in ipairs(self.hooks[name] or {}) do fn(self, ...) end
    end
    -- Like the game: hiding or showing a frame also runs OnHide / OnShow on shown children
    -- (their own shown flag stays set), and a frame is visible only if its parents are.
    f.kids = {}
    f.parent = false
    local function link(self, parent)
      if self.parent and self.parent.kids then for i, k in ipairs(self.parent.kids) do if k == self then table.remove(self.parent.kids, i) break end end end
      self.parent = parent or false
      if parent and parent.kids then table.insert(parent.kids, self) end
    end
    link(f, type(parent) == "table" and parent or nil)
    local function visible(self) return self.shown and (not self.parent or self.parent == UIParent or visible(self.parent)) end
    f.IsVisible = function(self) return visible(self) and true or false end
    local function cascade(self, name)
      for _, kid in ipairs(self.kids) do
        if kid.shown then fire(kid, name); cascade(kid, name) end
      end
    end
    f.Show = function(self) if not self.shown then self.shown = true; if not self.parent or visible(self.parent) or self.parent == UIParent then fire(self, "OnShow"); cascade(self, "OnShow") end end end
    f.Hide = function(self) if self.shown then self.shown = false; cascade(self, "OnHide"); fire(self, "OnHide") end end
    f.SetParent = function(self, p) link(self, p) end
    if frameName then _G[frameName] = f end
    return f
  end
  Minimap = CreateFrame()
  UIParent = CreateFrame()
  GameTooltip = CreateFrame()
  UISpecialFrames = {}
  function UnitIsPlayer() return true end
  function Escape()
    for _, name in ipairs(UISpecialFrames) do local f = _G[name]; if f and f.shown then f:Hide() end end
  end
`;

function boot(extra = ""): LuaSession {
  session = newLuaSession();
  session.run(RICH_FRAMES);
  session.run(REALISTIC);
  session.run(String.raw`
    GuildedDB = nil; NS = {}
    MOCK_UNITS = { player = { name = "Kev", buffs = {} } }
    function GetGuildInfo() return "Alpha", "Rank", 1 end
    ${extra}
  `);
  for (const file of ["Core.lua", "Compat.lua", "Modules/Sync.lua", "Modules/SyncNow.lua", "Modules/LootRoll.lua", "Modules/ConsumableData.lua", "Modules/Consumables.lua", "Modules/Ready.lua", "Modules/Minimap.lua"]) session.load(file);
  session.run(`fire_event("PLAYER_LOGIN"); fire_event("PLAYER_ENTERING_WORLD")`);
  return session;
}

const shown = (s: LuaSession) => s.run(`return tostring(GuildedPanel:IsVisible())`);
// The game's close button template hides its parent; a script set on it (docked mode) is run instead.
const pressClose = (s: LuaSession) => s.run(`local b = NS.windowState().closeButton; if b.scripts.OnClick then b.scripts.OnClick(b) else GuildedPanel:Hide() end`);
const clickMinimap = (s: LuaSession) => s.run(`GuildedMinimapButton.scripts.OnClick(GuildedMinimapButton, "LeftButton")`);

describe("the Guilded window opened from the minimap button closes", () => {
  it("with its close button", () => {
    const s = boot();
    clickMinimap(s);
    expect(shown(s)).toBe("true");
    pressClose(s);
    expect(shown(s)).toBe("false");
  });
  it("with Escape", () => {
    const s = boot();
    clickMinimap(s);
    s.run(`Escape()`);
    expect(shown(s)).toBe("false");
  });
  it("when the minimap button is clicked again", () => {
    const s = boot();
    clickMinimap(s);
    expect(shown(s)).toBe("true");
    clickMinimap(s);
    expect(shown(s)).toBe("false");
    clickMinimap(s);
    expect(shown(s)).toBe("true");
  });
});

describe("the Guilded window opened from the guild tab closes", () => {
  const GUILD = String.raw`
    CommunitiesFrame = CreateFrame("Frame", "CommunitiesFrame")
    CommunitiesFrame.ChatTab = false; CommunitiesFrame.RosterTab = false; CommunitiesFrame.GuildBenefitsTab = false
    CommunitiesFrame.SetDisplayMode = false
    CommunitiesFrame.GuildInfoTab = CreateFrame()
    CommunitiesFrame:Show()
  `;
  const openFromTab = (s: LuaSession) => {
    s.run(`fire_event("PLAYER_LOGIN")`);
    s.run(`NS.guildPanel.tab.scripts.OnClick(NS.guildPanel.tab)`);
  };

  it("with the guild tab again, Escape and the minimap button", () => {
    const s = boot(GUILD);
    openFromTab(s);
    expect(s.run(`return tostring(NS.windowState().guildHost == CommunitiesFrame) .. ":" .. tostring(GuildedPanel:IsVisible())`)).toBe("true:true");
    s.run(`NS.guildPanel.tab.scripts.OnClick(NS.guildPanel.tab)`);
    expect(shown(s)).toBe("false");
    // Escape
    openFromTab(s);
    expect(shown(s)).toBe("true");
    s.run(`Escape()`);
    expect(shown(s)).toBe("false");
    expect(s.run(`return NS.windowState().scope`)).toBe("main");
    // Minimap button while docked closes it, then the next click opens it free-standing.
    openFromTab(s);
    clickMinimap(s);
    expect(shown(s)).toBe("false");
    clickMinimap(s);
    expect(shown(s)).toBe("true");
    s.run(`Escape()`);
    expect(shown(s)).toBe("false");
  });

  it("when the guild window itself is closed", () => {
    const s = boot(GUILD);
    openFromTab(s);
    s.run(`CommunitiesFrame:Hide()`);
    expect(shown(s)).toBe("false");
    // And it opens and closes normally from the minimap afterwards.
    clickMinimap(s);
    expect(shown(s)).toBe("true");
    pressClose(s);
    expect(shown(s)).toBe("false");
  });
});
