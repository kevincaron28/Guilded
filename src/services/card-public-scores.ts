import type { PrismaClient } from "../generated/prisma/client.js";
import { dungeonRole } from "../../companion/dungeon-role.mjs";
import { integrityRole } from "./dungeon-integrity.js";
import type { DungeonImportResult } from "./dungeon-import.js";
import { loadOfficialWindows } from "./official-seasons.js";
import { prismaLeaderboardStore, type LeaderboardStore } from "./public-leaderboard.js";
import { characterId, characterScores, periodRules, publicSeasons, rateRun, type PublicPeriod, type ScorePlayer, type ScoreRun } from "./public-score.js";
import { runKeyOf } from "./public-runs.js";

/**
 * (9.3.6) The score columns of a run card for a player outside the guild, from the public rating: the player's season total for the
 * role they played, and what this run added to it. Pure: `runs` are the character's public runs (this run included), `thisRunId` the
 * public run that is this run. Null when the run is not rated for them (the card then keeps its guild-run number).
 */
export function publicCardScore(runs: ScoreRun[], thisRunId: string, me: Pick<ScorePlayer, "character" | "realm">, role: string | null, periods: PublicPeriod[]): { total: number; gain: number } | null {
  const run = runs.find((candidate) => candidate.runId === thisRunId);
  if (!run) return null;
  const period = periods.find((p) => (!p.from || p.from <= run.endedAt) && (!p.to || run.endedAt < p.to));
  if (!period) return null;
  const rules = periodRules(period);
  const history = runs.filter((candidate) => (!period.from || candidate.endedAt >= period.from) && (!period.to || candidate.endedAt < period.to));
  const bracket = rateRun(run, rules).score?.bracket;
  if (!bracket) return null;
  const id = characterId(me);
  const roleOf = (player: ScorePlayer) => rules.evidencePolicy === "current-v2" ? integrityRole(player.integrity) : dungeonRole(player.role);
  const pointsOf = (list: ScoreRun[], filterRole: boolean) => characterScores(list, rules, (player) => characterId(player) === id && (!filterRole || roleOf(player) === role)).find((row) => row.bracket === bracket)?.points;
  // The role's score when the character has one in that role, else the overall score.
  const useRole = !!role && pointsOf(history, true) !== undefined;
  const total = pointsOf(history, useRole);
  if (total === undefined) return null;
  const before = pointsOf(history.filter((candidate) => candidate.runId !== thisRunId), useRole) ?? 0;
  return { total, gain: Math.max(0, total - before) };
}

const same = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * Fills ratingTotal / ratingGain of the players outside the guild whose run was also published publicly (same run key), matched by
 * full name to the public run's player rows (which carry the realm). Players with no public match keep the guild-run numbers.
 * Never throws: a card without the improvement is still a card.
 */
export async function applyPublicScores(database: PrismaClient, results: DungeonImportResult[], now = new Date(), store: LeaderboardStore = prismaLeaderboardStore(database)): Promise<number> {
  let filled = 0;
  try {
    const periods = publicSeasons(now, await loadOfficialWindows(database));
    for (const result of results) {
      const outsiders = (result.playerDetails ?? []).filter((detail) => !(result.inGuildPlayers ?? []).includes(detail.character) && result.unlinked.includes(detail.character));
      if (!outsiders.length || result.instanceId === undefined) continue;
      const published = await database.publicRun.findUnique({ where: { runKey: runKeyOf({ instanceId: result.instanceId, id: result.runRef }) }, select: { id: true } });
      if (!published) continue;
      const rows = await database.publicRunPlayer.findMany({ where: { runId: published.id }, select: { character: true, displayName: true, realm: true } });
      for (const detail of outsiders) {
        const full = result.fullNames?.[detail.character] ?? detail.character;
        const row = rows.find((candidate) => candidate.realm && (same(candidate.displayName, full) || same(candidate.character, full) || same(candidate.character, detail.character)));
        if (!row) continue;
        const score = publicCardScore(await store.characterRuns(row.character, row.realm), published.id, { character: row.character, realm: row.realm }, dungeonRole(detail.role) ?? null, periods);
        if (!score) continue;
        detail.ratingTotal = score.total;
        detail.ratingGain = score.gain;
        filled++;
      }
    }
  } catch (error) {
    console.error("Public scores for the run card failed", error);
  }
  return filled;
}
