import { characterId, characterScores, scoreRun, type ScoreRow, type ScoreRun } from "./public-score.js";
import type { BracketedRules } from "./dungeon-november-rules.js";

// What changed this week, computed from the runs the page already loaded. Pure.

export interface Climber { row: ScoreRow; before: number | null; gain: number }

/** The characters whose score in a bracket grew most since `since` (a character with no earlier score counts as new). */
export function climbers(runs: ScoreRun[], since: Date, rules: BracketedRules, bracket: string, limit = 5): Climber[] {
  const now = characterScores(runs, rules).filter((row) => row.bracket === bracket);
  const earlier = new Map(characterScores(runs.filter((run) => run.endedAt < since), rules).filter((row) => row.bracket === bracket).map((row) => [characterId(row.player), row.points]));
  return now.map((row): Climber => {
    const before = earlier.get(characterId(row.player)) ?? null;
    return { row, before, gain: row.points - (before ?? 0) };
  }).filter((entry) => entry.gain > 0).sort((a, b) => b.gain - a.gain || b.row.points - a.row.points).slice(0, limit);
}

/** Rank by character id in one bracket, before and now: for the little movement arrows (positive = moved up). */
export function rankMovement(runs: ScoreRun[], since: Date, rules: BracketedRules, bracket: string, keep?: Parameters<typeof characterScores>[2]): Map<string, number | null> {
  const rankOf = (list: ScoreRun[]) => new Map(characterScores(list, rules, keep).filter((row) => row.bracket === bracket).map((row, i) => [characterId(row.player), i + 1] as const));
  const now = rankOf(runs), before = rankOf(runs.filter((run) => run.endedAt < since));
  return new Map([...now].map(([id, rank]) => [id, before.has(id) ? before.get(id)! - rank : null]));
}

export interface BrokenRecord { run: ScoreRun; previousSec: number | null }

/** Dungeons whose best time was set since `since`, with the time it beat (null when it was the first). Only runs that score count. */
export function recordsBroken(runs: ScoreRun[], since: Date, rules: BracketedRules, limit = 5): BrokenRecord[] {
  const byDungeon = new Map<string, ScoreRun[]>();
  for (const run of runs) {
    if (run.challenge || !scoreRun(run, rules)) continue;
    // One record per dungeon and route or difficulty: different routes are different races.
    const key = `${run.instanceId}|${run.routeKey ?? ""}|${run.difficultyId ?? ""}`;
    const list = byDungeon.get(key) ?? [];
    list.push(run);
    byDungeon.set(key, list);
  }
  const out: BrokenRecord[] = [];
  for (const list of byDungeon.values()) {
    const best = list.reduce((a, b) => (b.durationSec < a.durationSec || b.durationSec === a.durationSec && b.endedAt < a.endedAt ? b : a));
    if (best.endedAt < since) continue;
    const earlier = list.filter((run) => run.endedAt < since);
    out.push({ run: best, previousSec: earlier.length ? Math.min(...earlier.map((run) => run.durationSec)) : null });
  }
  return out.sort((a, b) => b.run.endedAt.getTime() - a.run.endedAt.getTime()).slice(0, limit);
}
