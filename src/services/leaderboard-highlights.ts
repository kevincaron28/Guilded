import { characterId, characterScores, scoreRun, type ScoreRow, type ScoreRun } from "./public-score.js";
import type { BracketedRules } from "./dungeon-november-rules.js";

// What changed this week, computed from the runs the page already loaded. Pure.

export interface Climber { row: ScoreRow; before: number | null; gain: number }

/**
 * The characters whose score in a bracket grew most since `since`. Only characters that already had a score before
 * `since` count: a character's first rated run is "new on the board" (see newcomers), not a climb. Counting it as one
 * made every member of a party show the same gain (their whole score, identical for a shared run) in a season's first week.
 */
export function climbers(runs: ScoreRun[], since: Date, rules: BracketedRules, bracket: string, limit = 5): Climber[] {
  const now = characterScores(runs, rules).filter((row) => row.bracket === bracket);
  const earlier = new Map(characterScores(runs.filter((run) => run.endedAt < since), rules).filter((row) => row.bracket === bracket).map((row) => [characterId(row.player), row.points]));
  return now.flatMap((row): Climber[] => {
    const before = earlier.get(characterId(row.player));
    return before === undefined ? [] : [{ row, before, gain: row.points - before }];
  }).filter((entry) => entry.gain > 0).sort((a, b) => b.gain - a.gain || b.row.points - a.row.points).slice(0, limit);
}

/** Characters whose first rated score in a bracket came since `since`, best score first. */
export function newcomers(runs: ScoreRun[], since: Date, rules: BracketedRules, bracket: string, limit = 5): ScoreRow[] {
  const earlier = new Set(characterScores(runs.filter((run) => run.endedAt < since), rules).filter((row) => row.bracket === bracket).map((row) => characterId(row.player)));
  return characterScores(runs, rules).filter((row) => row.bracket === bracket && !earlier.has(characterId(row.player))).slice(0, limit);
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

export interface DungeonMilestones<R extends ScoreRun> { fastest: R | null; first: R | null }

/**
 * A dungeon's fastest clear and first clear among its runs. Only runs that score under `rules` count (a manual stop or an
 * unrecognised route is activity, not a record); a tie in time goes to the earlier finish.
 */
export function dungeonMilestones<R extends ScoreRun>(runs: R[], rules: BracketedRules): DungeonMilestones<R> {
  const counted = runs.filter((run) => !run.challenge && (!rules.evidencePolicy || scoreRun(run, rules)));
  const fastest = counted.reduce<R | null>((best, run) => !best || run.durationSec < best.durationSec || run.durationSec === best.durationSec && run.endedAt < best.endedAt ? run : best, null);
  const first = counted.reduce<R | null>((best, run) => !best || run.endedAt < best.endedAt ? run : best, null);
  return { fastest, first };
}
