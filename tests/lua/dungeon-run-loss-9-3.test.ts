import { afterEach, describe, expect, it } from "vitest";
import { exportDungeonRuns } from "../../companion/lua-export-content.mjs";
import { newLuaSession, type LuaSession } from "./harness.js";

// 9.3 run-loss work (docs: backups/run-loss/RUN_LOSS_TRACE_2026-11-13.md): the final-boss journal lookup is retried,
// an ABANDONED run says why once and keeps a diagnostic, a guildmate's copy can complete it, parked guilds export,
// and every player carries the guild the game reported.
let session: LuaSession;
afterEach(() => session?.close());

function start(options: { locale?: string; instance?: string } = {}) {
  session = newLuaSession();
  session.run(`NS = {}; GuildedDB = nil; function GetLocale() return "${options.locale ?? "enUS"}" end
    C_Timer = { After = function() end, NewTicker = function() return {} end }`);
  for (const file of ["Core.lua", "Locale.lua", "DungeonRoutes.lua", "Compat.lua", "Modules/Dungeon.lua"]) session.load(file);
  session.run(`fire_event("PLAYER_LOGIN")
    GetBuildInfo = function() return "1.60.1", "70790", "date", 16001 end
    STAMP = 1800000000
    NS.compat.serverTime = function() return STAMP end
    INSTANCE = ${options.instance ?? '{id=2970, type="party", name="The Drowned City", difficultyId=1}'}
    NS.compat.instance = function() return INSTANCE end
    MOCK_UNITS = { player = { name = "Tester" } }
    NS.isGuildMember = function() return true end
    fire_event("PLAYER_ENTERING_WORLD")
    fire_event("PLAYER_REGEN_DISABLED")
    RUN_ID = GuildedDB.dungeon.current.id
    STAMP = STAMP + 600`);
  session.chat();
  return session;
}

describe("final boss journal lookup is retried", () => {
  it("learns the final boss on a later quiet tick when the run started without the journal", () => {
    const s = start();
    s.run(`JOURNAL = nil; NS.compat.dungeonBosses = function() return JOURNAL end`);
    s.run('fire_event("ZONE_CHANGED_NEW_AREA")');
    expect(s.run("return tostring(GuildedDB.dungeon.current.finalEncounterId)")).toBe("nil");
    // A kill of a boss the addon cannot call final yet leaves the run open.
    s.run('fire_event("ENCOUNTER_END",777,"Last Boss",0,5,1)');
    expect(s.run("return GuildedDB.dungeon.current.state")).toBe("ACTIVE");
    // In combat the journal is not read.
    s.run(`JOURNAL = { { id = 555, name = "First" }, { id = 777, name = "Last Boss" } }; NS.compat.inCombat = function() return true end`);
    s.run('fire_event("ZONE_CHANGED_NEW_AREA")');
    expect(s.run("return tostring(GuildedDB.dungeon.current.finalEncounterId)")).toBe("nil");
    s.run("NS.compat.inCombat = function() return false end");
    s.run('fire_event("ZONE_CHANGED_NEW_AREA")');
    expect(s.run("return GuildedDB.dungeon.current.finalEncounterId")).toBe("777");
    expect(s.run("return GuildedDB.dungeon.current.bossCount")).toBe("2");
    s.run('STAMP = STAMP + 60; fire_event("ENCOUNTER_END",777,"Last Boss",0,5,1)');
    expect(s.run("return GuildedDB.dungeon.runs[RUN_ID].state")).toBe("COMPLETED");
  });

  it("still never completes on a wipe or an unknown boss", () => {
    const s = start();
    s.run(`NS.compat.dungeonBosses = function() return { { id = 555, name = "First" }, { id = 777, name = "Last Boss" } } end`);
    s.run('fire_event("ZONE_CHANGED_NEW_AREA"); fire_event("ENCOUNTER_END",777,"Last Boss",0,5,0); fire_event("ENCOUNTER_END",555,"First",0,5,1)');
    expect(s.run("return GuildedDB.dungeon.current.state")).toBe("ACTIVE");
  });
});

describe("an abandoned run is never silent", () => {
  const abandonAfterKill = (s: LuaSession) => {
    s.run(`fire_event("ENCOUNTER_END",101,"Early Boss",0,5,1)
      INSTANCE = nil; STAMP = STAMP + 100; fire_event("ZONE_CHANGED_NEW_AREA")
      STAMP = STAMP + 16 * 60; fire_event("ZONE_CHANGED_NEW_AREA")`);
  };

  it("tells the member once and saves a compact diagnostic on the run", () => {
    const s = start();
    abandonAfterKill(s);
    expect(s.run("return GuildedDB.dungeon.runs[RUN_ID].state")).toBe("ABANDONED");
    const text = s.chat().join("\n");
    expect(text).toContain("will not count");
    expect(text).toContain("/guilded dungeon check");
    expect(text.match(/will not count/g)).toHaveLength(1);
    const diagnostic = s.run("return GuildedDB.dungeon.runs[RUN_ID].diagnostic");
    expect(diagnostic).toBe("i=2970;d=1;ed=forever;k=1;f=unknown;last=101/Early Boss;why=left the dungeon");
    expect(diagnostic.length).toBeLessThanOrEqual(240);
    expect(s.run("return tostring(GuildedDB.dungeon.runs[RUN_ID].explained)")).toBe("true");
  });

  it("prints one explanation line per session even when several runs end abandoned, and still saves each diagnostic", () => {
    const s = start();
    abandonAfterKill(s);
    s.run(`local second = { id = "RUN-SECOND", state = "ABANDONED", gameEdition = "forever", instanceId = 2970, name = "The Drowned City", difficultyId = 1,
      startedAt = 1, endedAt = 99, endReason = "left the dungeon", players = {}, encounters = { { id = 5, name = "B", success = true, at = 50, source = "native" } } }
      NS.dungeon.explain(second)`);
    expect(s.chat().join("\n").match(/will not count/g)).toHaveLength(1);
    expect(s.run("return GuildedDB.dungeon.runs[RUN_ID].diagnostic")).toContain("i=2970");
    expect(s.run("return tostring(NS.dungeon.explainedThisSession)")).toBe("true");
  });

  it("is said in French on a French client", () => {
    const s = start({ locale: "frFR" });
    abandonAfterKill(s);
    expect(s.chat().join("\n")).toContain("ne comptera donc pas");
  });

  it("says nothing for a run with no boss killed or one the member abandoned by hand, but still saves the note for hand-abandoned runs", () => {
    const quiet = start();
    quiet.run(`INSTANCE = nil; STAMP = STAMP + 100; fire_event("ZONE_CHANGED_NEW_AREA"); STAMP = STAMP + 16 * 60; fire_event("ZONE_CHANGED_NEW_AREA")`);
    expect(quiet.chat().join("\n")).not.toContain("will not count");
    const manual = start();
    manual.run('fire_event("ENCOUNTER_END",101,"Early Boss",0,5,1); NS.commandHandlers.dungeon({"abandon"})');
    expect(manual.chat().join("\n")).not.toContain("will not count");
    expect(manual.run("return GuildedDB.dungeon.runs[RUN_ID].diagnostic")).toContain("why=manual");
  });
});

describe("a guildmate's copy completes an abandoned run", () => {
  // Ragefire Chasm (389, final boss Bazzalan 2735 in Compat.lua).
  const ragefire = '{id=389, type="party", name="Ragefire Chasm", difficultyId=0}';
  const abandonedRun = `GuildedDB.dungeon.runs.R1 = {
    id="R1", state="ABANDONED", gameEdition="forever", instanceId=389, name="Ragefire Chasm", difficultyId=0,
    startedAt=1000, endedAt=4041, durationSec=3041, endReason="group disbanded", synced=true,
    players={ Tester={presentSec=2111, deaths=0}, Friend={presentSec=2111, addon=true} },
    encounters={ {id=2732,name="Oggleflint",success=true,at=1100,source="native"} } }`;
  const peerCopy = (kill: string, state = "COMPLETED") => `PEER = NS.dungeon.deserialize("R1", "v=1;av=9.3.0;st=${state};i=389;n=Ragefire Chasm;d=0;s=1000;e=2000;cb=${state === "COMPLETED" ? "final boss" : "left"};r=Friend;enc=2732,2735;p=Friend:WARRIOR:TANK:0:1000:1,Tester:MAGE:DPS:0:1000:1;tl=2732:Oggleflint:1:1100:,${kill}")`;

  it("recovers from the kill a guildmate saved, inside our own window", () => {
    const s = start({ instance: ragefire });
    s.run(abandonedRun);
    s.run(peerCopy("2735:Bazzalan:1:2000:"));
    expect(s.run("return PEER ~= nil and PEER.state")).toBe("COMPLETED");
    // A complete SUM from a player who was in the run.
    s.run(`local summary = NS.dungeon.serialize(PEER)
      local id, total = "R1", math.ceil(#summary / 200)
      for part = 1, total do
        fire_event("CHAT_MSG_ADDON", "GuildedDgn", string.format("SUM|%s|%d|%d|%s", id, part, total, string.sub(summary, (part - 1) * 200 + 1, part * 200)), "GUILD", "Friend")
      end`);
    expect(s.run("return GuildedDB.dungeon.runs.R1.state")).toBe("COMPLETED");
    expect(s.run("return GuildedDB.dungeon.runs.R1.completedBy")).toBe("final boss");
    expect(s.run("return GuildedDB.dungeon.runs.R1.endedAt")).toBe("2000");
    expect(s.run("return tostring(GuildedDB.dungeon.runs.R1.synced)")).toBe("nil");
    expect(s.run("return GuildedDB.dungeon.runs.R1.recoveredFrom.via")).toBe("Friend");
    expect(s.chat().join("\n")).toContain("guildmate's copy");
  });

  it("marks a peer-recovered run, exports no native source for the peer kill, and copes with no encounters table or an over-long name", () => {
    const s = start({ instance: ragefire });
    s.run(abandonedRun.replace("encounters={ {id=2732,name=\"Oggleflint\",success=true,at=1100,source=\"native\"} } }", "encounters={} }"));
    s.run(peerCopy("2735:Bazzalan:1:2000:"));
    s.run(`local summary = NS.dungeon.serialize(PEER)
      fire_event("CHAT_MSG_ADDON", "GuildedDgn", string.format("SUM|R1|1|1|%s", summary), "GUILD", "Friend")`);
    expect(s.run("return GuildedDB.dungeon.runs.R1.state")).toBe("COMPLETED");
    expect(s.run("return tostring(GuildedDB.dungeon.runs.R1.peerConfirmed)")).toBe("true");
    const name = s.run("local e = GuildedDB.dungeon.runs.R1.encounters; return e[#e].name");
    expect(name.length).toBeLessThanOrEqual(60);
    const saved = JSON.parse(s.run(`local out = {} for _, e in ipairs(GuildedDB.dungeon.runs.R1.encounters) do out[#out + 1] = string.format('{"id":%d,"success":true,"at":%d,"viaPeer":%s}', e.id, e.at, '"x"') end return "[" .. table.concat(out, ",") .. "]"`));
    const [exported] = exportDungeonRuns({ dungeon: { runs: { R1: { id: "R1", state: "COMPLETED", completedBy: "final boss", instanceId: 389, startedAt: 1000, endedAt: 2000, peerConfirmed: true, encounters: saved, players: {} } } } }, "Forever") as Array<{ peerConfirmed?: boolean; encounters: Array<{ source?: string }> }>;
    expect(exported?.peerConfirmed).toBe(true);
    // The peer kill carries no source at all (an older bot would drop every encounter on an unknown source); the marker is peerConfirmed.
    expect(exported?.encounters.every((e) => e.source === undefined)).toBe(true);
  });

  it("a run the client recovered from its own kill is not peer-confirmed", () => {
    const s = start({ instance: ragefire });
    s.run(`GuildedDB.dungeon.runs.R2 = { id="R2", state="ABANDONED", gameEdition="forever", instanceId=389, name="Ragefire Chasm", difficultyId=0,
      startedAt=1000, endedAt=4041, endReason="left", players={}, encounters={ {id=2735,name="Bazzalan",success=true,at=2000,source="native"} } }`);
    expect(s.run("return NS.dungeon.recoverRuns()")).toBe("1");
    expect(s.run("return tostring(GuildedDB.dungeon.runs.R2.peerConfirmed)")).toBe("nil");
  });

  it("prints at most one recovery line however many runs a login recovers from guildmates", () => {
    const s = start({ instance: ragefire });
    for (const id of ["R1", "R3"]) {
      s.run(abandonedRun.replace(/R1/g, id));
      s.run(`PEER = NS.dungeon.deserialize("${id}", "v=1;av=9.3.0;st=COMPLETED;i=389;n=Ragefire Chasm;d=0;s=1000;e=2000;cb=final boss;r=Friend;enc=2735;p=Friend:WARRIOR:TANK:0:1000:1,Tester:MAGE:DPS:0:1000:1;tl=2735:Bazzalan:1:2000:")
        fire_event("CHAT_MSG_ADDON", "GuildedDgn", string.format("SUM|${id}|1|1|%s", NS.dungeon.serialize(PEER)), "GUILD", "Friend")`);
    }
    expect(s.run("return GuildedDB.dungeon.runs.R3.state")).toBe("COMPLETED");
    expect(s.chat().filter((line) => line.includes("guildmate's copy")).length).toBe(1);
  });

  it("does not complete from a non-final kill, a kill outside our window, a stranger, or an ABANDONED copy", () => {
    const send = (s: LuaSession, sender: string) => s.run(`local summary = NS.dungeon.serialize(PEER)
      fire_event("CHAT_MSG_ADDON", "GuildedDgn", string.format("SUM|R1|1|1|%s", summary), "GUILD", "${sender}")`);
    for (const [kill, sender, state] of [
      ["2734:Jergosh the Invoker:1:2000:", "Friend", "COMPLETED"],
      ["2735:Bazzalan:1:5000:", "Friend", "COMPLETED"],
      ["2735:Bazzalan:1:2000:", "Stranger", "COMPLETED"],
      ["2735:Bazzalan:1:2000:", "Friend", "ABANDONED"]
    ] as Array<[string, string, string]>) {
      const s = start({ instance: ragefire });
      s.run(abandonedRun);
      s.run(peerCopy(kill, state));
      send(s, sender);
      expect(s.run("return GuildedDB.dungeon.runs.R1.state")).toBe("ABANDONED");
    }
  });
});

describe("each player's guild", () => {
  it("records the guild the game reports, keeps it when unknown for a moment, and leaves it out when none", () => {
    const s = start();
    s.run(`MOCK_UNITS = { player = { name = "Tester" }, party1 = { name = "Friend" }, party2 = { name = "Loner" } }
      MOCK_GROUP_SIZE = 3
      GUILDS = { player = "Qu\\195\\169bec Gold", party1 = "Other Guild", party2 = nil }
      function GetGuildInfo(unit) return GUILDS[unit] end
      function IsInGroup() return true end
      fire_event("GROUP_ROSTER_UPDATE")`);
    const players = "GuildedDB.dungeon.current.players";
    expect(s.run(`return ${players}.Tester.guild`)).toBe("Québec Gold");
    expect(s.run(`return ${players}.Friend.guild`)).toBe("Other Guild");
    expect(s.run(`return tostring(${players}.Loner.guild)`)).toBe("nil");
    // Out of range for a moment: the earlier answer stays.
    s.run('GUILDS.party1 = nil; STAMP = STAMP + 30; fire_event("GROUP_ROSTER_UPDATE")');
    expect(s.run(`return ${players}.Friend.guild`)).toBe("Other Guild");
    // A guildmate's copy carries it too (summary field gu=).
    const summary = s.run("return NS.dungeon.serialize(GuildedDB.dungeon.current)");
    expect(summary).toContain(";gu=");
    s.run(`PEER = NS.dungeon.deserialize("X", NS.dungeon.serialize(GuildedDB.dungeon.current))`);
    expect(s.run("return PEER.players.Friend.guild")).toBe("Other Guild");
    // Guild data comes after the timeline and integrity fields, so it never crowds them out.
    expect(summary.indexOf(";gu=")).toBeGreaterThan(summary.indexOf(";iv=2"));
  });
});

describe("export", () => {
  const run = (over: Record<string, unknown> = {}) => ({
    id: "R1", state: "COMPLETED", completedBy: "final boss", instanceId: 389, name: "Ragefire Chasm", difficultyId: 0,
    startedAt: 1000, endedAt: Math.floor(Date.now() / 1000) - 3600, gameEdition: "forever", encounters: {},
    players: { Tester: { class: "MAGE", presentSec: 100, deaths: 0, guild: "Québec Gold" }, Friend: { class: "WARRIOR", presentSec: 100, deaths: 1 } }, ...over
  });

  it("passes each player's guild through and leaves old runs without one valid", () => {
    const players = (exportDungeonRuns({ dungeon: { runs: { R1: run() } } }, "Forever") as Array<{ players: Array<Record<string, unknown>> }>)[0]?.players ?? [];
    expect(players.find((p) => p["character"] === "Tester")?.["guild"]).toBe("Québec Gold");
    expect(players.find((p) => p["character"] === "Friend")).not.toHaveProperty("guild");
  });

  it("passes the abandoned-run diagnostic", () => {
    const [exported] = exportDungeonRuns({ dungeon: { runs: { R1: run({ state: "ABANDONED", completedBy: undefined, diagnostic: "i=2970;k=1" }) } } }, "Forever");
    expect((exported as { diagnostic?: string }).diagnostic).toBe("i=2970;k=1");
  });
});
