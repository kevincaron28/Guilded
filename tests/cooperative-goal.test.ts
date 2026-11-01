import { describe, expect, it, vi } from "vitest";
import { cooperativeGoalStatus, cooperativeRulesHash, saveCooperativeGoal } from "../src/services/cooperative-goal.js";
import { novemberRulesFixture, novemberRun } from "./fixtures/november-routes.js";

const now = new Date("2026-10-30T22:00:00Z");
function fixture() {
  const rules = novemberRulesFixture();
  const season = { id: "season", ratingRules: rules, startsAt: new Date("2026-10-01T00:00:00Z"), endsAt: new Date("2026-11-10T00:00:00Z") };
  const goal = { guildId: "guild", seasonId: "season", edition: "forever", seasonStartsAt: season.startsAt, seasonEndsAt: season.endsAt,
    target: 1, metric: "dungeons", startsAt: new Date("2026-10-27T15:00:00Z"), endsAt: new Date("2026-11-03T15:00:00Z"), rules, rulesHash: cooperativeRulesHash(rules), paused: false };
  const base = novemberRun();
  const shift = new Date("2026-10-30T18:00:00Z").getTime() / 1000 - base.startedAt!.getTime() / 1000;
  const encounters = (base.competitionData as { encounters: { startedAt: number; at: number }[] }).encounters.map(row => ({ ...row, startedAt: row.startedAt + shift, at: row.at + shift }));
  const run = { ...base, id: "run", guildId: "guild", seasonId: "season", runRef: "canonical", valid: true, state: "COMPLETED", completedBy: "final boss",
    startedAt: new Date("2026-10-30T18:00:00Z"), endedAt: new Date("2026-10-30T18:30:00Z"),
    competitionData: { ...base.competitionData as object, encounters, players: [{ name: "Tester", level: 60, minLevel: 60 }, { name: "Friend", level: 60, minLevel: 60 }] },
    players: [...base.players, { character: "Friend", memberId: "friend", presentSec: 1800 }] };
  const database = { guild: { findUniqueOrThrow: vi.fn().mockResolvedValue({ gameEdition: "forever" }) }, dungeonSeason: { findFirst: vi.fn().mockResolvedValue(season) },
    cooperativeGoal: { findUnique: vi.fn().mockResolvedValue(goal), upsert: vi.fn() }, dungeonRun: { findMany: vi.fn().mockResolvedValue([run]) } };
  return { database, goal, season, run };
}

describe("configured cooperative goals", () => {
  it("uses a stable rules hash independent of JSONB key order", () => {
    expect(cooperativeRulesHash({ b: { z: 1, a: 2 }, a: [1, 2] })).toBe(cooperativeRulesHash({ a: [1, 2], b: { a: 2, z: 1 } }));
    expect(cooperativeRulesHash([1, 2])).not.toBe(cooperativeRulesHash([2, 1]));
  });
  it("saves explicit guild/edition/season/rules and weekly bounds without rewards", async () => {
    const f = fixture(); await saveCooperativeGoal(f.database as never, "guild", "officer", { seasonId: "season", target: 10, metric: "dungeons" }, now);
    expect(f.database.dungeonSeason.findFirst).toHaveBeenCalledWith({ where: { id: "season", guildId: "guild", status: "ACTIVE" } });
    expect(f.database.cooperativeGoal.upsert.mock.calls[0]![0]).toMatchObject({ create: { guildId: "guild", seasonId: "season", edition: "forever", target: 10,
      rulesHash: f.goal.rulesHash, startsAt: f.goal.startsAt, endsAt: f.goal.endsAt, seasonStartsAt: f.season.startsAt, seasonEndsAt: f.season.endsAt } });
  });
  it("rejects missing/foreign seasons, unsupported rules and invalid targets", async () => {
    const f = fixture(); f.database.dungeonSeason.findFirst.mockResolvedValue(null);
    await expect(saveCooperativeGoal(f.database as never, "guild", "actor", { seasonId: "foreign", target: 10, metric: "runs" }, now)).rejects.toThrow("active season");
    await expect(saveCooperativeGoal(f.database as never, "guild", "actor", { seasonId: "season", target: 0, metric: "runs" }, now)).rejects.toThrow("1–100");
    expect(f.database.cooperativeGoal.upsert).not.toHaveBeenCalled();
  });
  it("reconciles cosmetic completion after a run is invalidated, without stored awards", async () => {
    const f = fixture();
    expect(await cooperativeGoalStatus(f.database as never, "guild", now)).toMatchObject({ status: "active", value: 1, complete: true });
    f.run.valid = false;
    expect(await cooperativeGoalStatus(f.database as never, "guild", now)).toMatchObject({ status: "active", value: 0, complete: false });
    expect(f.database.cooperativeGoal.upsert).not.toHaveBeenCalled();
  });
  it("requires reconfiguration on edition, calendar or frozen-rule changes", async () => {
    for (const field of ["edition", "calendar", "rules"] as const) {
      const f = fixture();
      if (field === "edition") f.database.guild.findUniqueOrThrow.mockResolvedValue({ gameEdition: "retail" });
      if (field === "calendar") f.season.endsAt = new Date("2026-11-11T00:00:00Z");
      if (field === "rules") f.season.ratingRules = { ...f.season.ratingRules, pointsPerDungeon: 201 };
      expect(await cooperativeGoalStatus(f.database as never, "guild", now)).toMatchObject({ status: "scope-changed" });
      expect(f.database.dungeonRun.findMany).not.toHaveBeenCalled();
    }
  });
});
