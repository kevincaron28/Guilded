import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

// Guild overview page (Modules/GuildOverview.lua, ROADMAP item 17, variant A): classes and levels
// of the whole guild from the game roster, drawn on plain frames in the Guilded window.
let s: LuaSession | undefined;
afterEach(() => { s?.close(); s = undefined; });

// Frames that remember text, values, colours and visibility, with separate font strings.
const FRAMES = String.raw`
  function CreateFrame(kind)
    local f = { kind = kind, scripts = {}, shown = true, text = "", value = 0, points = {} }
    setmetatable(f, { __index = function(_, k) return function(self) return self end end })
    f.SetScript = function(self, name, fn) self.scripts[name] = fn end
    f.HookScript = function(self, name, fn) self.scripts[name] = fn end
    f.GetScript = function(self, name) return self.scripts[name] end
    f.Show = function(self) self.shown = true end
    f.Hide = function(self) self.shown = false end
    f.IsShown = function(self) return self.shown end
    f.SetText = function(self, v) self.text = v or "" end
    f.GetText = function(self) return self.text end
    f.SetValue = function(self, v) self.value = v end
    f.SetMinMaxValues = function(self, a, b) self.min = a; self.max = b end
    f.SetStatusBarColor = function(self, r, g, b) self.color = { r, g, b } end
    f.SetPoint = function(self, ...) table.insert(self.points, { ... }) end
    f.CreateFontString = function() return CreateFrame("FontString") end
    f.CreateTexture = function() return CreateFrame("Texture") end
    FRAMES[#FRAMES + 1] = f
    return f
  end
`;

function setup(lang = "en") {
  s = newLuaSession();
  s.run(FRAMES);
  s.run(String.raw`
    LANG = "${lang}"
    function GetMaxPlayerLevel() return 60 end
    function GetGuildInfo() return "Quebec Gold", "Member", 3 end
    SHOW_OFFLINE = true
    function GetGuildRosterShowOffline() return SHOW_OFFLINE end
    RAID_CLASS_COLORS = { WARRIOR = { r = 0.78, g = 0.61, b = 0.43 }, MAGE = { r = 0.25, g = 0.78, b = 0.92 }, PRIEST = { r = 1, g = 1, b = 1 } }
    ROSTER_ASKED = 0
    C_GuildInfo = { GuildRoster = function() ROSTER_ASKED = ROSTER_ASKED + 1 end }
    -- name, level, class, classFile, online, days since last online
    ROSTER = {
      { "Kev-Realm", 60, "Warrior", "WARRIOR", true, 0 },
      { "Ann-Realm", 60, "Mage", "MAGE", true, 0 },
      { "Bo-Realm", 55, "Warrior", "WARRIOR", false, 2 },
      { "Cy-Realm", 42, "Priest", "PRIEST", false, 30 },
      { "Dee-Realm", 12, "Warrior", "WARRIOR", true, 0 },
      { "Eve-Realm", 5, "Mage", "MAGE", false, 8 },
    }
    function GetNumGuildMembers() return #ROSTER end
    function GetGuildRosterInfo(i) local r = ROSTER[i]; return r[1], "Member", 3, r[2], r[3], "Zone", "", "", r[5], 0, r[4] end
    function GetGuildRosterLastOnline(i) local r = ROSTER[i]; if r[5] then return nil end; return 0, 0, r[6], 0 end
    NS = { getSettings = function() return { language = LANG } end,
      getDb = function() return { peerRoster = { ["Ann"] = { status = "READY" }, ["Cy"] = { status = "READY" } } } end,
      playerName = function() return "Kev" end,
      isSecret = function() return false end,
      normalizeName = function(n) return n and (n:match("^[^-]+")) end }
  `);
  s.load("Locale.lua");
  s.load("Modules/GuildOverview.lua");
  return s;
}

function buildPage() {
  s!.run(`PAGE = CreateFrame("Frame")
    HELPERS = { width = 582,
      newLabel = function(parent, text) local l = parent:CreateFontString(); l:SetText(text ~= "" and NS.L(text) or ""); return l end,
      newButton = function(parent, text, width, onClick) local b = CreateFrame("Button"); b:SetText(NS.L(text)); b:SetScript("OnClick", onClick); return b end,
      at = function(widget) return widget end }
    VIEW = NS.guildOverview.buildPage(PAGE, HELPERS)
    PAGE.scripts.OnShow(PAGE)`);
}

const bars = (list: "classBars" | "levelBars") => s!.run(`local t = {}
  for _, bar in ipairs(VIEW.${list}) do if bar.shown then t[#t + 1] = bar.label.text .. "=" .. bar.count.text end end
  return table.concat(t, ",")`);

describe("guild overview", () => {
  it("counts members, online, active this week and Guilded users from the game roster", () => {
    setup();
    s!.run(`DATA = NS.guildOverview.collect()`);
    expect(s!.run(`return DATA.members .. ":" .. DATA.online .. ":" .. DATA.active .. ":" .. DATA.guilded`)).toBe("6:3:4:3");
    expect(s!.run(`return NS.guildOverview.headerText(DATA)`)).toBe("Quebec Gold   6 members   3 online   Active this week: 4   Guilded: 3 / 6");
    expect(s!.run(`return tostring(DATA.complete)`)).toBe("true");
  });

  it("lists classes by size with online / total, and level bands with the top level first", () => {
    setup();
    buildPage();
    expect(bars("classBars")).toBe("Warrior=2 / 3,Mage=1 / 2,Priest=0 / 1");
    expect(bars("levelBars")).toBe("Level 60=2,50-59=1,40-49=1,30-39=0,10-29=1,1-9=1");
    // Class colours from the game's table; the top-level band stands out in gold.
    expect(s!.run(`return table.concat(VIEW.classBars[2].color, ",")`)).toBe("0.25,0.78,0.92");
    expect(s!.run(`return table.concat(VIEW.levelBars[1].color, ",")`)).toBe("1,0.82,0");
    expect(s!.run(`return VIEW.classBars[1].max .. ":" .. VIEW.classBars[1].value`)).toBe("3:3");
    // Opening the page asks the game for a fresh roster.
    expect(s!.run(`return tostring(ROSTER_ASKED)`)).toBe("1");
  });

  it("names the online members of a class in its tooltip", () => {
    setup();
    buildPage();
    expect(s!.run(`return table.concat(VIEW.classBars[1].tipLines, "|")`)).toBe("Online now:|Dee-Realm|Kev-Realm");
    expect(s!.run(`return table.concat(VIEW.classBars[3].tipLines, "|")`)).toBe("Nobody of this class is online.");
  });

  it("fits other level caps", () => {
    setup();
    const bands = (cap: number) => s!.run(`local t = {} for _, b in ipairs(NS.guildOverview.levelBands(${cap})) do t[#t + 1] = b.label end return table.concat(t, ",")`);
    expect(bands(60)).toBe("60,50-59,40-49,30-39,10-29,1-9");
    expect(bands(70)).toBe("70,60-69,50-59,40-49,10-39,1-9");
    expect(bands(80)).toBe("80,70-79,60-69,50-59,10-49,1-9");
  });

  it("says so when offline members are hidden, and when there is no guild", () => {
    setup();
    s!.run(`SHOW_OFFLINE = false`);
    buildPage();
    expect(s!.run(`return VIEW.note.text`)).toContain("online members only");
    s!.run(`function IsInGuild() return false end; NS.guildOverview.refresh()`);
    expect(s!.run(`return VIEW.header.text`)).toBe("Join a guild to see the guild overview.");
    expect(bars("classBars")).toBe("");
  });

  it("redraws on a roster update only while the page is shown", () => {
    setup();
    buildPage();
    s!.run(`C_Timer = { After = function(_, fn) fn() end }
      ROSTER[#ROSTER + 1] = { "Fay-Realm", 60, "Priest", "PRIEST", true, 0 }
      PAGE.shown = false; fire_event("GUILD_ROSTER_UPDATE")`);
    expect(s!.run(`return VIEW.header.text`)).toContain("6 members");
    s!.run(`PAGE.shown = true; fire_event("GUILD_ROSTER_UPDATE")`);
    expect(s!.run(`return VIEW.header.text`)).toContain("7 members");
  });

  it("is translated in French, German and Spanish", () => {
    for (const [lang, word] of [["fr", "membres"], ["de", "Mitglieder"], ["es", "miembros"]]) {
      setup(lang);
      buildPage();
      expect(s!.run(`return VIEW.header.text`)).toContain(word);
      expect(s!.run(`return VIEW.levelBars[1].label.text`)).not.toBe("Level 60");
      s!.close(); s = undefined;
    }
  });
});
