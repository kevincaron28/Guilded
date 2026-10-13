import { describe, it, expect } from "vitest";
import { dungeonTimeline } from "../src/services/dungeon-timeline.js";
import { dungeonRunSchema } from "../src/services/dungeon-rules.js";
import { parseAddonExportText } from "../companion/lua-export-content.mjs";
import type { DungeonImportResult } from "../src/services/dungeon-import.js";

const run = (overrides: Partial<DungeonImportResult> = {}): DungeonImportResult => ({
  runRef: "QG-1", dungeonName: "Hall", difficultyId: 1, state: "COMPLETED", valid: true,
  durationSec: 600, startedAt: 1000, endedAt: 1600, points: 50, guildRecord: false, previousGuildBest: null,
  personalRecords: [], players: ["Kev"], deaths: 0, unlinked: [], achievements: [], ...overrides
});
describe("dungeon timeline", () => {
  it("separates elapsed run time from actual fight duration and includes failed attempts", () => {
    const timeline = dungeonTimeline(run({encounters:[
      {id:1,name:"Boss A",at:1180,startedAt:1150,success:false},
      {id:1,name:"Boss A",at:1240,startedAt:1200,success:true},
      {id:1,name:"Boss A",at:1241,success:true},
      {id:2,name:"Boss B",at:1600,success:true}
    ]}),"en")!;
    expect(timeline).toContain("`3:00` ↺ **Boss A** · ⚔️ 0:30 · failed attempt");
    expect(timeline).toContain("`4:00` ✅ **Boss A** · ⚔️ 0:40");
    expect(timeline.match(/Boss A/g)).toHaveLength(2);
    expect(timeline).toContain("**Boss B** · fight not timed");
    expect(timeline).toContain("`10:00` 🏁 Finished");
  });
  it("ignores out-of-run events and invalid start times without fabricating durations", () => {
    expect(dungeonTimeline(run(),"en")).toBeNull();
    const timeline=dungeonTimeline(run({encounters:[{id:1,at:999,success:true},{id:2,at:1601,success:true},
      {id:3,at:1500,startedAt:900,success:true}]}),"fr")!;
    expect(timeline).not.toContain("Boss #1"); expect(timeline).not.toContain("Boss #2");
    expect(timeline).toContain("combat non chronométré");
  });
  it("exports real SavedVariables arrays through the companion and bot schema", () => {
    const exported=parseAddonExportText(`GuildedDB={dungeon={runs={r={id="run-1",state="COMPLETED",instanceId=3065,
      startedAt=1000,endedAt=1600,encounters={[1]={id=3496,name="Durgen",success=true,at=1600,startedAt=1500}},
      players={Kev={class="PRIEST",spec="Discipline",role="HEALER",deaths=0}}}}}}`,"Forever");
    const parsed=dungeonRunSchema.parse(exported.dungeonRuns[0]);
    expect(parsed.encounters?.[0]).toEqual({id:3496,name:"Durgen",success:true,at:1600,startedAt:1500});
    expect(parsed.players[0]?.spec).toBe("Discipline");
    expect(dungeonRunSchema.parse({...parsed,encounters:[{id:"bad"}]}).encounters).toBeUndefined();
  });
  it("keeps long timelines inside an embed field with an honest overflow count", () => {
    const timeline=dungeonTimeline(run({encounters:Array.from({length:100},(_,i)=>({id:i+1,name:"Long boss ".repeat(8),success:true,at:1000+i}))}),"en")!;
    expect(timeline.length).toBeLessThanOrEqual(1024); expect(timeline).toContain("more events");
  });
});
