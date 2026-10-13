import { describe, it, expect, vi } from "vitest";
import { bestRunsEmbed, seasonBestRuns } from "../src/services/dungeon-best-runs.js";

describe("best clear per dungeon board", () => {
  it("separates difficulties, scopes the season and excludes guests and simulated clears", async () => {
    const groupBy=vi.fn().mockResolvedValue([{instanceId:1,difficultyId:1,_min:{durationSec:300}}, {instanceId:1,difficultyId:2,_min:{durationSec:500}}]);
    const findFirst=vi.fn().mockImplementation(async ({where})=>({instanceId:1,dungeonName:"Hall",difficultyId:where.difficultyId,
      durationSec:where.durationSec,endedAt:new Date(),players:[{character:"Kev"}]}));
    const rows=await seasonBestRuns({dungeonRun:{groupBy,findFirst}} as unknown as Parameters<typeof seasonBestRuns>[0],"guild","season");
    expect(rows.map(r=>r.durationSec)).toEqual([300,500]);
    expect(groupBy.mock.calls[0]![0].where).toMatchObject({guildId:"guild",seasonId:"season",valid:true,state:"COMPLETED",NOT:{runRef:{startsWith:"SIM-"}}});
    expect(findFirst.mock.calls[0]![0].select.players.where).toEqual({memberId:{not:null}});
    expect(findFirst.mock.calls[0]![0].orderBy).toEqual([{endedAt:"asc"},{id:"asc"}]);
    const embed=bestRunsEmbed(rows,"en").toJSON();
    expect(embed.description).toContain("Normal"); expect(embed.description).toContain("Heroic");
    expect(embed.description).toContain("Repeats add no entries");
  });
  it("keeps large boards bounded and explains empty seasons", () => {
    const rows=Array.from({length:100},(_,i)=>({instanceId:i,dungeonName:"A dungeon ".repeat(10),difficultyId:1,durationSec:600,endedAt:null,players:["Kev"]}));
    expect(bestRunsEmbed(rows,"fr").length).toBeLessThan(3000);
    expect(bestRunsEmbed(rows,"fr").toJSON().description).toContain("autres records");
    expect(bestRunsEmbed([],"en").toJSON().description).toContain("first completed dungeon");
  });
});
