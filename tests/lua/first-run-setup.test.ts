import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it, vi } from "vitest";
vi.setConfig({ testTimeout: 300000 });
import { newLuaSession, type LuaSession } from "./harness.js";

// First-run setup window (20 Nov 2026): opens once per character, never in combat, detects the companion and the
// Guilded chat tab, remembers completion in GuildedDB, and /guilded setup reopens it. Loads the whole addon.
let session: LuaSession | undefined;
afterAll(() => { session?.close(); session = undefined; });

const toc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "addon", "Guilded", "Guilded.toc"), "utf8");
const FILES = toc.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.endsWith(".lua")).map((l) => l.replace(/\\/g, "/"));

const FRAMES = String.raw`
  local numbers = { GetWidth = 100, GetHeight = 100, GetEffectiveScale = 1, GetFrameLevel = 1, GetLeft = 0, GetTop = 0, GetRight = 100, GetBottom = 0, GetStringWidth = 50 }
  function CreateFrame(kind, name)
    local f = { scripts = {}, shown = false, text = "" }
    setmetatable(f, { __index = function(_, k)
      if numbers[k] then return function() return numbers[k] end end
      if k == "GetText" then return function(self) return self.text end end
      if k == "SetText" then return function(self, v) self.text = v or "" end end
      if k == "Show" then return function(self) self.shown = true end end
      if k == "Hide" then return function(self) self.shown = false end end
      if k == "IsShown" then return function(self) return self.shown end end
      if k == "HasFocus" or k == "GetChecked" or k == "IsVisible" then return function() return false end end
      if k == "GetCenter" then return function() return 0, 0 end end
      if k == "CreateFontString" or k == "CreateTexture" then return function() return CreateFrame() end end
      return function(self) return self end
    end })
    f.SetScript = function(self, n, fn) self.scripts[n] = fn end
    f.GetScript = function(self, n) return self.scripts[n] end
    f.HookScript = function(self, n, fn) self.scripts[n] = self.scripts[n] or fn end
    if name then NAMED = NAMED or {}; NAMED[name] = f end
    FRAMES[#FRAMES + 1] = f
    return f
  end
  Minimap = CreateFrame()
  UIParent = CreateFrame()
  GameTooltip = CreateFrame()
  UISpecialFrames = {}
  function UnitIsPlayer() return true end
`;

// One session for the file (loading the whole addon is slow); every test starts from a reset state.
function addon(): LuaSession {
  if (session) { reset(session); return session; }
  session = newLuaSession();
  session.run(FRAMES);
  session.run(String.raw`
    GuildedDB = nil; NS = {}
    MOCK_UNITS = { player = { name = "Kev", buffs = {} } }
    function GetInventoryItemLink() return nil end
    function GetInventoryItemDurability() return nil end
    IN_COMBAT = false
    function InCombatLockdown() return IN_COMBAT end
    IN_INSTANCE = false
    function IsInInstance() return IN_INSTANCE, IN_INSTANCE and "party" or "none" end
    TIMERS = {}
    C_Timer = { After = function(delay, fn) TIMERS[#TIMERS + 1] = { delay = delay, fn = fn } end }
    -- chat windows: General only, until a test adds Guilded
    LINES = {}
    NUM_CHAT_WINDOWS = 3
    ChatFrame1 = DEFAULT_CHAT_FRAME
    ChatFrame3 = { AddMessage = function(_, t) LINES[#LINES + 1] = t end }
    WINDOW_NAMES = { "General", "Log", nil }
    GetChatWindowInfo = function(i) return WINDOW_NAMES[i] end
    function runTimers() local t = TIMERS; TIMERS = {}; for _, x in ipairs(t) do x.fn() end end
  `);
  for (const file of FILES) session.load(file);
  session.run(`fire_event("PLAYER_LOGIN"); TIMERS = {}`);
  return session;
}

function reset(s: LuaSession) {
  s.run(`
    IN_COMBAT = false; IN_INSTANCE = false; MOCK_UNITS.player.name = "Kev"; WINDOW_NAMES[3] = nil
    fire_event("PLAYER_REGEN_ENABLED"); fire_event("PLAYER_ENTERING_WORLD")
    if NAMED.GuildedFirstRunSetup then NAMED.GuildedFirstRunSetup:Hide() end
    NS.getDb().setupWizard = nil; NS.getSettings().chatTab = nil; NS.getSettings().quietLogin = nil
    NS.firstRunSetup.step = 1
    GuildedStandings = nil; GuildedCompanion = nil; GuildedLinked = nil; GuildedLinkedAs = nil
    TIMERS = {}; CHAT_LOG = {}
  `);
}

const open = (s: LuaSession) => s.run(`return tostring(NS.firstRunSetup.isOpen())`) === "true";
const enterWorld = (s: LuaSession) => s.run(`fire_event("PLAYER_ENTERING_WORLD"); runTimers()`);

describe("first-run setup window", () => {
  it("is part of the .toc and loads with the rest of the addon", () => {
    expect(FILES).toContain("Modules/FirstRunSetup.lua");
    const s = addon();
    expect(s.run(`return type(NS.firstRunSetup.open)`)).toBe("function");
  });

  it("opens once by itself on a character's first login, not again after it was shown", () => {
    const s = addon();
    expect(open(s)).toBe(false);
    enterWorld(s);
    expect(open(s)).toBe(true);
    expect(s.run(`return tostring(NS.getDb().setupWizard.shown.kev)`)).toBe("true");
    // Closed with X / Escape (the game fires OnHide): not opened again on this character ...
    s.run(`local f = NAMED.GuildedFirstRunSetup; f:Hide(); f.scripts.OnHide(f)`);
    enterWorld(s);
    expect(open(s)).toBe(false);
    // ... nor on another character: one dismissal counts for the whole account (/guilded setup still works).
    s.run(`MOCK_UNITS.player.name = "Other"`);
    enterWorld(s);
    expect(open(s)).toBe(false);
    expect(s.run(`return tostring(NS.getDb().setupWizard.dismissed)`)).toBe("true");
    s.run(`NS.runCommand("setup")`);
    expect(open(s)).toBe(true);
  });

  it("does not open for members who already have the companion and the chat tab", () => {
    const s = addon();
    s.run(`GuildedStandings = { updatedAt = "2026-11-19T10:00:00Z" }`);
    enterWorld(s);
    expect(open(s)).toBe(true);   // companion only: still has the chat tab to do
    s.run(`NAMED.GuildedFirstRunSetup:Hide(); NS.getDb().setupWizard = nil; WINDOW_NAMES[3] = "Guilded"; NS.getSettings().chatTab = true`);
    enterWorld(s);
    expect(open(s)).toBe(false);  // both done: already set up
    s.run(`GuildedStandings = nil; GuildedCompanion = { mode = "device" }`);
    enterWorld(s);
    expect(open(s)).toBe(false);
    s.run(`NS.runCommand("setup")`);
    expect(open(s)).toBe(true);   // /guilded setup always works
  });

  it("waits in dungeons and battlegrounds and opens on the next zone change outside", () => {
    const s = addon();
    s.run(`IN_INSTANCE = true`);
    enterWorld(s);
    expect(open(s)).toBe(false);
    expect(s.run(`return tostring(NS.getDb().setupWizard.shown.kev)`)).toBe("nil");
    s.run(`fire_event("ZONE_CHANGED_NEW_AREA")`);
    expect(open(s)).toBe(false);  // still inside
    s.run(`IN_INSTANCE = false; fire_event("ZONE_CHANGED_NEW_AREA")`);
    expect(open(s)).toBe(true);
    // A typed /guilded setup works inside an instance (the player asked).
    s.run(`NAMED.GuildedFirstRunSetup:Hide(); IN_INSTANCE = true; NS.runCommand("setup")`);
    expect(open(s)).toBe(true);
  });

  it("waits out combat and loading screens, and hides when combat starts", () => {
    const s = addon();
    s.run(`IN_COMBAT = true`);
    enterWorld(s);
    expect(open(s)).toBe(false);
    expect(s.run(`return tostring(NS.getDb().setupWizard.shown.kev)`)).toBe("nil");
    s.run(`IN_COMBAT = false; fire_event("PLAYER_REGEN_ENABLED")`);
    expect(open(s)).toBe(true);
    // A fight starts: the hide is not a dismissal, and an automatically opened window does not come back by itself.
    s.run(`IN_COMBAT = true; fire_event("PLAYER_REGEN_DISABLED")`);
    expect(open(s)).toBe(false);
    s.run(`IN_COMBAT = false; fire_event("PLAYER_REGEN_ENABLED")`);
    expect(open(s)).toBe(false);
    expect(s.run(`return tostring(NS.getDb().setupWizard.dismissed)`)).toBe("nil");
    // A loading screen: nothing opens while loading, it opens after the next entering world.
    s.run(`NS.getDb().setupWizard.shown = {}; fire_event("PLAYER_LEAVING_WORLD")`);
    s.run(`NS.firstRunSetup.tryAutoOpen()`);
    expect(open(s)).toBe(false);
    enterWorld(s);
    expect(open(s)).toBe(true);
  });

  it("brings back a window the player opened after combat, on the same step", () => {
    const s = addon();
    s.run(`NS.runCommand("setup"); NS.firstRunSetup.go(3)`);
    expect(open(s)).toBe(true);
    s.run(`IN_COMBAT = true; fire_event("PLAYER_REGEN_DISABLED")`);
    expect(open(s)).toBe(false);
    s.run(`IN_COMBAT = false; fire_event("PLAYER_REGEN_ENABLED")`);
    expect(open(s)).toBe(true);
    expect(s.run(`return NAMED.GuildedFirstRunSetup.counter:GetText()`)).toBe("Step 3 of 5");
  });

  it("detects the companion and the Guilded chat tab for the green checks", () => {
    const s = addon();
    s.run(`GuildedStandings = nil; GuildedCompanion = nil; GuildedLinked = nil; GuildedLinkedAs = nil`);
    expect(s.run(`return tostring((NS.firstRunSetup.companionStatus()))`)).toBe("false");
    expect(s.run(`return tostring(NS.firstRunSetup.stepDone("companion"))`)).toBe("false");
    s.run(`GuildedStandings = { updatedAt = "2026-11-19T10:00:00Z" }`);
    expect(s.run(`return tostring(NS.firstRunSetup.stepDone("companion"))`)).toBe("true");
    expect(s.run(`local _, detail = NS.firstRunSetup.companionStatus(); return detail`)).toContain("2026-11-19");
    s.run(`GuildedStandings = nil; GuildedCompanion = { mode = "device" }`);
    expect(s.run(`return tostring(NS.firstRunSetup.stepDone("companion"))`)).toBe("true");

    // Chat tab: not there, there but not used, there and used.
    expect(s.run(`return tostring(NS.firstRunSetup.stepDone("chat"))`)).toBe("false");
    s.run(`WINDOW_NAMES[3] = "Guilded"; NS.getSettings().chatTab = false`);
    expect(s.run(`local ok, exists = NS.firstRunSetup.chatTabStatus(); return tostring(ok) .. tostring(exists)`)).toBe("falsetrue");
    s.run(`NS.getSettings().chatTab = true`);
    expect(s.run(`return tostring(NS.firstRunSetup.stepDone("chat"))`)).toBe("true");

    // The informational steps get their check once visited.
    expect(s.run(`return tostring(NS.firstRunSetup.stepDone("options"))`)).toBe("false");
    s.run(`NS.firstRunSetup.open(false); NS.firstRunSetup.go(4)`);
    expect(s.run(`return tostring(NS.firstRunSetup.stepDone("options"))`)).toBe("true");
    expect(s.run(`return NAMED.GuildedFirstRunSetup.title:GetText()`)).toBe("Guild options");
  });

  it("walks the five steps, shows the copyable links and binds the options to the real settings", () => {
    const s = addon();
    s.run(`NS.firstRunSetup.open(false)`);
    expect(s.run(`return NAMED.GuildedFirstRunSetup.counter:GetText()`)).toBe("Step 1 of 5");
    s.run(`NS.firstRunSetup.go(2)`);
    expect(s.run(`return tostring(NAMED.GuildedFirstRunSetup.directBox.shown)`)).toBe("true");
    expect(s.run(`return NAMED.GuildedFirstRunSetup.directBox.text`)).toBe(s.run(`return NS.companionLink.DIRECT`));
    expect(s.run(`return NAMED.GuildedFirstRunSetup.body.text`)).toContain("optional");
    s.run(`NS.firstRunSetup.go(1)`);
    expect(s.run(`return tostring(NAMED.GuildedFirstRunSetup.directBox.shown)`)).toBe("false");
    // Step 4 options flip the same saved values the slash commands do.
    const keys = s.run(`local t = {}; for _, o in ipairs(NS.firstRunSetup.options()) do t[#t + 1] = o.key end; return table.concat(t, ",")`);
    expect(keys).toBe("announce,reminder,quiet,chattab");
    s.run(`for _, o in ipairs(NS.firstRunSetup.options()) do if o.key == "announce" then o.set(false) end if o.key == "quiet" then o.set(true) end end`);
    expect(s.run(`return tostring(NS.milestones.enabled())`)).toBe("false");
    expect(s.run(`return tostring(NS.getSettings().quietLogin)`)).toBe("true");
    s.run(`NS.firstRunSetup.go(99)`);
    expect(s.run(`return NAMED.GuildedFirstRunSetup.counter:GetText()`)).toBe("Step 5 of 5");
    expect(s.run(`return NAMED.GuildedFirstRunSetup.next.text`)).toBe("Finish");
  });

  it("remembers completion for the whole account and /guilded setup reopens it", () => {
    const s = addon();
    enterWorld(s);
    expect(open(s)).toBe(true);
    s.run(`NS.firstRunSetup.go(5); NAMED.GuildedFirstRunSetup.next.scripts.OnClick()`);   // Finish
    expect(open(s)).toBe(false);
    expect(s.run(`return tostring(NS.getDb().setupWizard.done)`)).toBe("true");
    expect(s.run(`return tostring(NS.firstRunSetup.completed())`)).toBe("true");
    // Done: no automatic opening, on this character or another.
    s.run(`MOCK_UNITS.player.name = "Other"`);
    enterWorld(s);
    expect(open(s)).toBe(false);
    // Existing saved data is untouched by the new field.
    expect(s.run(`return type(NS.getDb().epgp)`)).toBe("table");
    // /guilded setup opens it again, starting at step 1.
    s.run(`NS.runCommand("setup")`);
    expect(open(s)).toBe(true);
    expect(s.run(`return NAMED.GuildedFirstRunSetup.counter:GetText()`)).toBe("Step 1 of 5");
    // The old chooser moved to /guilded setup mode and the explicit choices still work.
    s.run(`NAMED.GuildedFirstRunSetup:Hide(); NS.runCommand("setup mode")`);
    expect(open(s)).toBe(false);
    expect(s.run(`return tostring(NAMED.GuildedSetupPanel.shown)`)).toBe("true");
    s.run(`NS.runCommand("setup connected")`);
    expect(s.run(`return NS.getSettings().setupMode`)).toBe("connected");
  });

  it("\"Don't show again\" completes it too, and /guilded setup in combat waits", () => {
    const s = addon();
    s.run(`NS.firstRunSetup.open(false); NAMED.GuildedFirstRunSetup.never.scripts.OnClick()`);
    expect(open(s)).toBe(false);
    expect(s.run(`return tostring(NS.firstRunSetup.completed())`)).toBe("true");
    s.run(`IN_COMBAT = true; NS.runCommand("setup")`);
    expect(open(s)).toBe(false);
    expect(s.chat().join("\n")).toContain("Open setup after combat.");
    s.run(`IN_COMBAT = false; fire_event("PLAYER_REGEN_ENABLED")`);
    expect(open(s)).toBe(true);
  });

  it("never touches chat windows or protected functions", () => {
    const s = addon();
    s.run(`
      CALLS = 0
      for _, n in ipairs({ "FCF_OpenNewWindow", "FCF_Close", "FCF_DockFrame", "FCF_SetWindowName", "ChatFrame_OpenChat", "ReloadUI", "SetCVar" }) do
        _G[n] = function() CALLS = CALLS + 1 end
      end
    `);
    enterWorld(s);
    s.run(`for i = 1, 5 do NS.firstRunSetup.go(i) end; NAMED.GuildedFirstRunSetup.chatButton.scripts.OnClick()`);
    expect(s.run(`return CALLS`)).toBe("0");
    expect(s.run(`return tostring(NS.getSettings().chatTab)`)).toBe("true");
  });
});
