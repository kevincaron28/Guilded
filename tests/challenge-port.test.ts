import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../src/generated/prisma/client.js";
import { exportDungeonRuns } from "../companion/lua-export-content.mjs";
import { dungeonRunSchema, validateRun } from "../src/services/dungeon-rules.js";
import { agrees, evidenceUpgrade, summarize } from "../src/services/public-runs.js";
import { rankChallenges, challengeClock, type ChallengeRun } from "../src/services/challenge-leaderboard.js";
import { guildChallengeBoard } from "../src/services/challenge-guild.js";
import { withEdition } from "../src/services/edition-context.js";
import { publicRules, rateRun } from "../src/services/public-score.js";

const challenge = { mapId: 501, level: 10, affixIds: [3, 9], durationMs: 645123, timeLimitSec: 1800,
  onTime: true, practiceRun: false, eligibleForScore: true };
const end = new Date("2026-10-25T12:00:00Z");
const epoch = end.getTime() / 1000;
const native = { id: "QG-Fixture-Tester", gameEdition: "retail", protocolVersion: 1, state: "COMPLETED", instanceId: 123,
  difficultyId: 8, name: "Synthetic dungeon", startedAt: epoch - 600, endedAt: epoch, completedBy: "challenge objectives",
  recorder: "Tester-Realm", reporters: { "Tester-Realm": true }, challengeMode: true,
  challenge: { ...challenge, affixIds: { 1: 9, 2: 3 } },
  players: { "Tester-Realm": { level: 90, minLevel: 90, presentSec: 600 } } };
function scoreRun(over: Partial<ChallengeRun> = {}): ChallengeRun {
  return { gameEdition: "retail", runId: "run1", instanceId: 123, difficultyId: 8, dungeonName: "Fixture",
    durationSec: 600, endedAt: end, challenge, evidence: { completedBy: "challenge objectives" },
    players: [{ character: "Tester", realm: "Realm", presentSec: 600 }], ...over };
}
describe("native challenge port", () => {
  it("exports SavedVariables through both companions and preserves native evidence for public import", () => {
    const [wire] = exportDungeonRuns({ dungeon: { runs: { fixture: native } } }, "Realm");
    const run = dungeonRunSchema.parse(wire);
    expect(run.challenge).toEqual(challenge);
    expect(validateRun(run, end)).toEqual({ ok: true });
    const summary = summarize(run);
    expect(summary.challenge).toEqual(challenge);
    expect(summary.durationSec).toBe(600); // presence uses wall time, ranking uses 645.123 native seconds
    expect(challengeClock(challenge.durationMs)).toBe("10:45.123");
    expect(validateRun({ ...run, gameEdition: "classic-mists" }, end).ok).toBe(false);
    expect(validateRun({ ...run, completedBy: "manual" }, end).ok).toBe(false);
    expect(dungeonRunSchema.safeParse({ ...run, challenge: { ...challenge, durationMs: -1 } }).success).toBe(false);
  });
  it("disputes native disagreements and only upgrades a whole compatible observation", () => {
    const incoming = summarize(dungeonRunSchema.parse(exportDungeonRuns({ dungeon: { runs: { native } } }, "Realm")[0]));
    expect(agrees(incoming, { ...incoming, challenge: { ...challenge, level: 11 } })).toBe(false);
    expect(agrees(incoming, { ...incoming, challenge: { ...challenge, durationMs: 645124 } })).toBe(false);
    expect(agrees(incoming, { ...incoming, challenge: { ...challenge, affixIds: [3, 10] } })).toBe(false);
    const older = { ...incoming }; delete older.challenge;
    expect(evidenceUpgrade(older, incoming)).toBe(true);
    expect(evidenceUpgrade(incoming, older)).toBe(false);
  });
  it("ranks highest timed key first, then native time; keeps realms, maps and affixes independent", () => {
    const runs = [scoreRun(), scoreRun({ runId: "wall-faster", durationSec: 500, challenge: { ...challenge, durationMs: 700000 } }),
      scoreRun({ runId: "higher", challenge: { ...challenge, level: 11, durationMs: 1200000 } }),
      scoreRun({ runId: "other-realm", players: [{ character: "Tester", realm: "Other", presentSec: 600 }] }),
      scoreRun({ runId: "other-affix", challenge: { ...challenge, affixIds: [10] } }),
      scoreRun({ runId: "other-map", challenge: { ...challenge, mapId: 502 } })];
    const rows = rankChallenges(runs);
    expect(rows).toHaveLength(4);
    expect(rows.filter(r => r.group === "501/3,9").map(r => r.run.runId)).toEqual(["higher", "other-realm"]);
    expect(rankChallenges(runs, p => p.realm === "Other")).toHaveLength(1);
  });
  it.each([
    { onTime: false }, { practiceRun: true }, { eligibleForScore: false }, { durationMs: 1800001 },
    { level: 1 }, { affixIds: [3, 3] }
  ])("keeps ineligible native result out of the leaderboard: %j", change => {
    expect(rankChallenges([scoreRun({ challenge: { ...challenge, ...change } })])).toEqual([]);
  });
  it("rejects missing evidence, manual completion, insufficient presence and other editions", () => {
    expect(rankChallenges([scoreRun({ challenge: null }), scoreRun({ evidence: { completedBy: "manual" } }),
      scoreRun({ gameEdition: "forever" }), scoreRun({ runId: "SIM-run" }),
      scoreRun({ players: [{ character: "Tester", realm: "Realm", presentSec: 479 }] })])).toEqual([]);
    expect(rateRun({ ...scoreRun(), evidence: null, challenge, routeKey: "123", confirmations: 2, players: [] }, publicRules("retail")).reason)
      .toBe("Mythic+ uses the keystone leaderboard");
  });
  it("reads only the selected guild's current season and linked members", async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: "db1", runRef: "QG-run", instanceId: 123, difficultyId: 8, dungeonName: "Fixture",
      durationSec: 600, endedAt: end, completedBy: "challenge objectives", competitionData: { challenge },
      players: [{ character: "Tester-Realm", presentSec: 600 }] }]);
    const database = { dungeonSeason: { findFirst: vi.fn().mockResolvedValue({ id: "s1", name: "Season", startsAt: new Date(0), endsAt: null }) }, dungeonRun: { findMany } } as unknown as PrismaClient;
    const board = await withEdition("retail", () => guildChallengeBoard(database, "retail-guild-2", "en"));
    expect(findMany.mock.calls[0]![0]).toMatchObject({ where: { guildId: "retail-guild-2", seasonId: "s1", valid: true },
      select: { players: { where: { member: { guildId: "retail-guild-2" } } } } });
    expect(board.toJSON().fields?.[0]?.value).toContain("+10 · 10:45.123");
    await expect(withEdition("forever", () => guildChallengeBoard(database, "forever", "en"))).rejects.toThrow("Retail");
  });
});
