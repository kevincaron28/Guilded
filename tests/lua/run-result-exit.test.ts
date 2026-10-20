import { afterEach, describe, expect, it } from "vitest";
import { publicRules, scoreRun } from "../../src/services/public-score.js";
import { newLuaSession, type LuaSession } from "./harness.js";

let session: LuaSession;
afterEach(() => session?.close());

function card() {
  session = newLuaSession();
  session.run(`DB={dungeon={runs={}}}; COMBAT=false; SHOWS=0; VISIBLE=false; HOVER=false
    INSTANCE={id=3065,type="party"}
    NS={getDb=function() return DB end, compat={instance=function() return INSTANCE end}}
    InCombatLockdown=function() return COMBAT end
    local original=CreateFrame
    CreateFrame=function(kind,name,...)
      local frame=original(kind,name,...)
      frame.CreateFontString=function()
        return setmetatable({GetStringHeight=function() return 180 end},{__index=function() return function() end end})
      end
      if name=="GuildedRunResults" then
        CARD=frame
        frame.Show=function() VISIBLE=true; SHOWS=SHOWS+1 end
        frame.Hide=function() VISIBLE=false end
        frame.IsShown=function() return VISIBLE end
        frame.IsMouseOver=function() return HOVER end
        frame.SetAlpha=function(_,a) ALPHA=a end
      end
      return frame
    end
    function tick(seconds)
      for _,f in ipairs(FRAMES) do
        if f~=CARD and f.scripts.OnUpdate then f.scripts.OnUpdate(f,seconds) end
      end
    end
    function age(seconds) CARD.scripts.OnUpdate(CARD,seconds) end
    RUN={id="own",state="COMPLETED",completedBy="final boss",instanceId=3065,
      difficultyId=0,durationSec=1500,players={Tester={level=20}},encounters={}}
    DB.dungeon.runs.own=RUN`);
  session.load("Locale.lua");
  session.load("Modules/RunResults.lua");
  return session;
}

describe("safe dungeon exit result card", () => {
  it("waits for exit and loading to settle, defers combat, and shows only once across reload", () => {
    const s=card();
    s.run('NS.onDungeonResultReady(RUN); tick(2); fire_event("ZONE_CHANGED_NEW_AREA"); tick(2)');
    expect(s.run("return SHOWS")).toBe("0");
    s.run('fire_event("PLAYER_LEAVING_WORLD"); INSTANCE=nil; tick(2)');
    expect(s.run("return SHOWS")).toBe("0");
    s.run('COMBAT=true; fire_event("PLAYER_ENTERING_WORLD"); tick(2)');
    expect(s.run("return SHOWS")).toBe("0");
    s.run('COMBAT=false; fire_event("PLAYER_REGEN_ENABLED"); tick(2)');
    expect(s.run("return SHOWS")).toBe("1");
    expect(s.run("return tostring(RUN.resultCardShown)")).toBe("true");
    s.run('CARD.close.scripts.OnClick(); NS.onDungeonResultReady(RUN); fire_event("ZONE_CHANGED_NEW_AREA"); tick(2)');
    expect(s.run("return SHOWS")).toBe("1");
    expect(s.run("return tostring(RUN.resultCardDismissed)")).toBe("true");
    s.run("FRAMES={}; CARD=nil"); s.load("Modules/RunResults.lua");
    s.run('NS.onDungeonResultReady(RUN); fire_event("PLAYER_ENTERING_WORLD"); tick(2)');
    expect(s.run("return SHOWS")).toBe("1");
    // The normal results hook is an intentional manual reopen and bypasses auto display flags.
    s.run("NS.onDungeonSummary(RUN)");
    expect(s.run("return SHOWS")).toBe("2");
  });

  it("restores an unseen pending completion after reload inside, and avoids interrupting a new instance", () => {
    const s=card(); s.run("NS.onDungeonResultReady(RUN); FRAMES={}");
    s.load("Modules/RunResults.lua");
    s.run('fire_event("PLAYER_ENTERING_WORLD"); tick(2)');
    expect(s.run("return SHOWS")).toBe("0");
    s.run('INSTANCE={id=36,type="party"}; fire_event("ZONE_CHANGED_NEW_AREA"); tick(2)');
    expect(s.run("return SHOWS")).toBe("0");
    s.run('INSTANCE=nil; fire_event("ZONE_CHANGED_NEW_AREA"); tick(2)');
    expect(s.run("return SHOWS")).toBe("1");
  });

  it("expires after 15 unpaused seconds, pauses hover/details, and resumes safely after combat", () => {
    const s=card(); s.run("INSTANCE=nil; NS.onDungeonResultReady(RUN); tick(2); age(8); HOVER=true; age(20)");
    expect(s.run("return tostring(VISIBLE)..':'..ALPHA")).toBe("true:1");
    s.run("HOVER=false; CARD.details.scripts.OnClick(); age(20)");
    expect(s.run("return tostring(VISIBLE)")).toBe("true");
    s.run('COMBAT=true; fire_event("PLAYER_REGEN_DISABLED")');
    expect(s.run("return tostring(VISIBLE)")).toBe("false");
    s.run('COMBAT=false; fire_event("PLAYER_REGEN_ENABLED"); CARD.details.scripts.OnClick(); age(14)');
    expect(s.run("return ALPHA")).toBe("0.5");
    s.run("age(1)");
    expect(s.run("return tostring(VISIBLE)..':'..tostring(RUN.resultCardDismissed)")).toBe("false:true");
    s.run('fire_event("PLAYER_REGEN_DISABLED"); fire_event("PLAYER_REGEN_ENABLED"); tick(2)');
    expect(s.run("return SHOWS")).toBe("2");
  });

  it("never auto displays incomplete/invalid runs or activates the standalone card alongside Guilded", () => {
    const s=card();
    s.run('INSTANCE=nil; RUN.state="ACTIVE"; NS.onDungeonResultReady(RUN); tick(2)');
    expect(s.run("return RUN.state..':'..SHOWS")).toBe("ACTIVE:0");
    s.run('RUN.state="ABANDONED"; NS.onDungeonResultReady(RUN); tick(2)');
    expect(s.run("return SHOWS")).toBe("0");
    s.run('RUN.state="COMPLETED"; NS.moduleActive=function() return false end; NS.onDungeonResultReady(RUN); NS.onDungeonSummary(RUN); tick(2)');
    expect(s.run("return SHOWS")).toBe("0");
  });

  it("does not display a pending result belonging to an alt", () => {
    const s=card();
    s.run('INSTANCE=nil; NS.playerName=function() return "Alt" end; NS.onDungeonResultReady(RUN); tick(2)');
    expect(s.run("return SHOWS")).toBe("0");
    s.run('NS.playerName=function() return "Tester" end; tick(2)');
    expect(s.run("return SHOWS")).toBe("1");
  });

  it("shows honest eligibility, breakdown and receipt guidance in English and French", () => {
    const s=card();
    expect(s.run("return NS.runResults.breakdown(RUN)")).toContain("Time rating 200 (50-400) / level penalty 0%");
    s.run("RUN.players.Tester.level=22");
    expect(s.run("return NS.runResults.estimate(RUN).points")).toBe("160");
    expect(s.run("return NS.runResults.breakdown(RUN)")).toContain("level penalty 20%");
    s.run("RUN.players.Tester.level=nil");
    expect(s.run("return NS.runResults.breakdown(RUN)")).toBe("Party levels missing");
    s.run('GetLocale=function() return "frFR" end');
    expect(s.run("return NS.runResults.breakdown(RUN)")).toBe("Niveaux du groupe manquants");
    expect(s.run("return NS.runResults.syncText(RUN)")).toContain("L'envoi et la publication");
    s.run('RUN.completedBy="manual"');
    expect(s.run("return NS.runResults.breakdown(RUN)")).toContain("Preuve automatique");
  });
});

describe("local public estimate agrees with the actual website scoring", () => {
  it("matches all current targets, level/difficulty eligibility, penalties, rounding and clamping", () => {
    const s=card(); const rules=publicRules();
    for (const route of rules.routes) {
      const key=route.dungeonKey; const band=rules.levelBands[key]!;
      const boss=route.completion.names[0];
      for (const level of [band.min-1,band.min,band.max,band.max+1,band.max+3,band.max+4]) {
        for (const seconds of [1,route.targetSec!,route.targetSec!+7,14400]) {
          const actual=scoreRun({runId:"own",instanceId:route.instanceId,routeKey:key,difficultyId:band.difficultyId,
            dungeonName:route.name,durationSec:seconds,endedAt:new Date("2026-10-20"),confirmations:1,
            players:[{character:"Tester",realm:"Fixture",className:null,role:null,level}]},rules);
          const lua=s.run(`local r={state="COMPLETED",completedBy="final boss",instanceId=${route.instanceId},
            difficultyId=${band.difficultyId},durationSec=${seconds},players={Tester={level=${level}}},
            encounters={${boss?`{name=${JSON.stringify(boss)},success=true}`:""}}}
            return tostring(NS.runResults.estimate(r).points)`);
          expect(lua,`${key} level ${level}, ${seconds}s`).toBe(actual?String(actual.points):"nil");
        }
      }
    }
    s.run('RUN.instanceId=189; RUN.encounters={{name="Herod",success=true},{name="Arcanist Doan",success=true}}');
    expect(s.run("return tostring(NS.runResults.estimate(RUN).points)")).toBe("nil");
    s.run('RUN.instanceId=3065; RUN.difficultyId=1');
    expect(s.run("return NS.runResults.breakdown(RUN)")).toContain("Different difficulty");
  });
});
