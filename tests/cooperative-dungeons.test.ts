import { describe, expect, it, vi } from "vitest";
import { cooperativeDungeonPreview, cooperativeDungeonProgress, type CooperativeRun } from "../src/services/cooperative-dungeons.js";
import { novemberRulesFixture, novemberRun } from "./fixtures/november-routes.js";

const scope = { guildId: "guild", seasonId: "season", start: new Date(0), end: new Date(10_000_000), rules: novemberRulesFixture() };
function run(index = 0): CooperativeRun {
  const base = novemberRun(index);
  return { ...base, difficultyId: base.difficultyId ?? 0, id: `id-${index}`, runRef: `run-${index}`, guildId: "guild", seasonId: "season", valid: true, state: "COMPLETED", completedBy: "final boss",
    competitionData: { ...base.competitionData as object, players: [{ name: "Tester", level: 60, minLevel: 60 }, { name: "Friend", level: 60, minLevel: 60 }] },
    players: [...base.players.map(player => ({ ...player, character: player.character! })), { character: "Friend", memberId: "friend", presentSec: 1800 }] };
}

describe("cooperative dungeon projection", () => {
  it("reuses route eligibility and counts canonical runs, routes and accounts once", () => {
    const a = run(), b = run(1), repeat = { ...a, id: "another", runRef: "another" };
    const before = JSON.stringify([a, b, repeat]);
    expect(cooperativeDungeonProgress(scope, [a, a, b, repeat])).toEqual({ supported: true, runs: 3, dungeons: 2, participants: 2 });
    expect(JSON.stringify([a, b, repeat])).toBe(before);
  });
  it("does not count observer reports or two alts of one member as a guild group", () => {
    const a = run();
    a.players[1]!.memberId = "m";
    (a.competitionData as Record<string, unknown>)["observerReports"] = Array.from({ length: 20 }, () => run());
    expect(cooperativeDungeonProgress(scope, [a]).runs).toBe(0);
  });
  it("excludes invalid, incomplete, simulated, cross-guild/season and out-of-window rows", () => {
    const cases: Partial<CooperativeRun>[] = [{ valid: false }, { state: "ABANDONED" }, { runRef: "SIM-test" }, { guildId: "other" }, { seasonId: "other" },
      { startedAt: new Date(-1) }, { endedAt: scope.end }, { startedAt: new Date(NaN) }, { durationSec: null }, { completedBy: "manual" }];
    for (const change of cases) expect(cooperativeDungeonProgress(scope, [{ ...run(), ...change }]).runs).toBe(0);
  });
  it("recomputes corrected/invalidated rows and refuses inconsistent revisions in either order", () => {
    const original = run(), revoked = { ...original, valid: false };
    expect(cooperativeDungeonProgress(scope, [original]).runs).toBe(1);
    for (const rows of [[revoked], [original, revoked], [revoked, original]]) expect(cooperativeDungeonProgress(scope, rows).runs).toBe(0);
    const correction = structuredClone(original); correction.players[1]!.presentSec = 1;
    expect(cooperativeDungeonProgress(scope, [correction]).runs).toBe(0);
  });
  it("refuses missing routes, insufficient presence and unsupported rules instead of guessing", () => {
    const a = run(); a.players[1]!.presentSec = 899;
    expect(cooperativeDungeonProgress(scope, [a]).runs).toBe(0);
    a.players[1]!.presentSec = 900;
    expect(cooperativeDungeonProgress(scope, [a]).runs).toBe(1);
    a.instanceId = 123;
    expect(cooperativeDungeonProgress(scope, [a]).runs).toBe(0);
    expect(cooperativeDungeonProgress({ ...scope, rules: {} }, [run()]).supported).toBe(false);
  });
  it("keeps current-v2 evidence requirements when the frozen rules require them", () => {
    const rules = { ...scope.rules, evidencePolicy: "current-v2" };
    expect(cooperativeDungeonProgress({ ...scope, rules }, [run()]).runs).toBe(0);
  });
  it("scopes queries, filters linked members and refuses truncated totals", async () => {
    const database = { dungeonSeason: { findFirst: vi.fn().mockResolvedValue({ id: "season", ratingRules: scope.rules, startsAt: new Date(0), endsAt: null }) },
      dungeonRun: { findMany: vi.fn().mockResolvedValue(Array.from({ length: 2001 }, () => run())) } };
    const result = await cooperativeDungeonPreview(database as never, "guild", new Date("2026-10-30T12:00:00Z"));
    expect(database.dungeonSeason.findFirst.mock.calls[0]![0]).toMatchObject({ where: { guildId: "guild", status: "ACTIVE" } });
    expect(database.dungeonRun.findMany.mock.calls[0]![0]).toMatchObject({ where: { guildId: "guild", seasonId: "season", valid: true }, take: 2001,
      select: { players: { where: { member: { guildId: "guild" } } } } });
    expect(result).toMatchObject({ truncated: true, runs: 0, dungeons: 0 });
  });
});
