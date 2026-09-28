import { describe, expect, it } from "vitest";
import { computeRunPoints, dungeonConfig, validateRun, weekStart, type DungeonRunInput } from "../src/services/dungeon-rules.js";

const now = new Date("2026-09-25T20:00:00Z");
const nowSec = Math.floor(now.getTime() / 1000);
const run = (over: Partial<DungeonRunInput> = {}): DungeonRunInput => ({
  id: "QG-1", protocolVersion: 1, state: "COMPLETED", instanceId: 36, name: "The Deadmines", difficultyId: 1,
  startedAt: nowSec - 1800, endedAt: nowSec - 300, reporters: 1,
  players: [{ character: "Kev", realm: "R", deaths: 0, presentSec: 1500, inGuild: true }],
  ...over
});

describe("run validation", () => {
  it("accepts a normal completed run", () => {
    expect(validateRun(run(), now)).toEqual({ ok: true });
  });
  it("rejects impossible runs with a reason", () => {
    expect(validateRun(run({ protocolVersion: 9 }), now).reason).toContain("protocol");
    expect(validateRun(run({ endedAt: nowSec - 1750 }), now).reason).toContain("too short");
    expect(validateRun(run({ startedAt: nowSec - 6 * 3600 }), now).reason).toContain("too long");
    expect(validateRun(run({ endedAt: nowSec + 3600 }), now).reason).toContain("future");
    expect(validateRun(run({ startedAt: undefined }), now).reason).toContain("without start");
    expect(validateRun(run({ players: [] }), now).reason).toContain("0 players");
    const twice = { character: "Kev", realm: "R", deaths: 0, presentSec: 0, inGuild: true };
    expect(validateRun(run({ players: [twice, { ...twice, character: "kev" }] }), now).reason).toContain("twice");
  });
  it("only believes a run from someone who was in it", () => {
    expect(validateRun(run({ recorder: "Kev" }), now)).toEqual({ ok: true });
    expect(validateRun(run({ recorder: "Faker" }), now).reason).toContain("recorder was not in the run");
    expect(validateRun(run({ reporterNames: ["Faker", "kev"] }), now)).toEqual({ ok: true });
    expect(validateRun(run({ reporterNames: ["Faker"] }), now).reason).toContain("no reporter was in the run");
  });
  it("keeps abandoned runs (no points) as valid records", () => {
    expect(validateRun(run({ state: "ABANDONED", endedAt: undefined }), now)).toEqual({ ok: true });
  });
});

describe("weekly reset", () => {
  it("is Tuesday 15:00 UTC", () => {
    expect(weekStart(new Date("2026-09-25T20:00:00Z")).toISOString()).toBe("2026-09-22T15:00:00.000Z");
    expect(weekStart(new Date("2026-09-22T14:59:00Z")).toISOString()).toBe("2026-09-15T15:00:00.000Z");
    expect(weekStart(new Date("2026-09-22T15:00:00Z")).toISOString()).toBe("2026-09-22T15:00:00.000Z");
  });
});

describe("points", () => {
  const config = dungeonConfig({ targets: { 36: 1600 } });
  const base = { memberId: "m1", character: "Kev", earlierThisWeek: 0, firstEver: false, previousBest: null };
  const total = (awards: { amount: number }[]) => awards.reduce((sum, award) => sum + award.amount, 0);

  it("adds up the rules for a clean first run", () => {
    const awards = computeRunPoints({ instanceId: 36, durationSec: 1500, fullGuildGroup: true, guildRecord: true,
      players: [{ ...base, deaths: 0, firstEver: true }], config });
    expect(awards.map((award) => award.rule).sort()).toEqual(["completion", "firstCompletion", "fullGuildGroup", "guildRecord", "noDeaths", "underTarget"]);
    expect(total(awards)).toBe(50 + 25 + 25 + 25 + 20 + 20);
  });

  it("never gives a death bonus when deaths weren't tracked", () => {
    const awards = computeRunPoints({ instanceId: 36, durationSec: 1700, fullGuildGroup: false, guildRecord: false,
      players: [{ ...base, deaths: null }], config });
    expect(awards.map((award) => award.rule)).toEqual(["completion"]);
  });

  it("detects a personal record against the previous best", () => {
    const awards = computeRunPoints({ instanceId: 36, durationSec: 1500, fullGuildGroup: false, guildRecord: false,
      players: [{ ...base, deaths: 3, previousBest: 1754 }], config });
    expect(awards.find((award) => award.rule === "personalRecord")?.reason).toBe("Personal record (29:14 → 25:00)");
  });

  it("halves the 2nd run of the week and gives nothing for the 3rd", () => {
    const second = computeRunPoints({ instanceId: 36, durationSec: 1700, fullGuildGroup: false, guildRecord: false,
      players: [{ ...base, deaths: 0, earlierThisWeek: 1 }], config });
    expect(total(second)).toBe(Math.round(50 * 0.5) + Math.round(25 * 0.5));
    expect(second[0]?.reason).toContain("run 2 this week: 50%");
    const third = computeRunPoints({ instanceId: 36, durationSec: 1700, fullGuildGroup: false, guildRecord: false,
      players: [{ ...base, deaths: 0, earlierThisWeek: 2 }], config });
    expect(third).toEqual([]);
  });

  it("uses safe defaults for bad config values", () => {
    const bad = dungeonConfig({ completion: -5, noDeaths: "lots", weeklyRepeat: [2] });
    expect(bad.completion).toBe(50);
    expect(bad.noDeaths).toBe(25);
    expect(bad.weeklyRepeat).toEqual([1, 0.5, 0]);
  });
});
