import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

let session: LuaSession;
afterEach(() => session?.close());

// Ids and names below are what WoW Forever (interface 16001) reported for the guild's
// Ragefire Chasm run of 5 November 2026: instance 389, difficulty 0, encounters 2732-2735.
function foreverRun(instance = "{id=389, type=\"party\", name=\"Ragefire Chasm\", difficultyId=0}") {
  session = newLuaSession();
  session.run("NS = {}; GuildedDB = nil");
  session.load("Core.lua");
  session.load("DungeonRoutes.lua");
  session.load("Compat.lua");
  session.load("Modules/Dungeon.lua");
  session.run(`fire_event("PLAYER_LOGIN")
    GetBuildInfo = function() return "1.60.1", "70790", "date", 16001 end
    STAMP = 1800000000
    NS.compat.serverTime = function() return STAMP end
    INSTANCE = ${instance}
    NS.compat.instance = function() return INSTANCE end
    fire_event("PLAYER_ENTERING_WORLD")
    fire_event("PLAYER_REGEN_DISABLED")
    RUN_ID = GuildedDB.dungeon.current.id
    STAMP = STAMP + 600`);
  return session;
}

describe("Forever dungeon final-boss detection", () => {
  it("completes Ragefire Chasm on Bazzalan (2735) after the earlier bosses", () => {
    const s = foreverRun();
    for (const [id, name] of [[2732, "Oggleflint"], [2733, "Taragaman the Hungerer"], [2734, "Jergosh the Invoker"]]) {
      s.run(`STAMP=STAMP+300; fire_event("BOSS_KILL",${id},"${name}"); fire_event("ENCOUNTER_END",${id},"${name}",0,5,1)`);
      expect(s.run("return GuildedDB.dungeon.current.state")).toBe("ACTIVE");
    }
    s.run('STAMP=STAMP+300; fire_event("ENCOUNTER_END",2735,"Bazzalan",0,5,1); fire_event("BOSS_KILL",2735,"Bazzalan")');
    expect(s.run("return GuildedDB.dungeon.runs[RUN_ID].state")).toBe("COMPLETED");
    expect(s.run("return GuildedDB.dungeon.runs[RUN_ID].completedBy")).toBe("final boss");
    expect(s.run("return #GuildedDB.dungeon.runs[RUN_ID].encounters")).toBe("4");
  });

  it("recognises a final boss by name inside its own dungeon even when the id is unknown", () => {
    const s = foreverRun();
    s.run('fire_event("ENCOUNTER_END",9999,"Jergosh the Invoker",0,5,1)');
    expect(s.run("return GuildedDB.dungeon.current.state")).toBe("ACTIVE");
    s.run('fire_event("ENCOUNTER_END",9998,"bazzalan",0,5,1)');
    expect(s.run("return GuildedDB.dungeon.runs[RUN_ID].state")).toBe("COMPLETED");
    // The same name elsewhere proves nothing.
    expect(s.run('return tostring(NS.compat.isDungeonFinalBoss(36,9998,"Bazzalan",0))')).toBe("false");
    // A wipe never completes.
    const w = foreverRun();
    w.run('fire_event("ENCOUNTER_END",2735,"Bazzalan",0,5,0)');
    expect(w.run("return GuildedDB.dungeon.current.state")).toBe("ACTIVE");
  });

  it("does not apply the Forever name table to Classic Era", () => {
    const s = foreverRun();
    s.run('GetBuildInfo = function() return "1.15.7", "1", "date", 11507 end');
    expect(s.run('return tostring(NS.compat.isDungeonFinalBoss(389,1,"Bazzalan",0))')).toBe("false");
  });
});

describe("recovering runs that ended ABANDONED after the final boss died", () => {
  const stored = (extra = "") => `GuildedDB.dungeon.runs.R1 = {
    id="R1", state="ABANDONED", gameEdition="forever", instanceId=389, name="Ragefire Chasm", difficultyId=0,
    startedAt=1000, endedAt=4041, durationSec=3041, endReason="left the dungeon", synced=true,
    players={ Tester={presentSec=2111, deaths=0, integrity={knownSec=2111, unknownSec=900, mixedRole=false, knownIntervals={{1000,3111}}} },
              Friend={presentSec=2111} },
    encounters={
      {id=2732,name="Oggleflint",success=true,at=1100,source="native"},
      ${extra}
    }}`;

  it("completes the run from its own saved native kill and trims the evidence to that kill", () => {
    const s = foreverRun();
    s.run(stored('{id=2735,name="Bazzalan",success=true,at=2000,source="native"}'));
    expect(s.run("return NS.dungeon.recoverRuns()")).toBe("1");
    const run = "GuildedDB.dungeon.runs.R1";
    expect(s.run(`return ${run}.state`)).toBe("COMPLETED");
    expect(s.run(`return ${run}.completedBy`)).toBe("final boss");
    expect(s.run(`return ${run}.endedAt`)).toBe("2000");
    expect(s.run(`return ${run}.durationSec`)).toBe("1000");
    expect(s.run(`return tostring(${run}.synced)`)).toBe("nil");
    expect(s.run(`return tostring(${run}.endReason)`)).toBe("nil");
    expect(s.run(`return ${run}.players.Tester.presentSec`)).toBe("1000");
    expect(s.run(`return ${run}.players.Tester.integrity.knownSec`)).toBe("1000");
    expect(s.run(`return ${run}.players.Tester.integrity.knownIntervals[1][2]`)).toBe("2000");
    expect(s.run(`return ${run}.recoveredFrom.state`)).toBe("ABANDONED");
    // Recovered once only.
    expect(s.run("return NS.dungeon.recoverRuns()")).toBe("0");
  });

  it("never invents a completion", () => {
    const s = foreverRun();
    // No final-boss kill, a final boss that died before the start, a failed attempt and a combat-log guess.
    s.run(stored(`{id=2734,name="Jergosh the Invoker",success=true,at=1500,source="native"},
      {id=2735,name="Bazzalan",success=false,at=1600,source="native"},
      {id=2735,name="Bazzalan",success=true,at=900,source="native"},
      {id=11519,name="Bazzalan",kind="npc",success=true,at=1700,source="combat-log"},
      {id=2735,name="Bazzalan",success=true,at=5000,source="native"}`));
    expect(s.run("return NS.dungeon.recoverRuns()")).toBe("0");
    expect(s.run("return GuildedDB.dungeon.runs.R1.state")).toBe("ABANDONED");
    expect(s.run("return tostring(GuildedDB.dungeon.runs.R1.synced)")).toBe("true");
  });

  it("leaves runs saved by another WoW edition alone", () => {
    const s = foreverRun();
    s.run(stored('{id=2735,name="Bazzalan",success=true,at=2000,source="native"}'));
    s.run('GuildedDB.dungeon.runs.R1.gameEdition="classic-era"');
    expect(s.run("return NS.dungeon.recoverRuns()")).toBe("0");
  });

  it("exports the recovered run to the companion as COMPLETED by final boss", () => {
    const s = foreverRun();
    s.run(stored('{id=2735,name="Bazzalan",success=true,at=2000,source="native"}'));
    s.run("NS.dungeon.recoverRuns()");
    const summary = s.run("return NS.dungeon.serialize(GuildedDB.dungeon.runs.R1)");
    expect(summary).toContain("st=COMPLETED");
    expect(summary).toContain("cb=final boss");
    expect(summary).toContain("e=2000");
    expect(summary).toContain("enc=2732,2735");
  });
});

// The Drowned City (instance 2970), from the guild's runs of 10-14 November 2026: Min'loth the Serpent (3479) was the last boss of both full clears.
describe("The Drowned City final boss", () => {
  const city = () => foreverRun('{id=2970, type="party", name="The Drowned City", difficultyId=1}');

  it("ends the run on Min'loth the Serpent after the other bosses, by id or by name", () => {
    const s = city();
    for (const [id, name] of [[3474, "Zul'Alai"], [3511, "Primeval Elemental"], [3475, "Var'Taka"], [3476, "Captain Dreadrise"], [3478, "Deathless Guardians"]]) {
      s.run(`STAMP=STAMP+300; fire_event("ENCOUNTER_END",${id},"${name}",0,5,1)`);
      expect(s.run("return GuildedDB.dungeon.current.state")).toBe("ACTIVE");
    }
    s.run(`STAMP=STAMP+300; fire_event("ENCOUNTER_END",3479,"Min'loth the Serpent",0,5,1)`);
    expect(s.run("return GuildedDB.dungeon.runs[RUN_ID].state")).toBe("COMPLETED");
    expect(s.run("return GuildedDB.dungeon.runs[RUN_ID].completedBy")).toBe("final boss");
    expect(s.run(`return tostring(NS.compat.isDungeonFinalBoss(2970,9999,"Min'loth the Serpent",1))`)).toBe("true");
    expect(s.run(`return tostring(NS.compat.isDungeonFinalBoss(2970,3474,"Zul'Alai",1))`)).toBe("false");
    expect(s.run("return tostring(NS.compat.dungeonFinalKnown(2970))")).toBe("true");
  });

  it("does not end the run on a wipe of the final boss", () => {
    const s = city();
    s.run(`fire_event("ENCOUNTER_END",3479,"Min'loth the Serpent",0,5,0)`);
    expect(s.run("return GuildedDB.dungeon.current.state")).toBe("ACTIVE");
  });
});
