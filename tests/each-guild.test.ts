import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { eachGuild } from "../src/services/each-guild.js";

describe("per-server scheduled jobs", () => {
  it("reports a failing server and still runs the ones after it", async () => {
    const ran: string[] = [], failed: string[] = [];
    await eachGuild(["a", "b", "c"], async guild => {
      ran.push(guild);
      if (guild === "a") throw new Error("Unable to start a transaction in the given time");
    }, (error, guild) => failed.push(`${guild}: ${(error as Error).message}`));
    expect(ran).toEqual(["a", "b", "c"]);
    expect(failed).toEqual(["a: Unable to start a transaction in the given time"]);
  });

  it("is what main.ts uses for the voice, scheduled events, raid repair and display loops", () => {
    const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
    for (const job of ["guild => participationTracker.sampleVoice(guild)", "await queueGuildScheduledEvents(", "repairCoreRaids(guild)", "await queueCharacterDisplayRefresh(", "voiceTime.tick(guild)"]) {
      const line = main.split(/\r?\n/).findIndex(text => text.includes(job));
      expect(line, job).toBeGreaterThan(-1);
      expect(main.split(/\r?\n/).slice(Math.max(0, line - 3), line + 1).join("\n"), job).toContain("eachGuild(");
    }
  });
});
