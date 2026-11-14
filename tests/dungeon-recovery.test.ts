import { describe, expect, it } from "vitest";
import { completeAtFinalBoss } from "../src/services/dungeon-recovery.js";
import { finalBossOf, routeBosses } from "../src/services/dungeon-bosses.js";
import { dungeonRunSchema } from "../src/services/dungeon-rules.js";

// The Drowned City runs of 11 and 14 November 2026 (docs: encounter order as the addon recorded it).
const T = 1_800_000_000;
const kill = (id: number, at: number, success = true) => ({ id, name: String(id), success, at, source: "native" });
const run = (over: Record<string, unknown> = {}) => ({
  id: "QG-DC-1", protocolVersion: 1, state: "ABANDONED", instanceId: 2970, name: "The Drowned City", difficultyId: 1, startedAt: T, endedAt: T + 9792,
  endReason: "group disbanded", diagnostic: "x", reporters: 1,
  encounters: [kill(3474, T + 300), kill(3511, T + 900), kill(3475, T + 1500), kill(3476, T + 2400), kill(3478, T + 3000, false), kill(3478, T + 3300), kill(3479, T + 3900), kill(3474, T + 6000)],
  players: [{ character: "Kev", realm: "Forever", presentSec: 9000, deaths: 1, inGuild: true }, { character: "Bob", realm: "Forever", presentSec: 3000, deaths: 0, inGuild: true }],
  ...over
});

describe("the Drowned City boss data", () => {
  it("lists six bosses, and only Min'loth the Serpent ends the dungeon", () => {
    const route = routeBosses(2970)!;
    expect(route.bosses.map((boss) => boss.id).sort()).toEqual([3474, 3475, 3476, 3478, 3479, 3511]);
    expect(route.bosses.filter((boss) => boss.final).map((boss) => boss.id)).toEqual([3479]);
    expect(finalBossOf(2970)).toMatchObject({ id: 3479, name: "Min'loth the Serpent" });
    expect(finalBossOf(36)).toBeNull();
  });
});

describe("completing an abandoned run at its final boss", () => {
  it("ends the run at the Min'loth kill and drops the later kill, which starts a new run", () => {
    const done = completeAtFinalBoss(run());
    if ("skip" in done) throw new Error(done.skip);
    expect(done.endedAt).toBe(T + 3900);
    expect(done.trimmed).toBe(1);
    expect(done.run).toMatchObject({ state: "COMPLETED", completedBy: "final boss", endedAt: T + 3900 });
    expect((done.run["encounters"] as { at: number }[]).every((entry) => entry.at <= T + 3900)).toBe(true);
    expect((done.run["players"] as { presentSec: number }[]).map((player) => player.presentSec)).toEqual([3900, 3000]);
    expect(done.run).not.toHaveProperty("endReason");
    expect(dungeonRunSchema.safeParse(done.run).success).toBe(true);
  });

  it("skips runs that cannot be completed, saying why", () => {
    expect(completeAtFinalBoss(run({ encounters: [kill(3474, T + 300), kill(3479, T + 900, false)] }))).toEqual({ skip: "no successful final boss kill" });
    expect(completeAtFinalBoss(run({ state: "COMPLETED" }))).toEqual({ skip: "already completed" });
    expect(completeAtFinalBoss(run({ instanceId: 36 }))).toEqual({ skip: "no known final boss for this dungeon" });
    expect(completeAtFinalBoss(run({ startedAt: undefined }))).toEqual({ skip: "no start time" });
    expect(completeAtFinalBoss(null)).toEqual({ skip: "not a run" });
    // A kill recorded before the run started is not this run's.
    expect(completeAtFinalBoss(run({ encounters: [kill(3479, T - 10)] }))).toEqual({ skip: "no successful final boss kill" });
  });

  it("takes the first successful kill when the boss was killed twice", () => {
    const done = completeAtFinalBoss(run({ encounters: [kill(3479, T + 4000), kill(3479, T + 5000)] }));
    expect("skip" in done ? 0 : done.endedAt).toBe(T + 4000);
  });
});
