import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";
import { rosterPrelude } from "./roster-tools.test.js";
import { noteIsWritable, professionNoteTag } from "../../src/services/profession-note.js";

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

describe("profession note tool", () => {
  it("previews only empty or tag-only public notes and writes one reviewed note per click", () => {
    setup();
    // Amy's note is a person's own words: kept. Bob's is empty: writable.
    s.run('ROWS[3].public=""; ROWS[2].public="Alt of Kevin"; fire_event("GUILD_ROSTER_UPDATE")');
    expect(s.run('local p,c=NS.rosterProfessions.plan(); return tostring(c)')).toBe("1");
    s.run('local plan=assert(NS.rosterProfessions.preview()); assert(NS.rosterTools.confirm(plan.phrase)); assert(NS.rosterTools.step())');
    expect(s.run('return #CALLS')).toBe("1");
    expect(s.run('return CALLS[1][1]..":"..CALLS[1][2]')).toBe("3:Mine150");
  });
  it("never touches officer notes, yourself, or a note that already matches", () => {
    setup();
    s.run('ROWS[2].public="Alch300 Herb225"; ROWS[3].public=""; DB.peerRoster["Boss-Realm"]={professions="Mining:300"}; fire_event("GUILD_ROSTER_UPDATE")');
    const tsv = s.run('return NS.rosterProfessions.plan()');
    expect(tsv).toBe("character\taction\tvalue\nBob-Realm\tpublic\tMine150");
    expect(tsv).not.toContain("officer");
    expect(tsv).not.toContain("Boss-Realm");
  });
  it("says so when there is nothing to update and needs a fresh roster", () => {
    setup();
    s.run('ROWS[2].public="Alch300 Herb225"; ROWS[3].public="Mine150"; fire_event("GUILD_ROSTER_UPDATE")');
    expect(s.run('local t,m=NS.rosterProfessions.plan(); return tostring(t)..":"..m')).toBe("nil:No public notes to update.");
    s.run("CLOCK=200");
    expect(s.run('local t=NS.rosterProfessions.plan(); return tostring(t)')).toBe("nil");
  });
  it("is blocked for non-officers and writes nothing without the click", () => {
    setup();
    s.run("OFFICER=false");
    expect(s.run('local t=NS.rosterProfessions.plan(); return tostring(t)')).toBe("nil");
    expect(s.run("return #CALLS")).toBe("0");
  });
});

describe("guild roster tooltip", () => {
  it("adds profession lines with icons and survives a missing tooltip", () => {
    setup();
    s.run(String.raw`
      LINES = {}
      GameTooltip = { AddLine = function(_, t) LINES[#LINES + 1] = t end, Show = function() end }
      NS.rosterProfessions.decorate({ memberInfo = { name = "Amy-Realm" } })`);
    expect(s.run('return table.concat(LINES, "|")')).toContain("Alchemy 300|");
    expect(s.run('return table.concat(LINES, "|")')).toContain("Trade_Alchemy");
    s.run("GameTooltip = nil; NS.rosterProfessions.decorate({ memberInfo = { name = 'Amy-Realm' } })");
  });
  it("hooks Blizzard's roster button once and tolerates a missing hook API", () => {
    setup();
    s.run(`HOOKS = {}; hooksecurefunc = function(t, k, fn) HOOKS[#HOOKS + 1] = k end; GuildRosterButton_OnEnter = function() end`);
    s.run("NS.rosterProfessions.install(); NS.rosterProfessions.install()");
    expect(s.run('return table.concat(HOOKS, ",")')).toBe("GuildRosterButton_OnEnter");
    s.run("hooksecurefunc = nil; NS.rosterProfessions.install()");
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
    s.run("NS.showCopyText=function() end; NS.promotion.open(); NS.commandHandlers.promote({ 'promote' }); fire_event('PLAYER_LOGIN')");
    expect(s.run("return #CALLS")).toBe("0");
  });
  it("rejects names that could carry extra rows", () => {
    setup(); s.run(rows);
    expect(s.run('local ok=NS.promotion.promote("Amy-Realm\\tpromote\\t\\nBob-Realm"); return tostring(ok)')).toBe("false");
    expect(s.run("return #CALLS")).toBe("0");
  });
});
