import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";
import { check, expectedCopy, SHARED, tocFiles } from "../../scripts/build-dungeons-addon.mjs";

// Guilded Dungeons (7.0): the standalone addon, loaded from its own .toc order.
let s: LuaSession;
afterEach(() => s?.close());

function load(withGuilded: boolean) {
  s = newLuaSession();
  s.run(`NS = {}; GuildedDB = nil; GuildedDungeonsDB = nil
    C_AddOns = { IsAddOnLoaded = function(name) return ${withGuilded ? "name == \"Guilded\"" : "false"} end }`);
  for (const file of tocFiles()) {
    const source = readFileSync(new URL(`../../addon/GuildedDungeons/${file}`, import.meta.url), "utf8");
    s.run(`loadaddon("GuildedDungeons", [=====[${source}]=====], NS)`);
  }
  s.run(`fire_event("PLAYER_LOGIN")
    STAMP = 1800000000
    NS.compat.serverTime = function() return STAMP end
    INSTANCE = {id=389, type="party", name="Ragefire Chasm", difficultyId=1}
    NS.compat.instance = function() return INSTANCE end
    NS.compat.isDungeonFinalBoss = function(_, id) return id == 9000 end`);
}

function playRun() {
  s.run(`fire_event("PLAYER_ENTERING_WORLD")
    fire_event("PLAYER_REGEN_DISABLED")
    STAMP = STAMP + 900
    fire_event("ENCOUNTER_END", 9000, "Bazzalan", 1, 5, 1)`);
}

describe("Guilded Dungeons without Guilded", () => {
  it("records a whole run in its own SavedVariables", () => {
    load(false);
    playRun();
    expect(s.run("local n=0; for _ in pairs(GuildedDungeonsDB.dungeon.runs) do n=n+1 end; return tostring(n)")).toBe("1");
    expect(s.run("local _, run = next(GuildedDungeonsDB.dungeon.runs); return run.state .. ':' .. run.completedBy .. ':' .. run.name")).toBe("COMPLETED:final boss:Ragefire Chasm");
    expect(s.run("return tostring(GuildedDB)")).toBe("nil");
    expect(s.run("return GuildedDungeonsDB.character.name .. '-' .. GuildedDungeonsDB.character.realm .. ':' .. GuildedDungeonsDB.character.class")).toBe("Tester-TestRealm:WARRIOR");
  });

  it("answers its own slash command", () => {
    load(false);
    s.run(`SlashCmdList["GUILDEDDUNGEONS"]("status")`);
    expect(s.chat().join("\n")).toContain("[Guilded Dungeons] No dungeon run in progress");
    s.run(`SlashCmdList["GUILDEDDUNGEONS"]("nonsense")`);
    expect(s.chat().at(-1)).toContain("/gdungeons status");
    s.run(`SlashCmdList["GUILDEDDUNGEONS"]("score top")`);
    expect(s.chat().at(-1)).toContain("snapshot contains only your character");
  });
});

// 9.1.4 (owner report, 10 November 2026: "people with Guilded Dungeons and no companion don't get synced"). The
// standalone addon had no ns.isGuildMember / ns.isOfficerName, so Transport.lua refused every guild message.
describe("Guilded Dungeons hears its guild", () => {
  const hear = (text: string, sender: string, channel = "GUILD") => s.run(`fire_event("CHAT_MSG_ADDON", "GuildedDgn", ${JSON.stringify(text)}, "${channel}", "${sender}")`);
  const runId = () => s.run("local id = next(GuildedDungeonsDB.dungeon.runs); return id");
  const via = () => s.run("local _, run = next(GuildedDungeonsDB.dungeon.runs); return tostring(run.syncedVia)");
  function guild() {
    load(false);
    s.run(`ROSTER = { { "Boss-TestRealm", 0 }, { "Lebowski-TestRealm", 4 }, { "Tester-TestRealm", 5 } }
      function GetNumGuildMembers() return #ROSTER end
      function GetGuildRosterInfo(i) return ROSTER[i][1], "Rank", ROSTER[i][2] end`);
    playRun();
    // The harness has no unit for the player, so the recorded run lists nobody: put its author in it.
    s.run(`local _, run = next(GuildedDungeonsDB.dungeon.runs); run.players.Tester = { presentSec = 900 }`);
  }

  it("knows guild members and officers from the game's roster", () => {
    guild();
    expect(s.run(`return tostring(NS.isGuildMember("Lebowski-TestRealm")) .. tostring(NS.isGuildMember("Stranger")) .. tostring(NS.isOfficerName("Boss")) .. tostring(NS.isOfficerName("Lebowski"))`)).toBe("truefalsetruefalse");
    expect(s.run(`return tostring(NS.comm.authorized("Lebowski-TestRealm", "guild")) .. tostring(NS.comm.authorized("Stranger-TestRealm", "guild")) .. tostring(NS.comm.authorized("Lebowski-TestRealm", "officer"))`)).toBe("truefalsefalse");
    // No roster yet (just logged in): nobody is trusted.
    s.run("ROSTER = {}");
    expect(s.run(`return tostring(NS.isGuildMember("Lebowski"))`)).toBe("false");
  });

  it("stops replaying a run once a guildmate's bot confirms it", () => {
    guild();
    const id = runId();
    s.run(`SUMS = 0; NS.comm.send = function(_, text) if text:match("^SUM|") then SUMS = SUMS + 1 end return true end
      NS.dungeon.lastReplay = nil; NS.dungeon.replayPending()`);
    expect(Number(s.run("return tostring(SUMS)"))).toBeGreaterThan(0);
    hear(`ACK|${id}`, "Stranger-TestRealm");
    hear(`ACK|${id}`, "Lebowski-TestRealm", "PARTY");
    expect(via()).toBe("nil");
    hear(`ACK|${id}`, "Lebowski-TestRealm");
    expect(via()).toBe("Lebowski");
    s.run("SUMS = 0; NS.dungeon.lastReplay = nil; NS.dungeon.replayPending()");
    expect(s.run("return tostring(SUMS)")).toBe("0");
    s.run(`SlashCmdList["GUILDEDDUNGEONS"]("status")`);
    expect(s.chat().at(-1)).toContain("Saved runs: 1 (0 waiting to reach Discord).");
  });

  it("replays for an officer's request only, and keeps no copies of guildmates' runs", () => {
    guild();
    s.run("NS.dungeon.lastReplay = nil");
    hear("REQUEST|1", "Lebowski-TestRealm");
    expect(s.run("return tostring(NS.dungeon.lastReplay)")).toBe("nil");
    hear("REQUEST|1", "Boss-TestRealm");
    expect(s.run("return tostring(NS.dungeon.lastReplay ~= nil)")).toBe("true");
    hear("SUM|someone-else|1|2|abc", "Lebowski-TestRealm");
    expect(s.run("return tostring(next(NS.dungeon.incoming))")).toBe("nil");
  });
});

// 9.3.0 (owner report, 13 November 2026: runs recorded by the standalone addon never reached the board): the
// companion needs the guild key and every character of the account, like full Guilded saves.
describe("Guilded Dungeons saves who it belongs to", () => {
  it("writes the guild key, edition and the logging-in character", () => {
    load(false);
    expect(s.run("return GuildedDungeonsDB.guildKey")).toBe("Test Guild-TestRealm");
    expect(s.run("return GuildedDungeonsDB.guildEdition")).toBe("forever");
    expect(s.run("local c = GuildedDungeonsDB.myCharacters['Tester']; return c.name .. ':' .. c.realm .. ':' .. c.class .. ':' .. c.level .. ':' .. c.guildKey")).toBe("Tester:TestRealm:WARRIOR:60:Test Guild-TestRealm");
    expect(s.run("return GuildedDungeonsDB.character.name")).toBe("Tester");
  });

  it("keeps every alt of the account and updates the guild when it changes", () => {
    load(false);
    s.run(`UnitName = function() return "Altone" end; fire_event("PLAYER_LOGIN")`);
    s.run(`UnitName = function() return "Alttwo" end; GetGuildInfo = function() return "Other Guild", "Member", 3, "OtherRealm" end; fire_event("PLAYER_LOGIN")`);
    expect(s.run("local n = {}; for k in pairs(GuildedDungeonsDB.myCharacters) do n[#n+1] = k end; table.sort(n); return table.concat(n, ',')")).toBe("Altone,Alttwo,Tester");
    expect(s.run("return GuildedDungeonsDB.myCharacters.Altone.guildKey")).toBe("Test Guild-TestRealm");
    expect(s.run("return GuildedDungeonsDB.myCharacters.Alttwo.guildKey")).toBe("Other Guild-OtherRealm");
    expect(s.run("return GuildedDungeonsDB.guildKey")).toBe("Other Guild-OtherRealm");
    expect(s.run("return GuildedDungeonsDB.character.name")).toBe("Alttwo");
  });

  it("notices the guild once the client knows it (guild info empty at login)", () => {
    load(false);
    s.run(`GuildedDungeonsDB.guildKey = nil; GuildedDungeonsDB.myCharacters = nil
      IsInGuild = function() return false end; fire_event("PLAYER_LOGIN")`);
    expect(s.run("return tostring(GuildedDungeonsDB.guildKey)")).toBe("nil");
    expect(s.run("return tostring(GuildedDungeonsDB.myCharacters.Tester.guildKey)")).toBe("nil");
    s.run(`IsInGuild = function() return true end; fire_event("PLAYER_GUILD_UPDATE", "player")`);
    expect(s.run("return GuildedDungeonsDB.guildKey")).toBe("Test Guild-TestRealm");
  });

  it("loads an old file without these fields and fills them in", () => {
    s = newLuaSession();
    s.run(`NS = {}; GuildedDB = nil; C_AddOns = { IsAddOnLoaded = function() return false end }
      GuildedDungeonsDB = { settings = {}, character = { name = "Old", realm = "TestRealm" }, dungeon = { runs = {} } }`);
    for (const file of tocFiles()) {
      const source = readFileSync(new URL(`../../addon/GuildedDungeons/${file}`, import.meta.url), "utf8");
      s.run(`loadaddon("GuildedDungeons", [=====[${source}]=====], NS)`);
    }
    s.run(`fire_event("PLAYER_LOGIN")`);
    expect(s.run("return GuildedDungeonsDB.guildKey")).toBe("Test Guild-TestRealm");
  });

  it("stays quiet when Guilded is installed", () => {
    load(true);
    expect(s.run("return tostring(GuildedDungeonsDB.guildKey) .. tostring(GuildedDungeonsDB.myCharacters)")).toBe("nilnil");
  });

  // The companion matches the Discord server from this key, so it must be spelled exactly like full Guilded's.
  it("spells the guild key exactly like full Guilded", () => {
    const cases = [
      { guild: "Test Guild", home: "", realm: "TestRealm" },
      { guild: "Québec Gold", home: "CAMWOWUS2Realm2PvP", realm: "CAMWOW US2 Realm 2 PvP" },
      { guild: "Québec Gold", home: "", realm: "CAMWOW US2 Realm 2 PvP" },
    ];
    for (const c of cases) {
      const setup = `GetGuildInfo = function() return ${JSON.stringify(c.guild)}, "R", 1, ${JSON.stringify(c.home)} end
        GetRealmName = function() return ${JSON.stringify(c.realm)} end`;
      load(false);
      s.run(setup);
      const standalone = s.run("return NS.currentGuildKey()");
      s.close();
      s = newLuaSession();
      s.run(`GuildedDB = nil; NS = {}`);
      s.load("Core.lua");
      s.load("Compat.lua");
      s.run(setup);
      const full = s.run("return NS.currentGuildKey()");
      expect(standalone).toBe(full);
      expect(standalone).toMatch(/^Québec Gold-|^Test Guild-/);
    }
  });
});

describe("Guilded Dungeons next to Guilded", () => {
  it("stays quiet so Guilded alone counts the run", () => {
    load(true);
    playRun();
    expect(s.run("return tostring(GuildedDungeonsDB.dungeon)")).toBe("nil");
    s.run(`SlashCmdList["GUILDEDDUNGEONS"]("status")`);
    expect(s.chat().join("\n")).toContain("Guilded is installed");
    expect(s.run("return tostring(SENT == nil)")).toBe("true");
  });
});

describe("one source of truth", () => {
  it("ships exact copies of Guilded's dungeon files, in load order", () => {
    expect(() => check()).not.toThrow();
    expect(tocFiles()).toEqual(["Shim.lua", "Shared/Util.lua", "Shared/Transport.lua", "Shared/Compat.lua", "Shared/Locale.lua", "Shared/DungeonRoutes.lua", "Shared/Dungeon.lua", "Shared/DungeonArt.lua", "Shared/RunResults.lua", "Shared/Scores.lua", "Shared/SeasonDetails.lua", "Shared/DungeonStats.lua", "Shared/DungeonScorePanel.lua", "Accepted.lua", "Main.lua"]);
    for (const file of SHARED) expect(expectedCopy(file)).toContain(readFileSync(new URL(`../../addon/Guilded/${file}`, import.meta.url), "utf8").replace(/\r\n/g, "\n").slice(0, 200));
  });
});
