import { describe, expect, it } from "vitest";
import { bossProgress } from "../src/services/progress.js";

const kill = (name: string, killedAt: string | null, raidTitle: string, startedAt: string) => ({
  name, killedAt: killedAt ? new Date(killedAt) : null,
  raid: { title: raidTitle, scheduledAt: new Date(startedAt), startedAt: new Date(startedAt) }
});

describe("boss progression", () => {
  it("merges case variants, keeps the earliest first kill, and orders by first kill", async () => {
    const database = {
      raidBoss: {
        findMany: async () => [
          kill("Ragnaros", "2026-10-08T22:00:00Z", "MC week 2", "2026-10-08T20:00:00Z"),
          kill("Lucifron", null, "MC week 1", "2026-10-01T20:00:00Z"),
          kill("ragnaros", "2026-10-01T23:00:00Z", "MC week 1", "2026-10-01T20:00:00Z")
        ]
      }
    };
    const progress = await bossProgress(database as never, "g1");
    expect(progress.map((row) => [row.boss, row.kills, row.firstKillRaid])).toEqual([
      ["Lucifron", 1, "MC week 1"],
      ["Ragnaros", 2, "MC week 1"]
    ]);
    expect(progress[1]?.lastKill.toISOString()).toBe("2026-10-08T22:00:00.000Z");
  });

  it("counts kills the addon recorded, once when also marked on Discord", async () => {
    const recorded = (bossName: string, killedAt: string) => ({ bossName, instanceName: "Molten Core", killedAt: new Date(killedAt) });
    const database = {
      raidBoss: { findMany: async () => [kill("Lucifron", "2026-12-10T03:00:00Z", "MC night", "2026-12-10T01:00:00Z")] },
      raidKill: { findMany: async () => [recorded("lucifron", "2026-12-10T01:20:00Z"), recorded("Magmadar", "2026-12-10T02:00:00Z"), recorded("Lucifron", "2026-12-17T01:20:00Z")] }
    };
    const progress = await bossProgress(database as never, "g1");
    expect(progress.map((row) => [row.boss, row.kills, row.firstKillRaid])).toEqual([
      ["Lucifron", 2, "Molten Core"],
      ["Magmadar", 1, "Molten Core"]
    ]);
  });
});
