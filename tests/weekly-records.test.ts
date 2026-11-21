/* eslint-disable @typescript-eslint/no-explicit-any -- minimal in-memory database fakes */
import { describe, expect, it } from "vitest";
import { queueWeeklyRecords, recordsIsEmpty, weeklyRecords, weeklyRecordsCard, weeklyRecordsEmbed } from "../src/services/weekly-records.js";

// Wednesday 2026-12-16, after the Tuesday 15:00 UTC reset: the week that ended is 8-15 December.
const NOW = new Date("2026-12-16T16:00:00Z");

function fakeDb(over: { highlights?: unknown[]; points?: unknown[]; kills?: unknown[]; earlier?: unknown[]; settings?: unknown[] } = {}) {
  const jobs: unknown[] = [];
  const settings = over.settings ?? [{ guildId: "g", language: "en", guild: { name: "Alpha" } }];
  let claimed = 0;
  const db: any = {
    dungeonHighlight: { findMany: async () => over.highlights ?? [] },
    dungeonPointTransaction: { groupBy: async () => over.points ?? [] },
    raidKill: { findMany: async ({ where }: any) => where.killedAt?.gte ? over.kills ?? [] : over.earlier ?? [] },
    member: { findMany: async () => [{ id: "m1", displayName: "Alice" }] },
    guildSettings: { findMany: async () => settings, updateMany: async () => { claimed += 1; return { count: 1 }; } },
    $transaction: async (fn: (tx: unknown) => unknown) => fn({ guildSettings: db.guildSettings, discordJob: { create: async (x: unknown) => jobs.push(x), upsert: async (x: unknown) => jobs.push(x) } })
  };
  return { db, jobs, claimed: () => claimed };
}
const kill = (encounterId: number) => ({ instanceId: 9001, instanceName: "Test Raid", encounterId, difficultyId: 14, bossName: `Boss ${encounterId}`, killedAt: new Date("2026-12-10T20:00:00Z") });

describe("weekly records", () => {
  it("is empty in a quiet week and says so", async () => {
    const { db } = fakeDb();
    const week = await weeklyRecords(db, "g", NOW);
    expect(recordsIsEmpty(week)).toBe(true);
    expect(week.weekStart.toISOString()).toBe("2026-12-08T15:00:00.000Z");
  });
  it("collects dungeon records, climbers and new raid kills (firsts are those never killed before)", async () => {
    const { db } = fakeDb({ highlights: [{ kind: "clear", label: null, valueSec: 600, previousSec: 700, dungeonName: "Deadmines", instanceId: 36 }],
      points: [{ memberId: "m1", _sum: { amount: 42 } }], kills: [kill(1), kill(2)], earlier: [{ instanceId: 9001, encounterId: 1, difficultyId: 14 }] });
    const week = await weeklyRecords(db, "g", NOW);
    expect(week.records).toHaveLength(1);
    expect(week.climbers).toEqual([{ name: "Alice", points: 42 }]);
    expect(week.raidKills).toMatchObject({ bosses: 2, firsts: 1, instances: ["Test Raid"] });
    for (const lang of ["en", "fr"] as const) {
      expect(weeklyRecordsEmbed(week, lang).toJSON().description).toContain("Alice");
      const card = weeklyRecordsCard(week, lang, "Alpha");
      expect(card.recap?.sections.length).toBe(3);
      expect(card.title).toBe("Alpha");
    }
  });
  it("queues one card for a server that opted in, and nothing for a quiet week", async () => {
    const busy = fakeDb({ kills: [kill(1)] });
    expect(await queueWeeklyRecords(busy.db, NOW)).toBe(1);
    expect(busy.jobs).toHaveLength(1);
    const quiet = fakeDb();
    expect(await queueWeeklyRecords(quiet.db, NOW)).toBe(0);
    expect(quiet.claimed()).toBe(1); // the quiet week is still claimed, so it is not re-read all day
  });
});
