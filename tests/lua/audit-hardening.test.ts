import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";
import { parseAddonExportText } from "../../companion/lua-export-content.mjs";
import { parseAddonSnapshot } from "../../src/integrations/addon.js";

// The October 2026 audit: entries that poisoned an officer's upload, awards with no raid core,
// /guilded void, and awards shared between officers in the same raid. Real Lua, mocked game.
let s: LuaSession;
afterEach(() => s?.close());

function setup(before = ""): LuaSession {
  s = newLuaSession();
  s.run(`GuildedDB=nil; NS={}; SENT={}; MOCK_UNITS={player={name="Kev"}} ${before}`);
  s.load("Core.lua"); s.load("Compat.lua"); s.load("Modules/Sync.lua"); s.load("Modules/Loot.lua");
  s.run('fire_event("PLAYER_LOGIN")');
  return s;
}
const ledgerCount = (name: string) => s.run(`return tostring(GuildedDB.epgp.${name} and #GuildedDB.epgp.${name}.ledger or 0)`);
const inRaidWith = (...names: string[]) => s.run(`MOCK_RAID=true; MOCK_GROUP_SIZE=${names.length}
  ${names.map((name, index) => `MOCK_UNITS.raid${index + 1}={name="${name}"}`).join("\n")}
  GetRaidRosterInfo=function(i) return MOCK_UNITS["raid"..i] and MOCK_UNITS["raid"..i].name end`);

describe("awards that used to poison the upload", () => {
  it("refuses an amount that rounds to zero instead of writing a zero entry", () => {
    setup().run('SlashCmdList.GUILDED("award Bob 0.4 test reason")');
    expect(ledgerCount("Bob")).toBe("0");
    expect(s.chat().join("\n")).toContain("Usage: /guilded award");
    s.run('SlashCmdList.GUILDED("award Bob 0.6 test reason")');
    expect(s.run("return GuildedDB.epgp.Bob.ledger[1].epAmount")).toBe("1");
  });

  it("refuses an award with no raid core in a guild that keeps points per core", () => {
    setup().run(`GuildedDB.lootRules={default="EPGP",coreOnly=true,values={},cores={{id="a",name="A",pool=true,baseGp=0,players={}}}}
      SlashCmdList.GUILDED("award Bob 50 Raid attendance")`);
    expect(ledgerCount("Bob")).toBe("0");
    expect(s.chat().join("\n")).toContain("Pick the core first");
    s.run('NS.getSettings().activeCore="a"; SlashCmdList.GUILDED("award Bob 50 Raid attendance")');
    expect(s.run("return GuildedDB.epgp.Bob.ledger[1].coreId")).toBe("a");
  });

  it("prints the totals of the pool the award went to", () => {
    setup().run(`GuildedDB.lootRules={default="EPGP",values={},cores={{id="a",name="A",pool=true,baseGp=0,players={Bob={ep=100,gp=50,pr=2}}}}}
      NS.getSettings().activeCore="a"
      SlashCmdList.GUILDED("award Bob 50 Raid attendance")`);
    expect(s.chat().at(-1)).toContain("Bob EP 150, GP 50 (Raid attendance), PR 3.000.");
  });

  it("warns when loot is recorded with no raid running in a core-only guild", () => {
    setup().run(`GuildedDB.lootRules={default="EPGP",coreOnly=true,values={},cores={}}
      SlashCmdList.GUILDED("loot Bob Test Sword 30")`);
    expect(s.chat().join("\n")).toContain("No raid is running");
  });
});

describe("a guildmate's digest cannot spoil the officer's upload", () => {
  it("keeps only well-formed digest fields", () => {
    setup().run('fire_event("CHAT_MSG_ADDON", "Guilded", "READINESS|Mallory|WEIRD|999|-5|:300,Alchemy:300,Mining|I:WARRIOR,Human,999,Arms", "GUILD", "Mallory-TestRealm")');
    expect(s.run(`local p = GuildedDB.peerRoster.Mallory
      return p.status .. "|" .. p.missing .. "|" .. p.minDurability .. "|" .. p.professions .. "|" .. p.identity.level`)).toBe("UNKNOWN|20|0|Alchemy:300|0");
    s.run('fire_event("CHAT_MSG_ADDON", "Guilded", "READINESS|Eve|READY|0|100||I:not a class,Human,60,x", "GUILD", "Eve")');
    expect(s.run("return tostring(GuildedDB.peerRoster.Eve.identity)")).toBe("nil");
  });

  it("exports saved data poisoned by an older addon without a single rejected row", () => {
    const lua = `GuildedDB = { epgp = { ["Bob"] = { ep = 50, gp = 0, ledger = {
        [1] = { id = "Kev-1-1", epAmount = 50, gpAmount = 0, type = "EP_AWARD", reason = "Raid", at = "2026-09-24T00:00:00Z", by = "Kev" },
        [2] = { id = "Kev-1-2", epAmount = 0, gpAmount = 0, type = "EP_AWARD", reason = "zero", at = "2026-09-24T00:00:00Z", by = "Kev" },
        [3] = { id = "Kev-1-3", epAmount = 10, gpAmount = 0, type = "EP_AWARD", reason = "oops", at = "2026-09-24T00:00:00Z", by = "Kev", voided = "2026-09-24T01:00:00Z" } } } },
      peerRoster = { ["Mallory"] = { status = "READY", missing = 0, minDurability = 100, professions = ":300,Alchemy:300", updatedAt = "2026-09-24T00:00:00Z",
        identity = { class = "WARRIOR", race = "Human", level = 999, spec = "Arms" } } },
      exports = { ["2026-09-24T00:00:00Z"] = { exportedAt = "2026-09-24T00:00:00Z" } } }`;
    const snapshot = parseAddonSnapshot(parseAddonExportText(lua, "TestRealm"));
    expect(snapshot.rejected).toEqual([]);
    expect(snapshot.epgpTransactions.map((row) => [row.sourceRef, row.voided ?? false])).toEqual([["qg:Kev-1-1", false], ["qg:Kev-1-3", true]]);
    expect(snapshot.characters[0]).toMatchObject({ name: "Mallory", level: 0, professions: [{ name: "Alchemy", skillLevel: 300 }] });
  });
});

describe("alts stay with the guild they are in", () => {
  it("does not add a character of another guild to the first guild's alt list", () => {
    s = newLuaSession();
    s.run(`GuildedDB = { guildKey = "Guild A-TestRealm", myCharacters = { Kev = { name = "Kev", class = "WARRIOR", capturedAt = "2026-01-01T00:00:00Z" } } }
      NS = {}; MOCK_UNITS = { player = { name = "Altb" } }
      function GetGuildInfo() return "Guild B", "Member", 5 end`);
    s.load("Core.lua"); s.load("Compat.lua");
    s.run('fire_event("PLAYER_LOGIN"); fire_event("PLAYER_ENTERING_WORLD")');
    expect(s.run('return tostring(GuildedDB.otherGuilds["Guild A-TestRealm"].myCharacters.Altb)')).toBe("nil");
    expect(s.run("return GuildedDB.guildKey .. '|' .. tostring(GuildedDB.myCharacters.Altb ~= nil)")).toBe("Guild B-TestRealm|true");
  });
});

describe("/guilded void", () => {
  const withStandings = `GuildedDB.standings={updatedAt="2026-09-29T00:00:00Z",from="companion",baseGp=0,players={Ann={ep=100,gp=10,pr=10}}}`;

  it("takes back an entry Discord never had: it stops counting and is exported as voided", () => {
    setup().run(`${withStandings}
      SlashCmdList.GUILDED("gp Ann 30 Wrong player")`);
    expect(s.run('return NS.effectiveStanding("Ann").gp')).toBe("40");
    s.run('SlashCmdList.GUILDED("void Ann")');
    expect(s.run('return NS.effectiveStanding("Ann").gp')).toBe("10");
    expect(s.run("local e = GuildedDB.epgp.Ann.ledger[1]; return tostring(e.voided ~= nil) .. tostring(e.pending) .. tostring(e.wasCounted) .. GuildedDB.epgp.Ann.gp")).toBe("truenilfalse0");
    expect(s.chat().at(-1)).toContain("Voided: Ann +30 GP (Wrong player)");
    s.run('SlashCmdList.GUILDED("void Ann")');
    expect(s.chat().at(-1)).toContain("no ledger entry to void");
  });

  it("takes an accepted entry back out until Discord's reversal arrives", () => {
    setup().run(`${withStandings}
      SlashCmdList.GUILDED("gp Ann 30 Wrong player")
      local e = GuildedDB.epgp.Ann.ledger[1]
      -- Discord imported it: the standings now include it.
      GuildedLedgerAccepted = { ["addon:qg:" .. e.id] = true }
      GuildedStandings = { updatedAt = "2026-09-30T00:00:00Z", baseGp = 0, players = { { name = "Ann", ep = 100, gp = 40 } } }
      GuildedDB.standings.updatedAt = "2026-09-29T00:00:00Z"`);
    s.run('STARTED = nil; fire_event("PLAYER_ENTERING_WORLD")');
    expect(s.run('return tostring(GuildedDB.epgp.Ann.ledger[1].pending) .. NS.effectiveStanding("Ann").gp')).toBe("nil40");
    s.run('SlashCmdList.GUILDED("void last")');
    expect(s.run('return NS.effectiveStanding("Ann").gp')).toBe("10");
  });

  it("voids the newest entry of all with 'last', only ones with an id", () => {
    setup().run('SlashCmdList.GUILDED("award Ann 10 first"); SlashCmdList.GUILDED("award Bob 20 second"); SlashCmdList.GUILDED("void")');
    expect(s.run("return tostring(GuildedDB.epgp.Ann.ledger[1].voided) .. tostring(GuildedDB.epgp.Bob.ledger[1].voided ~= nil)")).toBe("niltrue");
  });
});

describe("awards shared between officers in the same raid", () => {
  const raid = () => { setup(); inRaidWith("Kev", "Ann", "Pug"); s.run('GuildedDB.settings.officers.Ann = true'); };

  it("sends each award to the group with its ledger id", () => {
    raid();
    s.run('SENT = {}; SlashCmdList.GUILDED("gp Bob 30 Test loot")');
    expect(s.run("return SENT[#SENT].text")).toMatch(/^LEDGER\|Kev-1800000000-\d+\|Bob\|0\|30\|$/);
    s.run('SENT = {}; SlashCmdList.GUILDED("void Bob")');
    expect(s.run("return SENT[#SENT].text")).toMatch(/^LEDGERVOID\|Kev-1800000000-\d+$/);
  });

  it("counts another officer's award at once, and forgets it when they void it", () => {
    raid();
    s.run(`GuildedDB.standings={updatedAt="2026-09-29T00:00:00Z",from="companion",baseGp=0,players={Bob={ep=100,gp=10,pr=10}}}
      fire_event("CHAT_MSG_ADDON", "Guilded", "LEDGER|Ann-1800000000-7|Bob|0|40|", "RAID", "Ann-TestRealm")`);
    expect(s.run('return NS.effectiveStanding("Bob").gp')).toBe("50");
    // The same message again (a resend) does not count twice.
    s.run('fire_event("CHAT_MSG_ADDON", "Guilded", "LEDGER|Ann-1800000000-7|Bob|0|40|", "RAID", "Ann-TestRealm")');
    expect(s.run('return NS.effectiveStanding("Bob").gp')).toBe("50");
    s.run('fire_event("CHAT_MSG_ADDON", "Guilded", "LEDGERVOID|Ann-1800000000-7", "RAID", "Ann-TestRealm")');
    expect(s.run('return NS.effectiveStanding("Bob").gp')).toBe("10");
  });

  it("keeps a core's pool apart", () => {
    raid();
    s.run(`GuildedDB.lootRules={default="EPGP",values={},cores={{id="a",name="A",pool=true,baseGp=0,players={Bob={ep=100,gp=10,pr=10}}}}}
      fire_event("CHAT_MSG_ADDON", "Guilded", "LEDGER|Ann-1800000000-7|Bob|0|40|a", "RAID", "Ann")`);
    expect(s.run('return NS.effectiveStanding("Bob", "a").gp .. "|" .. NS.effectiveStanding("Bob").gp')).toBe("50|0");
  });

  it("ignores awards from a non-officer, from outside the group, on the guild channel, or under another officer's id", () => {
    raid();
    s.run(`fire_event("CHAT_MSG_ADDON", "Guilded", "LEDGER|Pug-1800000000-1|Bob|0|40|", "RAID", "Pug")
      fire_event("CHAT_MSG_ADDON", "Guilded", "LEDGER|Ann-1800000000-2|Bob|0|40|", "GUILD", "Ann")
      fire_event("CHAT_MSG_ADDON", "Guilded", "LEDGER|Kev-1800000000-3|Bob|0|40|", "RAID", "Ann")
      fire_event("CHAT_MSG_ADDON", "Guilded", "LEDGER|Ann-1800000000-4|Bob|0|0|", "RAID", "Ann")
      GuildedDB.settings.officers.Zed = true
      fire_event("CHAT_MSG_ADDON", "Guilded", "LEDGER|Zed-1800000000-5|Bob|0|40|", "RAID", "Zed")`);
    expect(s.run("return tostring(next(GuildedDB.peerLedger))")).toBe("nil");
  });

  it("drops a heard award once Discord has it, so it is never counted twice", () => {
    raid();
    s.run(`GuildedDB.standings={updatedAt="2026-09-29T00:00:00Z",from="companion",baseGp=0,players={Bob={ep=100,gp=10,pr=10}}}
      fire_event("CHAT_MSG_ADDON", "Guilded", "LEDGER|Ann-1800000000-7|Bob|0|40|", "RAID", "Ann")
      GuildedLedgerAccepted = { ["addon:qg:Ann-1800000000-7"] = true }
      GuildedStandings = { updatedAt = "2026-09-30T00:00:00Z", baseGp = 0, players = { { name = "Bob", ep = 100, gp = 50 } } }
      fire_event("PLAYER_ENTERING_WORLD")`);
    expect(s.run('return tostring(next(GuildedDB.peerLedger)) .. "|" .. NS.effectiveStanding("Bob").gp')).toBe("nil|50");
    // Only this PC's own references are kept in the saved data, not the whole list.
    expect(s.run("return tostring(next(GuildedDB.acceptedLedgerRefs))")).toBe("nil");
  });
});

describe("shared standings from a sender who stopped mid-way", () => {
  it("accepts the same snapshot from another officer after a pause", () => {
    setup().run(`GuildedDB.settings.officers.Ann = true; GuildedDB.settings.officers.Bea = true
      NOW = 1000; time = function() return NOW end
      fire_event("PLAYER_ENTERING_WORLD")
      fire_event("CHAT_MSG_ADDON", "GuildedSync", "STAND|2026-09-29T00:00:00.000Z|0|1|2|Ann:10:1", "GUILD", "Ann")
      fire_event("CHAT_MSG_ADDON", "GuildedSync", "STAND|2026-09-29T00:00:00.000Z|0|1|1|Ann:10:1;Bob:20:2", "GUILD", "Bea")`);
    // Too soon: Ann's snapshot is still in progress.
    expect(s.run("return tostring(GuildedDB.standings)")).toBe("nil");
    s.run(`NOW = 1040
      fire_event("CHAT_MSG_ADDON", "GuildedSync", "STAND|2026-09-29T00:00:00.000Z|0|1|1|Ann:10:1;Bob:20:2", "GUILD", "Bea")`);
    expect(s.run("return GuildedDB.standings.from .. GuildedDB.standings.players.Bob.ep")).toBe("Bea20");
  });
});
