import { penalized, timeRating } from "./dungeon-rating.js";
import { routeTargetAt, type BracketedRules } from "./dungeon-november-rules.js";
import { characterId, rateRun, type ScoreRun } from "./public-score.js";

export const REPLAY_CURVES = ["current", "bounded-linear", "damped-ratio"] as const;
export function curvePoints(curve: typeof REPLAY_CURVES[number], seconds: number, target: number): number {
  if (curve === "current") return timeRating(seconds, target);
  const raw = curve === "bounded-linear" ? 200 + 200 * (1 - seconds / target) : 200 * Math.sqrt(target / seconds);
  return Math.max(50, Math.min(400, Math.round(raw)));
}

/** Offline only. No writes, database access, new rules version or live formula switch. */
export function replayCurves(runs: ScoreRun[], rules: BracketedRules) {
  const observations = new Map<string, ScoreRun>();
  for (const run of runs) {
    const previous = observations.get(run.runId);
    if (previous && JSON.stringify(previous) !== JSON.stringify(run)) throw new Error("Conflicting observations for one run ID; resolve report agreement before replay.");
    observations.set(run.runId, run);
  }
  const unique = [...observations.values()];
  const eligible = unique.filter(run => run.evidence && rateRun(run, rules).score && run.players.some(p => rateRun(run, rules, p).score)
    && run.durationSec >= 180 && run.durationSec <= 14400);
  const boards = REPLAY_CURVES.map(curve => {
    const players = new Map<string, { bracket: string; bests: Map<string, number> }>();
    let cappedRuns = 0;
    for (const run of eligible) {
      const score = rateRun(run, rules).score!;
      const base = curvePoints(curve, run.durationSec, routeTargetAt(rules, score.key, run.endedAt)!);
      if (base === 400) cappedRuns++;
      for (const player of run.players) {
        if (!rateRun(run, rules, player).score) continue;
        const id = `${score.bracket}\0${characterId(player)}`;
        const row = players.get(id) ?? { bracket: score.bracket, bests: new Map<string, number>() };
        row.bests.set(score.key, Math.max(row.bests.get(score.key) ?? 0, penalized(base, score.penaltyPercent)));
        players.set(id, row);
      }
    }
    const rows = [...players].map(([id, row]) => {
      const kept = [...row.bests].sort(([ak, ap], [bk, bp]) => bp - ap || ak.localeCompare(bk)).slice(0, rules.brackets.find(b => b.key === row.bracket)!.bestCount);
      return { id, bracket: row.bracket, points: kept.reduce((sum, [, points]) => sum + points, 0), kept: kept.map(([key]) => key) };
    });
    const ranks = new Map(rows.map(row => [row.id, 1 + rows.filter(other => other.bracket === row.bracket && other.points > row.points).length]));
    return { curve, cappedRuns, rows, ranks };
  });
  const baseline = boards[0]!;
  const median = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted.length ? (sorted[Math.floor((sorted.length - 1) / 2)]! + sorted[Math.floor(sorted.length / 2)]!) / 2 : null;
  };
  const levelGroups = rules.routes.map(route => ({ route: route.dungeonKey, groups: [false, true].map(overlevel => {
    const sample = eligible.filter(run => { const s = rateRun(run, rules).score!; return s.key === route.dungeonKey && (s.penaltyPercent > 0) === overlevel; });
    return { overlevel, runs: sample.length, medianTimeToTarget: median(sample.map(run => run.durationSec / routeTargetAt(rules, route.dungeonKey, run.endedAt)!)),
      medianCurrentPoints: median(sample.map(run => rateRun(run, rules).score!.points)) };
  }) }));
  return { inputRuns: runs.length, duplicateRuns: runs.length - unique.length, eligibleRuns: eligible.length, excludedRuns: runs.length - eligible.length, levelGroups,
    caution: "Exploratory replay, not a validated replacement. Compare only one season/build/start convention; small samples cannot justify a new curve.",
    curves: boards.map(board => ({ curve: board.curve, cappedRuns: board.cappedRuns, capFraction: eligible.length ? board.cappedRuns / eligible.length : 0,
      brackets: rules.brackets.map(bracket => {
        const rows = board.rows.filter(row => row.bracket === bracket.key);
        const changes = rows.map(row => Math.abs(board.ranks.get(row.id)! - baseline.ranks.get(row.id)!));
        const slots = rows.flatMap(row => row.kept);
        const routes = [...new Set(slots)].sort().map(key => ({ key, counted: slots.filter(k => k === key).length }));
        return { bracket: bracket.key, characters: rows.length, rankChanges: changes.filter(n => n > 0).length, maxRankChange: Math.max(0, ...changes),
          tiedCharacters: rows.filter(row => rows.some(other => other.id !== row.id && other.points === row.points)).length,
          largestRouteShare: slots.length ? Math.max(...routes.map(r => r.counted)) / slots.length : 0, routes };
      }) })) };
}
