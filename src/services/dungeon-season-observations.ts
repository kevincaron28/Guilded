import { calibrationSample, CALIBRATION_POLICY } from "./dungeon-calibration.js";
import type { BracketedRules } from "./dungeon-november-rules.js";
import { withIntegrityWindow } from "./dungeon-integrity.js";
import { characterId, rateRun, type ScoreRun } from "./public-score.js";

// Observation only (owner request, 6 November 2026): real completion times per dungeon route and
// bracket. Nothing here changes a score, a target or a season; Season 1 keeps its frozen rules.
// The numbers feed the Season 2 proposal (dungeon-season2.ts) and `/guilded-season observations`.
// docs/DUNGEON_SEASON_2_PLAN.md explains what is counted and why.

export interface RouteObservation {
  key: string; name: string; bracket: string; targetSec: number;
  /** Ranked, unpenalised runs on this route (every accepted public run counts once, whoever uploaded it). */
  count: number;
  median: number | null; p25: number | null; p75: number | null;
  /** One time per crew and UTC day (repeat farming and swapped-in crews add no weight): the number the formula trusts. */
  samples: number; crews: number; days: number;
  independentMedian: number | null; independentP25: number | null; independentP75: number | null;
  /** The crew/day policy of dungeon-calibration.ts is met (20 samples, 5 crews, 3 days). */
  ready: boolean;
  /** Runs whose recorded start was not a first combat or a peer-confirmed one (excluded from the independent sample). */
  otherStart: number;
  /** Runs without stored start provenance (counted as first combat; they predate the observed-start evidence). */
  unverifiedStart: number;
  /** Runs that would also be ranked under the stricter current-v2 evidence policy. */
  v2Count: number;
}
export interface UnratedObservation { instanceId: number; name: string; count: number; median: number | null; levels: [number, number] | null }
export interface SeasonObservations {
  from: Date; to: Date | null; totalRuns: number; ratedRuns: number; penalisedRuns: number; v2Runs: number;
  routes: RouteObservation[]; unrated: UnratedObservation[];
}

const sorted = (values: number[]) => [...values].sort((a, b) => a - b);
/** The same median and quartile convention as dungeon-calibration.ts. */
export const medianOf = (values: number[]): number | null => {
  const a = sorted(values);
  return a.length ? Math.round((a[Math.floor((a.length - 1) / 2)]! + a[Math.floor(a.length / 2)]!) / 2) : null;
};
export const quantileOf = (values: number[], fraction: number): number | null => {
  const a = sorted(values);
  return a.length ? a[Math.floor((a.length - 1) * fraction)]! : null;
};

const startOf = (run: ScoreRun): { trigger: string; known: boolean } => {
  const trigger = (run.evidence?.integrity as { startTrigger?: string } | undefined)?.startTrigger;
  if (!trigger) return { trigger: "first combat", known: false };
  return { trigger: trigger === "peer" ? "first combat" : trigger, known: true };
};

/** Every run of one season window, summarised per rated route. Pure: pass the runs and the window's frozen rules. */
export function observeSeason(runs: ScoreRun[], rules: BracketedRules, from: Date, to: Date | null): SeasonObservations {
  const v2Rules = withIntegrityWindow({ ...rules, evidencePolicy: "current-v2" as const }, from, to);
  const byRoute = new Map<string, { run: ScoreRun; bracket: string; v2: boolean }[]>();
  const unrated = new Map<number, { name: string; times: number[]; levels: number[] }>();
  let ratedRuns = 0, penalisedRuns = 0, v2Runs = 0, totalRuns = 0;
  for (const run of runs) {
    if (run.challenge || run.endedAt < from || (to && run.endedAt >= to)) continue;
    totalRuns++;
    const verdict = rateRun(run, rules);
    if (!verdict.score) {
      // A completed clear of a map no route covers yet: what the next season could add.
      if (verdict.reason === "Route not rated yet" && run.evidence?.completedBy === "final boss") {
        const row = unrated.get(run.instanceId) ?? { name: run.dungeonName, times: [], levels: [] };
        row.times.push(run.durationSec);
        for (const p of run.players) if (typeof p.level === "number") row.levels.push(p.level);
        unrated.set(run.instanceId, row);
      }
      continue;
    }
    ratedRuns++;
    // A group above the route's levels finishes faster than the route's own audience: not a timing sample.
    if (verdict.score.penaltyPercent > 0) { penalisedRuns++; continue; }
    const v2 = rateRun(run, v2Rules).score !== null;
    if (v2) v2Runs++;
    byRoute.set(verdict.score.key, [...byRoute.get(verdict.score.key) ?? [], { run, bracket: verdict.score.bracket, v2 }]);
  }
  const names = new Map(rules.routes.map(r => [r.dungeonKey, r.name]));
  const routes: RouteObservation[] = rules.routes.filter(r => r.targetSec !== null).map(route => {
    const rows = byRoute.get(route.dungeonKey) ?? [];
    const times = rows.map(r => r.run.durationSec);
    const starts = rows.map(r => startOf(r.run));
    const sample = calibrationSample(rows.map((r, i) => ({
      id: r.run.runId, seconds: r.run.durationSec, endedAt: r.run.endedAt,
      crew: r.run.players.map(characterId), build: "season", startTrigger: starts[i]!.trigger
    })));
    return {
      key: route.dungeonKey, name: names.get(route.dungeonKey) ?? route.dungeonKey, bracket: rules.routeBracket[route.dungeonKey] ?? "",
      targetSec: rules.targets[route.dungeonKey]!, count: rows.length,
      median: medianOf(times), p25: quantileOf(times, 0.25), p75: quantileOf(times, 0.75),
      samples: sample.times.length, crews: sample.crews, days: sample.days,
      independentMedian: sample.median, independentP25: sample.p25, independentP75: sample.p75, ready: sample.ready,
      otherStart: starts.filter(s => s.known && s.trigger !== "first combat").length,
      unverifiedStart: starts.filter(s => !s.known).length,
      v2Count: rows.filter(r => r.v2).length
    };
  });
  return {
    from, to, totalRuns, ratedRuns, penalisedRuns, v2Runs, routes,
    unrated: [...unrated.entries()].map(([instanceId, row]) => ({ instanceId, name: row.name, count: row.times.length, median: medianOf(row.times),
      levels: row.levels.length ? [Math.min(...row.levels), Math.max(...row.levels)] as [number, number] : null }))
      .sort((a, b) => b.count - a.count || a.instanceId - b.instanceId)
  };
}

export { CALIBRATION_POLICY };
