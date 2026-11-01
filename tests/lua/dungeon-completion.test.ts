import { afterEach, describe, expect, it } from "vitest";
import { newLuaSession, type LuaSession } from "./harness.js";

let session: LuaSession;
afterEach(() => session?.close());

function activeRun() {
  session = newLuaSession();
  session.run("NS = {}; GuildedDB = nil");
  session.load("Core.lua");
  session.load("DungeonRoutes.lua");
  session.load("Compat.lua");
  session.run(`BLOCKED_REGISTRATIONS = 0
    local originalCreateFrame = CreateFrame
    CreateFrame = function(...)
      local frame = originalCreateFrame(...)
      frame.RegisterEvent = function(_, event)
        if event == "COMBAT_LOG_EVENT_UNFILTERED" or event == "COMBAT_LOG_EVENT" then
          -- Blizzard emits a forbidden action even if pcall catches an error.
          BLOCKED_REGISTRATIONS = BLOCKED_REGISTRATIONS + 1
          error("restricted combat-log event")
        end
      end
      return frame
    end`);
  session.load("Modules/Dungeon.lua");
  session.run(`fire_event("PLAYER_LOGIN")
    GetBuildInfo = function() return "1.60.1", "12345", "date", 16001 end
    STAMP = 1800000000
    NS.compat.serverTime = function() return STAMP end
    INSTANCE = {id=3065, type="party", name="Hall of Thanes", difficultyId=1}
    NS.compat.instance = function() return INSTANCE end
    fire_event("PLAYER_ENTERING_WORLD")
    fire_event("PLAYER_REGEN_DISABLED")
    RUN_ID = GuildedDB.dungeon.current.id
    STAMP = STAMP + 600`);
  return session;
}

describe("dungeon final-boss completion without the Encounter Journal", () => {
  it("rejects outsider and wrong-channel control messages before recorder adoption", () => {
    const s = activeRun();
    s.run(`NS.util.inMyGroup=function(name) return name=="Afriend" end
      NS.isGuildMember=function() return true end
      fire_event("CHAT_MSG_ADDON","GuildedDgn","START|hijacked|3065","WHISPER","Aoutsider")
      fire_event("CHAT_MSG_ADDON","GuildedDgn","START|hijacked|3065","PARTY","Aoutsider")
      fire_event("CHAT_MSG_ADDON","GuildedDgn","START|hijacked|3065","GUILD","Afriend")`);
    expect(s.run("return tostring(GuildedDB.dungeon.current.id==RUN_ID)")).toBe("true");
    s.run(`fire_event("CHAT_MSG_ADDON","GuildedDgn","START|group-run|3065","PARTY","Afriend")`);
    expect(s.run("return GuildedDB.dungeon.current.id")).toBe("group-run");
    s.run(`fire_event("CHAT_MSG_ADDON","GuildedDgn","END|group-run|COMPLETED|"..STAMP.."|peer","WHISPER","Afriend")`);
    expect(s.run("return GuildedDB.dungeon.current.state")).toBe("ACTIVE");
  });

  it("bounds partial guild summaries and expires old buffers", () => {
    const s = activeRun();
    s.run(`NS.isGuildMember=function(name) return name=="Guildmate" end
      fire_event("CHAT_MSG_ADDON","GuildedDgn","SUM|outsider|1|2|x","GUILD","Outsider")
      for i=1,100 do fire_event("CHAT_MSG_ADDON","GuildedDgn","SUM|run"..i.."|1|2|x","GUILD","Guildmate") end
      function pendingCount() local n=0; for _ in pairs(NS.dungeon.incoming) do n=n+1 end; return n end`);
    expect(s.run("return pendingCount()")).toBe("4");
    s.run(`STAMP=STAMP+61; fire_event("CHAT_MSG_ADDON","GuildedDgn","SUM|fresh|1|2|x","GUILD","Guildmate")`);
    expect(s.run("return pendingCount()")).toBe("1");
    s.run(`fire_event("CHAT_MSG_ADDON","GuildedDgn","SUM|fresh|2|3|y","GUILD","Guildmate")`);
    expect(s.run("return pendingCount()")).toBe("0");
  });
  it("does not let a group member add themselves to a previous run through a death message", () => {
    const s = activeRun();
    s.run(`NS.util.inMyGroup=function() return true end
      GuildedDB.dungeon.runs.old={id="old",players={Kev={deaths=1}}}
      fire_event("CHAT_MSG_ADDON","GuildedDgn","DEATH|old|Latecomer|5","PARTY","Latecomer")`);
    expect(s.run("return tostring(GuildedDB.dungeon.runs.old.players.Latecomer)")).toBe("nil");
    s.run(`fire_event("CHAT_MSG_ADDON","GuildedDgn","DEATH|old|Kev|3","PARTY","Kev")`);
    expect(s.run("return GuildedDB.dungeon.runs.old.players.Kev.deaths")).toBe("3");
  });

  it("retains native key, affixes and penalty-inclusive timer through reload and peer export", () => {
    const s = activeRun();
    s.run(`GetBuildInfo=function() return "12.1.5","12345","date",120105 end
      INSTANCE.difficultyId=8
      C_ChallengeMode={IsChallengeModeActive=function() return true end,
        GetActiveChallengeMapID=function() return 501 end,
        GetActiveKeystoneInfo=function() return 12,{9,3},true end,
        GetMapUIInfo=function() return "Fixture",501,1800 end,
        GetChallengeCompletionInfo=function() return {mapChallengeModeID=501,level=12,time=645123,
          onTime=true,practiceRun=false,isEligibleForScore=true} end}
      fire_event("CHALLENGE_MODE_START"); RUN_ID=GuildedDB.dungeon.current.id; STAMP=STAMP+600`);
    s.run('FRAMES={}'); s.load("Modules/Dungeon.lua");
    s.run(`fire_event("CHALLENGE_MODE_COMPLETED")
      SAVED=GuildedDB.dungeon.runs[RUN_ID]
      ROUNDTRIP=NS.dungeon.deserialize(RUN_ID,NS.dungeon.serialize(SAVED))`);
    expect(s.run('return SAVED.durationSec')).toBe("600");
    expect(s.run('return ROUNDTRIP.challenge.durationMs')).toBe("645123");
    expect(s.run('return ROUNDTRIP.challenge.level..":"..ROUNDTRIP.challenge.mapId..":"..table.concat(ROUNDTRIP.challenge.affixIds,",")')).toBe("12:501:3,9");
    expect(s.run('return tostring(ROUNDTRIP.challenge.eligibleForScore)..":"..tostring(ROUNDTRIP.challenge.practiceRun)..":"..tostring(ROUNDTRIP.challengeMode)')).toBe("true:false:true");
    s.load("Modules/RunResults.lua");
    expect(s.run('return NS.runResults.text(ROUNDTRIP)')).toContain("Mythic+ +12 - 10:45 - In time");
  });
  it("does not use a stale, mismatched or restricted native completion", () => {
    const s = activeRun();
    s.run(`GetBuildInfo=function() return "12.1.5","12345","date",120105 end
      ACTIVE={mapId=501,level=10,timeLimitSec=1800,affixIds={}}
      INFO={mapChallengeModeID=502,level=10,time=600000,onTime=true,practiceRun=false,isEligibleForScore=true}
      C_ChallengeMode={GetChallengeCompletionInfo=function() return INFO end}`);
    expect(s.run('return tostring(NS.compat.challengeCompletion(ACTIVE))')).toBe("nil");
    s.run('INFO.mapChallengeModeID=501; INFO.level=11');
    expect(s.run('return tostring(NS.compat.challengeCompletion(ACTIVE))')).toBe("nil");
    s.run('INFO.level=10; NS.isSecret=function(v) return v==600000 end');
    expect(s.run('return tostring(NS.compat.challengeCompletion(ACTIVE))')).toBe("nil");
    s.run('NS.isSecret=function() return false end; INFO.time=-1');
    expect(s.run('return tostring(NS.compat.challengeCompletion(ACTIVE))')).toBe("nil");
  });
  it("waits for challenge objectives, survives reload and separates reset attempts", () => {
    const s = activeRun();
    s.run(`GetBuildInfo=function() return "12.1.5","12345","date",120105 end
      C_ChallengeMode={IsChallengeModeActive=function() return true end}
      fire_event("CHALLENGE_MODE_START")
      RUN_ID=GuildedDB.dungeon.current.id
      GuildedDB.dungeon.current.finalEncounterId=999
      STAMP=STAMP+600
      fire_event("BOSS_KILL",999,"Final boss")
      fire_event("ENCOUNTER_END",999,"Final boss",8,5,1)`);
    expect(s.run('return GuildedDB.dungeon.current.state')).toBe("ACTIVE");
    s.run('FRAMES = {}'); s.load("Modules/Dungeon.lua");
    s.run('fire_event("CHALLENGE_MODE_COMPLETED")');
    expect(s.run('return GuildedDB.dungeon.runs[RUN_ID].completedBy')).toBe("challenge objectives");
    expect(s.run('return GuildedDB.dungeon.runs[RUN_ID].startTrigger')).toBe("challenge start");
    s.run('STAMP=STAMP+30; fire_event("CHALLENGE_MODE_START"); RESET_ID=GuildedDB.dungeon.current.id; fire_event("CHALLENGE_MODE_RESET")');
    expect(s.run('return GuildedDB.dungeon.runs[RESET_ID].state')).toBe("ABANDONED");
    expect(s.run('return GuildedDB.dungeon.runs[RUN_ID].state')).toBe("COMPLETED");
  });
  it("records the observed game build and timer trigger through peer summaries", () => {
    const s = activeRun();
    s.run('ROUNDTRIP=NS.dungeon.deserialize(RUN_ID, NS.dungeon.serialize(GuildedDB.dungeon.current))');
    expect(s.run('return ROUNDTRIP.gameBuild..":"..ROUNDTRIP.startTrigger')).toBe("12345:first combat");
    s.run('GuildedDB.dungeon.current.state="STARTING"; NS.commandHandlers.dungeon({"start"})');
    expect(s.run('return GuildedDB.dungeon.current.startTrigger')).toBe("manual");
  });
  it("queues one result on real finalization, preserves manual reopen, and never completes an early exit", () => {
    const s = activeRun();
    s.run(`QUEUED=0; SUMMARIES=0; MOCK_UNITS={player={name="Tester"}}
      NS.onDungeonResultReady=function(run) QUEUED=QUEUED+1; QUEUED_STATE=run.state end
      NS.onDungeonSummary=function() SUMMARIES=SUMMARIES+1 end
      INSTANCE=nil; fire_event("ZONE_CHANGED_NEW_AREA")`);
    expect(s.run("return GuildedDB.dungeon.current.state..':'..QUEUED")).toBe("ACTIVE:0");
    s.run(`INSTANCE={id=36,type="party",difficultyId=1}; GuildedDB.dungeon.current.instanceId=36
      fire_event("ZONE_CHANGED_NEW_AREA"); fire_event("BOSS_KILL",2747,"Edwin VanCleef")
      fire_event("ENCOUNTER_END",2747,"Edwin VanCleef",1,5,1)`);
    expect(s.run("return QUEUED..':'..QUEUED_STATE..':'..SUMMARIES")).toBe("1:COMPLETED:0");
    s.run('NS.commandHandlers.dungeon({"results"})');
    expect(s.run("return SUMMARIES")).toBe("1");
  });
  it.each(["ENCOUNTER_END", "BOSS_KILL"])("supports future verified wing endpoints on %s without shipping guessed mappings", event => {
    const s = activeRun();
    expect(s.run("return #NS.dungeonRoutes.verified")).toBe("0");
    s.run(`INSTANCE.id=90001; GuildedDB.dungeon.current.instanceId=90001
      NS.dungeonRoutes.verified={{instanceId=90001, participationBand={difficultyId=1},
        verification={build="SYNTHETIC",runRef="FIXTURE"}, completion={ids={9000},names={"Fictive endpoint","Boss final fictif"}}}}
      fire_event("ENCOUNTER_END",9000,"Fictive endpoint",1,5,0)`);
    expect(s.run("return GuildedDB.dungeon.current.state")).toBe("ACTIVE");
    expect(s.run('return tostring(NS.compat.isDungeonFinalBoss(90001,9000,"Fictive endpoint",2))')).toBe("false");
    expect(s.run('return tostring(NS.compat.isDungeonFinalBoss(90002,9000,"Fictive endpoint",1))')).toBe("false");
    expect(s.run('return tostring(NS.compat.isDungeonFinalBoss(90001,9999,"Boss final fictif",1))')).toBe("true");
    s.run(`fire_event("${event}",9000,"Localized endpoint",1,5,1)`);
    expect(s.run("return GuildedDB.dungeon.runs[RUN_ID].completedBy")).toBe("final boss");
  });
  it("refuses conflicting wing endpoints and unverified configuration", () => {
    const s = activeRun();
    s.run(`local route={instanceId=90001,participationBand={difficultyId=1},completion={ids={9000},names={}}}
      NS.dungeonRoutes.verified={route}
      UNVERIFIED=NS.compat.isDungeonFinalBoss(90001,9000,"",1)
      route.verification={build="SYNTHETIC",runRef="FIXTURE"}
      NS.dungeonRoutes.verified={route,route}`);
    expect(s.run("return tostring(UNVERIFIED)")).toBe("false");
    expect(s.run('return tostring(NS.compat.isDungeonFinalBoss(90001,9000,"",1))')).toBe("false");
  });
  it.each(["ENCOUNTER_END", "BOSS_KILL"])("finishes Deadmines on %s before the group disbands", (event) => {
    const s = activeRun();
    s.run(`INSTANCE.id=36; GuildedDB.dungeon.current.instanceId=36
      fire_event("ENCOUNTER_END", 2747, "Edwin VanCleef", 1, 5, 0)
      fire_event("BOSS_KILL", 2746, "Cookie")`);
    expect(s.run("return GuildedDB.dungeon.current.state")).toBe("ACTIVE");
    // The owner observed encounter 2747 in map 36. Completion must also work
    // with a localized name, duplicate kill events, and the subsequent disband.
    s.run(`fire_event("${event}", 2747, "Localized final boss", 1, 5, 1)
      fire_event("BOSS_KILL", 2747, "Localized final boss")
      INSTANCE = nil
      fire_event("ZONE_CHANGED_NEW_AREA")
      NS.compat.inGroup = function() return false end
      fire_event("GROUP_ROSTER_UPDATE")`);
    expect(s.run("return GuildedDB.dungeon.runs[RUN_ID].state")).toBe("COMPLETED");
    expect(s.run("return GuildedDB.dungeon.runs[RUN_ID].completedBy")).toBe("final boss");
    expect(s.run("return GuildedDB.dungeon.runs[RUN_ID].durationSec")).toBe("600");
    expect(s.run("return #GuildedDB.dungeon.runs[RUN_ID].encounters")).toBe("3");
    expect(s.run("return tostring(GuildedDB.dungeon.current)")).toBe("nil");
  });

  it.each(["Bloodmage Thalnos", "Arcanist Doan", "Mage de sang Thalnos", "Arcaniste Doan"])("completes the Scarlet wing on %s without guessing encounter IDs", (boss) => {
    const s = activeRun();
    s.run(`INSTANCE.id=189; GuildedDB.dungeon.current.instanceId=189
      fire_event("BOSS_KILL",987,${JSON.stringify(boss)})`);
    expect(s.run("return GuildedDB.dungeon.runs[RUN_ID].state")).toBe("COMPLETED");
    expect(s.run("return GuildedDB.dungeon.runs[RUN_ID].encounters[1].name")).toBe(boss);
  });
  it("times wipes and kills, deduplicates both kill events, and survives module reload", () => {
    const s = activeRun();
    s.run('fire_event("ENCOUNTER_START", 3493, "First boss"); STAMP = STAMP + 30; fire_event("ENCOUNTER_END", 3493, "First boss", 1, 5, 0)');
    s.run('STAMP = STAMP + 15; fire_event("ENCOUNTER_START", 3493, "First boss"); STAMP = STAMP + 45');
    // WoW restores current and activeEncounter from SavedVariables across /reload.
    s.run('FRAMES = {}'); s.load("Modules/Dungeon.lua");
    s.run('fire_event("BOSS_KILL", 3493, "First boss"); fire_event("ENCOUNTER_END", 3493, "First boss", 1, 5, 1)');
    expect(s.run('return #GuildedDB.dungeon.current.encounters')).toBe("2");
    expect(s.run('local e=GuildedDB.dungeon.current.encounters; return (e[1].at-e[1].startedAt)..","..(e[2].at-e[2].startedAt)')).toBe("30,45");
    s.run('STAMP=STAMP+20; fire_event("BOSS_KILL",3496,"Durgen Dirgehammer")');
    expect(s.run('return tostring(GuildedDB.dungeon.runs[RUN_ID].encounters[3].startedAt)')).toBe("nil");
    s.run('local r=GuildedDB.dungeon.runs[RUN_ID]; r.players.Tester={class="PRIEST",role="HEALER",spec="Discipline",minLevel=19,level=20}; ROUNDTRIP=NS.dungeon.deserialize(RUN_ID,NS.dungeon.serialize(r))');
    expect(s.run('return ROUNDTRIP.encounters[2].at-ROUNDTRIP.encounters[2].startedAt')).toBe("45");
    expect(s.run('return ROUNDTRIP.players[NS.normalizeName("Tester")].spec')).toBe("Discipline");
    expect(s.run('return ROUNDTRIP.players[NS.normalizeName("Tester")].minLevel..","..ROUNDTRIP.players[NS.normalizeName("Tester")].level')).toBe("19,20");
  });

  it("bounds peer summaries while keeping full saved encounters and accepts legacy summaries", () => {
    const s = activeRun();
    s.run(`local r=GuildedDB.dungeon.current
      for i=1,100 do r.encounters[i]={id=i,name=string.rep("x",100),success=true,at=STAMP+i} end
      SERIALIZED=NS.dungeon.serialize(r)
      LEGACY=NS.dungeon.deserialize("old","v=1;st=COMPLETED;i=3065;s=1800000000;e=1800001000;enc=3496;p=Tester:PRIEST:HEALER:0:1000:1")`);
    expect(Number(s.run('return #SERIALIZED'))).toBeLessThanOrEqual(4000);
    expect(s.run('return #GuildedDB.dungeon.current.encounters')).toBe("100");
    expect(s.run('return LEGACY.encounters[1].id')).toBe("3496");
  });
  it.each(["ENCOUNTER_END", "BOSS_KILL"])("finishes Hall of Thanes on %s", (event) => {
    const s = activeRun();
    s.run(`fire_event("${event}", 3496, "Durgen Dirgehammer", 1, 5, 1)`);
    expect(s.run("return GuildedDB.dungeon.runs[RUN_ID].state")).toBe("COMPLETED");
    expect(s.run("return GuildedDB.dungeon.runs[RUN_ID].durationSec")).toBe("600");
    expect(s.run("return tostring(GuildedDB.dungeon.current)")).toBe("nil");
  });

  it("loads without probing restricted events and finishes a localized encounter only once", () => {
    const s = activeRun();
    expect(s.run("return BLOCKED_REGISTRATIONS")).toBe("0");
    s.run(`fire_event("ENCOUNTER_END", 3496, "Localized boss", 1, 5, 1)
      fire_event("BOSS_KILL", 3496, "Localized boss")`);
    expect(s.run("return GuildedDB.dungeon.runs[RUN_ID].state")).toBe("COMPLETED");
    expect(s.run("return #GuildedDB.dungeon.runs[RUN_ID].encounters")).toBe("1");
    expect(s.run("return NS.dungeon.serialize(GuildedDB.dungeon.runs[RUN_ID])")).not.toContain("enc=nil");
  });

  it("ignores wipes, other bosses, and kills outside the tracked instance", () => {
    const s = activeRun();
    s.run(`fire_event("ENCOUNTER_END", 3496, "Durgen Dirgehammer", 1, 5, 0)
      fire_event("BOSS_KILL", 3493, "Faldrim Anvilmar")
      INSTANCE = {id=33, type="party"}
      fire_event("BOSS_KILL", 3496, "Durgen Dirgehammer")
      fire_event("ENCOUNTER_END", 3496, "Durgen Dirgehammer", 1, 5, 1)`);
    expect(s.run("return GuildedDB.dungeon.current.state")).toBe("ACTIVE");
  });

  it("keeps journal-based completion for other dungeons", () => {
    const s = activeRun();
    s.run(`INSTANCE.id = 33
      GuildedDB.dungeon.current.instanceId = 33
      GuildedDB.dungeon.current.finalEncounterId = 99
      fire_event("ENCOUNTER_END", 98, "Earlier boss", 1, 5, 1)`);
    expect(s.run("return GuildedDB.dungeon.current.state")).toBe("ACTIVE");
    s.run('fire_event("ENCOUNTER_END", 99, "Last boss", 1, 5, 1)');
    expect(s.run("return GuildedDB.dungeon.runs[RUN_ID].state")).toBe("COMPLETED");
  });

  it("does not start another run in the cleared dungeon, but tracks a return after leaving", () => {
    const s = activeRun();
    s.run(`fire_event("BOSS_KILL", 3496, "Durgen Dirgehammer")
      fire_event("ZONE_CHANGED_NEW_AREA")
      fire_event("PLAYER_ENTERING_WORLD")`);
    expect(s.run("return tostring(GuildedDB.dungeon.current)")).toBe("nil");
    s.run(`INSTANCE = nil
      fire_event("ZONE_CHANGED_NEW_AREA")
      INSTANCE = {id=3065, type="party", name="Hall of Thanes", difficultyId=1}
      fire_event("ZONE_CHANGED_NEW_AREA")`);
    expect(s.run("return GuildedDB.dungeon.current.state")).toBe("STARTING");
  });
});
