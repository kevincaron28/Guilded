import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";
import { readTable } from "../../scripts/addon-locale.mjs";

// The settings, one shared list (Modules/SettingsPage.lua) drawn as tabs in the game's Options page. Loads every
// file of the addon in .toc order, like the game does, so the list sees the real modules and their saved keys.
// Each case loads the whole addon, which takes a few seconds.
vi.setConfig({ testTimeout: 120_000 });
let session: LuaSession | undefined;
afterEach(() => { session?.close(); session = undefined; });

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "addon", "Guilded");
const toc = readFileSync(join(root, "Guilded.toc"), "utf8");
const FILES = toc.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.endsWith(".lua")).map((line) => line.replace(/\\/g, "/"));

const FRAMES = String.raw`
  local numbers = { GetWidth = 100, GetHeight = 100, GetEffectiveScale = 1, GetFrameLevel = 1, GetLeft = 0, GetTop = 0, GetRight = 100, GetBottom = 0, GetStringWidth = 50 }
  function CreateFrame(_, _, _, template)
    local f = { scripts = {}, shown = false, text = "", checked = false, template = template, width = 0 }
    setmetatable(f, { __index = function(_, k)
      if numbers[k] then return function() return numbers[k] end end
      if k == "GetText" then return function(self) return self.text end end
      if k == "SetText" then return function(self, v) self.text = v or "" end end
      if k == "SetSize" then return function(self, w) self.width = w end end
      if k == "SetWidth" then return function(self, w) self.width = w end end
      if k == "SetChecked" then return function(self, v) self.checked = v and true or false end end
      if k == "GetChecked" then return function(self) return self.checked end end
      if k == "Show" then return function(self) self.shown = true end end
      if k == "Hide" then return function(self) self.shown = false end end
      if k == "IsShown" then return function(self) return self.shown end end
      if k == "HasFocus" or k == "IsVisible" then return function() return false end end
      if k == "GetCenter" then return function() return 0, 0 end end
      if k == "CreateFontString" or k == "CreateTexture" then return function() return CreateFrame() end end
      return function(self) return self end
    end })
    f.SetScript = function(self, name, fn) self.scripts[name] = fn end
    f.GetScript = function(self, name) return self.scripts[name] end
    f.HookScript = function(self, name, fn) self.scripts[name] = self.scripts[name] or fn end
    FRAMES[#FRAMES + 1] = f
    return f
  end
  Minimap = CreateFrame()
  UIParent = CreateFrame()
  GameTooltip = CreateFrame()
  UISpecialFrames = {}
  function UnitIsPlayer() return true end
`;

// rank 1 is an officer, 5 is not (the same ranks the full-addon test uses); `saved` starts the profile.
function addon(rank: number, saved = "nil"): LuaSession {
  session = newLuaSession();
  session.run(FRAMES);
  session.run(String.raw`
    GuildedDB = ${saved}; NS = {}
    MOCK_UNITS = { player = { name = "Kev", buffs = {} } }
    function GetGuildInfo() return "Alpha", "Rank", ${rank} end
    function GetInventoryItemLink() return nil end
    function GetInventoryItemDurability() return nil end
  `);
  for (const file of FILES) session.load(file);
  session.run(`fire_event("PLAYER_LOGIN"); fire_event("PLAYER_ENTERING_WORLD")`);
  return session;
}

const lua = (s: LuaSession, code: string) => s.run(code);
const problems = (s: LuaSession) => s.chat().filter((line) => /(^|\s)(error|failed)|attempt to|stack traceback/i.test(line));

describe("the shared settings list", () => {
  it("gives every setting a tab, group, label, description, who it affects and its saved place", () => {
    const s = addon(1);
    expect(lua(s, `
      local bad = {}
      local tabs = {}
      for _, t in ipairs(NS.settingsPage.TABS) do tabs[t.key] = true end
      for i, e in ipairs(NS.settingsPage.allEntries()) do
        local who = e.who and NS.settingsPage.WHO_TEXT[e.who]
        if not (tabs[e.tab] and e.group and e.label and e.label ~= "" and e.desc and #e.desc > 10 and who and e.saved) then bad[#bad + 1] = tostring(e.label) end
        if e.kind == "check" and not (e.get and e.set) then bad[#bad + 1] = "check " .. tostring(e.label) end
        if e.kind == "cycle" and not (e.text and e.next) then bad[#bad + 1] = "cycle " .. tostring(e.label) end
        if e.kind == "action" and not e.run then bad[#bad + 1] = "action " .. tostring(e.label) end
      end
      return table.concat(bad, "; ")`)).toBe("");
  });

  it("has English, French, German and Spanish text for every label, group, description and header", () => {
    const s = addon(1);
    const strings = new Set(lua(s, `
      local out, seen = {}, {}
      local function add(text) if text and not seen[text] then seen[text] = true; out[#out + 1] = text end end
      for _, e in ipairs(NS.settingsPage.allEntries()) do add(e.label); add(e.group); add(e.desc) end
      for _, text in pairs(NS.settingsPage.WHO_TEXT) do add(text) end
      for _, text in pairs(NS.settingsPage.TAB_HINT) do add(text) end
      for _, tab in ipairs(NS.settingsPage.TABS) do add(tab.label) end
      for _, text in ipairs({ "Window", "Chat line", "Off", "Compact", "Full", "Open the tools window", "Guilded setup", "Diagnostics",
        "Guilded - Version %s", "Everything here affects only you, except the Officers tab, which affects the whole guild.", "Open the options after combat." }) do add(text) end
      return table.concat(out, "\\n")`).split("\n"));
    expect(strings.size).toBeGreaterThan(150);
    // The words that are the same in a language (Chat, General...) are in the table too: nothing is skipped.
    const source = readFileSync(join(root, "Locale.lua"), "utf8");
    for (const lang of ["FR", "DE", "ES"]) {
      const table = readTable(source, lang);
      const missing = [...strings].filter((text) => !table.get(text)?.trim());
      expect(missing, lang).toEqual([]);
    }
  });

  it("hides the Officers tab and every officer-only switch from members, and shows them to officers", () => {
    const member = addon(5);
    expect(lua(member, `return table.concat(NS.settingsPage.visibleTabs(), ",")`)).toBe("general,chat,announce,dungeons,raids,advanced");
    expect(lua(member, `local n = 0; for _, e in ipairs(NS.settingsPage.entries()) do if e.officer or e.tab == "officers" then n = n + 1 end end return tostring(n)`)).toBe("0");
    expect(lua(member, `local n = 0; for _, e in ipairs(NS.options.switches()) do if e.officer then n = n + 1 end end return tostring(n)`)).toBe("0");
    member.close();
    const officer = addon(1);
    expect(lua(officer, `return table.concat(NS.settingsPage.visibleTabs(), ",")`)).toBe("general,chat,announce,dungeons,raids,officers,advanced");
    // One guild-wide switch per optional part, plus the milestone one.
    expect(lua(officer, `local n = 0; for _, e in ipairs(NS.settingsPage.entries()) do if e.tab == "officers" and e.officer then n = n + 1 end end return tostring(n >= #NS.MODULES + 1)`)).toBe("true");
  });

  it("puts every optional part somewhere, in its own tab or in Advanced", () => {
    const s = addon(1);
    expect(lua(s, `
      local found = {}
      for _, e in ipairs(NS.settingsPage.entries()) do if e.module then found[e.module] = e.tab end end
      local missing = {}
      for _, m in ipairs(NS.MODULES) do if not found[m.key] then missing[#missing + 1] = m.key end end
      return table.concat(missing, ",")`)).toBe("");
    expect(lua(s, `for _, e in ipairs(NS.settingsPage.entries()) do if e.module == "bidding" then return e.tab end end`)).toBe("raids");
    expect(lua(s, `for _, e in ipairs(NS.settingsPage.entries()) do if e.module == "sim" then return e.tab end end`)).toBe("advanced");
  });
});

describe("toggling a setting changes the value it always changed", () => {
  const cases: Array<[string, string, string, string]> = [
    // label, how to read the saved value, value when on, value when off
    ["Show the minimap button", `tostring(GuildedDB.settings.minimapHidden)`, "false", "true"],
    ["Guilded's messages in their own chat tab", `tostring(GuildedDB.settings.chatTab)`, "true", "false"],
    ["Main names in chat", `tostring(GuildedDB.settings.chatTags)`, "true", "false"],
    ["Joins", `tostring(GuildedDB.settings.chatEvents.join)`, "true", "false"],
    ["Going offline", `tostring(GuildedDB.settings.chatEvents.offline)`, "true", "false"],
    ["Online and offline lines: officers only", `tostring(GuildedDB.settings.chatEventsOfficersOnly)`, "true", "nil"],
    ["Weekly reminder to get the Windows companion", `tostring(GuildedDB.settings.companionReminder)`, "true", "false"],
    ["Show what changed since my last login", `tostring(GuildedDB.digest.enabled)`, "true", "false"],
    ["Loud alert for calls in my zone", `tostring(GuildedDB.settings.helpDefender)`, "true", "false"],
    ["Play a sound", `tostring(GuildedDB.settings.helpSound)`, "true", "false"],
    ["Quiet in combat", `tostring(GuildedDB.settings.helpQuiet)`, "true", "false"],
    ["Post my calls in guild chat", `tostring(GuildedDB.settings.helpGuildChat)`, "true", "false"],
  ];
  it.each(cases)("%s", (label, read, on, off) => {
    const s = addon(1, `{ settings = {}, digest = {} }`);
    const find = `local e; for _, x in ipairs(NS.settingsPage.entries()) do if x.label == ${JSON.stringify(label)} then e = x; break end end `;
    // Off first and then on, so a switch that does nothing cannot pass.
    lua(s, find + `e.set(false); e.set(true)`);
    expect(lua(s, `return ${read}`)).toBe(on);
    expect(lua(s, find + `return tostring(e.get())`)).toBe("true");
    lua(s, find + `e.set(false)`);
    expect(lua(s, `return ${read}`)).toBe(off);
    expect(lua(s, find + `return tostring(e.get())`)).toBe("false");
  });

  it("keeps the milestone, optional part, guild-wide part and officer job switches on their saved values", () => {
    const s = addon(1, `{ settings = {}, digest = {} }`);
    const find = (key: string, value: string) => `local e; for _, x in ipairs(NS.settingsPage.entries()) do if x.${key} == ${JSON.stringify(value)} then e = x; break end end `;
    // My own optional part: GuildedDB.settings.modules.<key>.
    lua(s, find("module", "bidding") + `e.set(false)`);
    expect(lua(s, `return tostring(GuildedDB.settings.modules.bidding)`)).toBe("false");
    expect(lua(s, find("module", "bidding") + `return tostring(e.get())`)).toBe("false");
    lua(s, find("module", "bidding") + `e.set(true)`);
    expect(lua(s, `return tostring(GuildedDB.settings.modules.bidding)`)).toBe("nil");
    // The guild-wide switch (officers).
    lua(s, find("guildModule", "reserve") + `e.set(false)`);
    expect(lua(s, `return tostring(GuildedDB.settings.guildModules.off.reserve)`)).toBe("true");
    expect(lua(s, find("guildModule", "reserve") + `return tostring(e.get())`)).toBe("false");
    // Milestones: the master switch and one kind, per character.
    lua(s, find("label", "Announce my milestones in guild chat") + `e.set(false)`);
    expect(lua(s, `return tostring(NS.milestones.enabled())`)).toBe("false");
    lua(s, find("label", "Announce my milestones in guild chat") + `e.set(true)`);
    lua(s, find("label", "Duel wins") + `e.set(false)`);
    expect(lua(s, `return tostring(NS.milestones.enabled("duel")) .. tostring(NS.milestones.enabled("hk"))`)).toBe("falsetrue");
    // The guild-wide milestone switch.
    lua(s, find("label", "Allow milestone announcements") + `e.set(false)`);
    expect(lua(s, `return tostring(NS.milestones.guildOff())`)).toBe("true");
    lua(s, find("label", "Allow milestone announcements") + `e.set(true)`);
    // The officer's own job.
    lua(s, find("label", "Promote linked Initiates to Member") + `e.set(false)`);
    expect(lua(s, `return tostring(NS.officerNotes.enabled("promote"))`)).toBe("false");
    // Cycles: item tooltips, language, call alerts.
    lua(s, find("label", "Item tooltips: who can craft it") + `e.next()`);
    expect(lua(s, `return GuildedDB.settings.tooltipCrafters`)).toBe("full");
    lua(s, find("label", "Language") + `e.next()`);
    expect(lua(s, `return GuildedDB.settings.language`)).toBe("en");
    lua(s, find("label", "Call for help alerts") + `e.next()`);
    expect(lua(s, `return GuildedDB.settings.helpAlert`)).toBe("chat");
    expect(problems(s)).toEqual([]);
  });
});

describe("the page builds", () => {
  const OLD_PROFILE = `{ settings = { modules = { bidding = false }, chatEvents = { join = false }, language = "fr", minimapHidden = true, chatTab = true }, digest = { enabled = false }, milestones = { chars = {} } }`;
  it.each([["fresh profile", "nil", 5], ["old profile", OLD_PROFILE, 5], ["fresh officer", "nil", 1], ["old officer", OLD_PROFILE, 1]] as const)(
    "without errors on a %s, every tab, and refreshes from the saved values", (_name, saved, rank) => {
      const s = addon(rank, saved);
      expect(lua(s, `
        local parent = CreateFrame()
        UI = NS.settingsPage.build(parent, { width = 660, left = 16, top = -90 })
        for _, key in ipairs(NS.settingsPage.visibleTabs()) do UI.select(key) end
        UI.update()
        return tostring(#UI.rows > 5) .. tostring(UI.current)`)).toBe("trueadvanced");
      // The real page registers itself at login and reads the same saved values.
      expect(lua(s, `return tostring(#NS.options.switches() > 20)`)).toBe("true");
      expect(lua(s, `NS.options.refresh(); return "ok"`)).toBe("ok");
      expect(problems(s)).toEqual([]);
    });

  it("clicking a check box changes the saved value, and the officer tab is not drawn for a member", () => {
    const s = addon(5, `{ settings = {}, digest = {} }`);
    lua(s, `
      UI = NS.settingsPage.build(CreateFrame(), { width = 660 })
      UI.select("chat")
      for _, row in ipairs(UI.rows) do
        if row.e.label == "Main names in chat" then row.box.checked = true; row.box.scripts.OnClick(row.box) end
      end`);
    expect(lua(s, `return tostring(GuildedDB.settings.chatTags)`)).toBe("true");
    // A member asking for the officer tab gets General instead.
    expect(lua(s, `UI.select("officers"); return UI.current`)).toBe("general");
  });

  it("lets the Settings page of the window open the game's options", () => {
    const s = addon(1);
    expect(lua(s, `return type(NS.options.open) .. type(NS.openAdvancedSettings)`)).toBe("functionfunction");
  });

  it.each(["fr", "de", "es"])("fits every button label in %s", (language) => {
    const s = addon(1, `{ settings = { language = "${language}" }, digest = {} }`);
    expect(lua(s, `
      UI = NS.settingsPage.build(CreateFrame(), { width = 660 })
      for _, key in ipairs(NS.settingsPage.visibleTabs()) do UI.select(key) end
      local out = {}
      for _, f in ipairs(FRAMES) do
        if f.template == "UIPanelButtonTemplate" and f.text ~= "" and f.width < #f.text * 6 + 20 then out[#out + 1] = f.text .. "=" .. f.width end
      end
      return table.concat(out, " | ")`)).toBe("");
  });
});
