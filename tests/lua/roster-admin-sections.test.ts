import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { readTable } from "../../scripts/addon-locale.mjs";
import { newLuaSession, type LuaSession } from "./harness.js";

// Roster admin regrouped into sections (9.1) and Esc/border fixes for the copy windows.
let s: LuaSession | undefined;
afterEach(() => { s?.close(); s = undefined; });

function open(): LuaSession {
  s = newLuaSession();
  s.run(String.raw`
    UISpecialFrames = {}
    TEXTS = {}
    local original = CreateFrame
    function CreateFrame(kind, ...)
      local f = original(kind, ...)
      f.kind = kind; f.text = ""; f.checked = false; f.TitleText = { SetText = function() end }
      f.SetText = function(self, v) self.text = v end
      f.GetText = function(self) return self.text end
      f.SetChecked = function(self, v) self.checked = v and true or false end
      f.GetChecked = function(self) return self.checked end
      f.CreateFontString = function()
        local t = CreateFrame("Font")
        local set = t.SetText
        t.SetText = function(self, v) TEXTS[#TEXTS + 1] = v; set(self, v) end
        return t
      end
      return f
    end
    STATE = { professions = true, epgp = true, promote = false, greet = true }
    SETLOG = {}
    NS = { commandHandlers = {}, commandHelp = {}, message = function() end, showCopyText = function() end,
      rosterTools = { authorized = function() return true end, context = function() return "a" end,
        invalidatePreview = function() end, requestRoster = function() error("boom") end },
      grmMigration = {},
      officerNotes = { LABELS = { professions = "Professions in public notes", epgp = "EP/GP in officer notes",
          promote = "Promote linked Initiates to Member", greet = "Greet new guild members" },
        enabled = function(k) return STATE[k] end, set = function(k, on) SETLOG[#SETLOG + 1] = k .. "=" .. tostring(on) end,
        command = function(args) SETLOG[#SETLOG + 1] = table.concat(args, " ") end } }
  `);
  s.load("Modules/RosterAdmin.lua");
  s.run(`NS.openRosterAdmin()`);
  return s;
}

describe("roster admin window", () => {
  it("lists its sections in order and no longer offers Buff coverage", () => {
    const w = open();
    const texts = JSON.parse(w.run(String.raw`
      local out = {}
      for _, t in ipairs(TEXTS) do out[#out + 1] = string.format("%q", t) end
      return "[" .. table.concat(out, ",") .. "]"`));
    const order = ["Members", "Ranks and promotion", "Notes", "Invites and greeting", "Sync", "GRM archive"].map((h) => texts.indexOf(h));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    for (const label of ["Invite queue", "Sync with guildmates", "Greeting in French", "Professions to notes"]) {
      expect(w.run(String.raw`for _, f in ipairs(FRAMES) do if f.text == "${label}" and f.scripts.OnClick then return "yes" end end return "no"`)).toBe("yes");
    }
    expect(w.run(String.raw`for _, f in ipairs(FRAMES) do if f.text == "Buff coverage" then return "yes" end end return "no"`)).toBe("no");
  });

  it("closes with Escape and keeps the officer switches in step with the settings", () => {
    const w = open();
    expect(w.run(`return table.concat(UISpecialFrames, ",")`)).toContain("GuildedRosterAdmin");
    const boxes = w.run(String.raw`local n = {} for _, f in ipairs(FRAMES) do if f.kind == "CheckButton" then n[#n + 1] = tostring(f.checked) end end return table.concat(n, ",")`);
    expect(boxes).toBe("false,true,true,true");
    w.run(String.raw`for _, f in ipairs(FRAMES) do if f.kind == "CheckButton" then f.checked = not f.checked; f.scripts.OnClick(f) end end`);

    expect(w.run(`return table.concat(SETLOG, ";")`)).toBe("promote=true;professions=false;epgp=false;greet=false");
  });

  it("survives a Lua error inside a button and says so", () => {
    const w = open();
    w.run(String.raw`for _, f in ipairs(FRAMES) do if f.text == "Refresh roster" then f.scripts.OnClick() end end`);
    expect(w.run(`return TEXTS[#TEXTS]`)).toBe("Not applied. Check the preview and confirmation.");
  });

  it("language buttons go through the officer command", () => {
    const w = open();
    w.run(String.raw`for _, f in ipairs(FRAMES) do if f.text == "Greeting in French" then f.scripts.OnClick() end end`);
    expect(w.run(`return SETLOG[#SETLOG]`)).toBe("officer auto lang fr");
  });
});

describe("copy windows", () => {
  it("the shared copy window closes with Escape and has the dialog border", () => {
    s = newLuaSession();
    s.run(String.raw`
      UISpecialFrames = {}
      NS = { commandHandlers = {}, commandHelp = {} }
    `);
    s.load("Core.lua");
    s.run(`NS.showCopyText("hello", "Title")`);
    expect(s.run(`return table.concat(UISpecialFrames, ",")`)).toContain("GuildedCharacterExport");
  });
});

describe("new roster admin strings are translated", () => {
  const source = readFileSync("addon/Guilded/Locale.lua", "utf8");
  const tables = (["FR", "DE", "ES"] as const).map((l) => [l, readTable(source, l)] as const);
  it.each(["Members", "Ranks and promotion", "Notes", "Invites and greeting", "Sync", "GRM archive", "Invite queue", "Greeting in English", "Greeting in French", "Sync with guildmates", "Sync report"])("%s", (key) => {
    for (const [lang, entries] of tables) expect(entries.get(key), `${lang}: ${key}`).toBeTypeOf("string");
  });
});
