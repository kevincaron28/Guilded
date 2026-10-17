import { describe, expect, it, vi } from "vitest";
import { coreComposition, planningOptions } from "../src/services/core-planning.js";
import { parseWeeklySchedule, weeklyOccurrences } from "../src/services/core-weekly-time.js";
import { fillCoreWeeklyRaids } from "../src/services/core-weekly-raids.js";
import { createRaidService } from "../src/services/raid.js";

describe("core composition and launch planning", () => {
  it("supports independent ten- and twenty-player compositions including zero slots", () => {
    expect(coreComposition("10", "2", "2", "6")).toEqual({ raidSize: 10, tankLimit: 2, healerLimit: 2, dpsLimit: 6 });
    expect(coreComposition("20", "2", "4", "14").raidSize).toBe(20);
    expect(coreComposition("40", "4", "8", "28").raidSize).toBe(40);
    expect(() => coreComposition("15", "2", "3", "10")).toThrow();
    expect(coreComposition("10", "0", "2", "8").tankLimit).toBe(0);
    for (const size of ["0", "41", "10.5", "-1", ""]) expect(() => coreComposition(size, "2", "2", "6")).toThrow();
    expect(() => coreComposition("20", "2", "2", "6")).toThrow();
  });
  it("validates real dates and bounds the publication window", () => {
    expect(planningOptions("2026-12-04", "28")).toEqual({ weeklyStartDate: "2026-12-04", weeklyHorizonDays: 28 });
    expect(planningOptions("", "6").weeklyStartDate).toBeNull();
    for (const date of ["2026-02-30", "2026-13-01", "12/04/2026", "no"]) expect(() => planningOptions(date, "28")).toThrow();
    for (const days of ["0", "91", "2.5", ""]) expect(() => planningOptions("", days)).toThrow();
  });
  it("prepares December from October without creating any prelaunch raids", () => {
    const times = weeklyOccurrences(parseWeeklySchedule("vendredi 20h"), "America/Toronto", new Date("2026-10-09T12:00Z"), planningOptions("2026-12-04", "28"));
    expect(times.map(row => row.scheduledAt.toISOString())).toEqual(["2026-12-05T01:00:00.000Z", "2026-12-12T01:00:00.000Z", "2026-12-19T01:00:00.000Z", "2026-12-26T01:00:00.000Z"]);
    expect(weeklyOccurrences(parseWeeklySchedule("vendredi 20h"), "America/Toronto", new Date("2027-01-10T12:00Z"), planningOptions("2026-12-04", "7"))[0]!.scheduledAt.toISOString()).toBe("2027-01-16T01:00:00.000Z");
  });
  it("keeps local raid times across DST inside an extended window", () => {
    const times = weeklyOccurrences(parseWeeklySchedule("dimanche 20h"), "America/Toronto", new Date("2026-10-09T12:00Z"), planningOptions("2026-10-25", "14"));
    expect(times.map(row => row.scheduledAt.toISOString())).toEqual(["2026-10-26T00:00:00.000Z", "2026-11-02T01:00:00.000Z"]);
  });
  it("inherits limits, queues posts and never recreates existing or cancelled occurrences", async () => {
    const core = { id: "core", name: "20 player", weeklySchedule: "vendredi 20h", weeklyTimezone: "America/Toronto", weeklyCreatedBy: "leader", ...planningOptions("2026-12-04", "14"), ...coreComposition("20", "2", "4", "14") };
    const raids: Record<string, unknown>[] = [];
    const tx = {
      $executeRaw: vi.fn(), raidCore: { findFirst: vi.fn(async () => core) },
      raid: {
        findMany: vi.fn(async () => raids),
        createManyAndReturn: vi.fn(async ({ data }: { data: Record<string, unknown>[] }) => data.map(item => { const row = { id: String(raids.length), ...item }; raids.push(row); return row; }))
      },
      discordJob: { createMany: vi.fn(async (args: { data: unknown[] }) => args) }
    };
    const database = { ...tx, $transaction: (work: (t: typeof tx) => unknown) => work(tx) };
    const now = new Date("2026-10-09T12:00Z");
    expect(await fillCoreWeeklyRaids(database as never, "guild", "core", now)).toHaveLength(2);
    expect(raids[0]).toMatchObject({ coreId: "core", tankLimit: 2, healerLimit: 4, dpsLimit: 14 });
    raids[0]!["status"] = "CANCELLED";
    expect(await fillCoreWeeklyRaids(database as never, "guild", "core", now)).toEqual([]);
    expect(tx.discordJob.createMany).toHaveBeenCalledTimes(1);
    expect(tx.discordJob.createMany.mock.calls[0]![0].data).toHaveLength(2);
  });
  it("manual core raids inherit defaults but permit explicit per-raid overrides", async () => {
    const create = vi.fn(async (args: unknown) => args);
    const db = { raidCore: { findFirst: vi.fn(async () => ({ id: "c", tankLimit: 2, healerLimit: 4, dpsLimit: 14 })) }, raid: { create } };
    await createRaidService(db as never).create({ guildId: "g", coreId: "c", title: "Launch raid", createdBy: "leader", scheduledAt: new Date(Date.now() + 86_400_000), healerLimit: 3 });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ tankLimit: 2, healerLimit: 3, dpsLimit: 14 }) }));
  });
});
