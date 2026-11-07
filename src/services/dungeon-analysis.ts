import type { BracketedRules } from "./dungeon-november-rules.js";
import { medianOf, quantileOf } from "./dungeon-season-observations.js";
import type { ScoreRun } from "./public-score.js";

// Read-only analysis of real dungeon runs (owner request, 7 November 2026: "analyse dungeon runs to have
// better scoring"). Pure: pass the runs and a rule set; nothing is written and no score changes.
// It answers four questions with data: how long does each route really take, which targets are still
// estimates, does being above or below the route's level band change the time, and does party size.
// docs/plans/DUNGEON_SCORING_V2.md explains what the numbers drive. `scripts/analyze-dungeon-runs.ts` runs it
// against the production database, read-only.

export const ANALYSIS_POLICY = {
  /** A route is "measured" with this many runs from this many distinct crews; fewer is "thin". */
  measuredRuns: 20, measuredCrews: 5,
  /** Robust outlier rule on ln(time): this many scaled MADs from the median. */
  outlierMads: 3.5,
  /** A level slope is only reported with at least this many runs inside the fitted window. */
  slopeMinRuns: 30,
  /** Levels over the band that the fit uses (older bands sit near the same value, further out the data is thin). */
  slopeWindow: [-3, 6] as const
} as const;

export interface TimeSpread { n: number; min: number | null; p10: number | null; p25: number | null; median: number | null; p75: number | null; p90: number | null; max: number | null }
export interface Outlier { runId: string; durationSec: number; ratio: number; reason: string }
export interface RouteAnalysis {
  key: string; name: string; bracket: string; targetSec: number; provisional: boolean;
  /** Final-boss clears on this route (any party, any levels). */
  runs: number; crews: number; time: TimeSpread;
  /** Same, without the outliers. */
  trimmed: TimeSpread;
  outliers: Outlier[];
  /** median / target: above 1 means players are slower than the target (a score under 200). */
  medianVsTarget: number | null;
  /** "none" no runs; "thin" under the measured policy; "measured" enough independent evidence to set a target from data. */
  status: "none" | "thin" | "measured";
  /** What a data-driven target (trimmed median of clean, in-band runs) would be, rounded to a minute; null when thin. */
  suggestedTargetSec: number | null;
}
export interface BucketEffect { label: string; n: number; medianRatio: number | null }
export interface LevelEffect {
  /** Fraction of the time that each level above the band takes off (1 - exp(slope)); null when the data is too thin. */
  timePerLevel: number | null; runsFitted: number;
  /** Median time / route median, by levels over the route's band. Negative = below the band. */
  byOverlevel: BucketEffect[];
}
export interface PartyEffect { bySize: BucketEffect[] }
export interface DungeonAnalysis {
  totalRuns: number; clears: number; unrouted: { instanceId: number; name: string; runs: number }[];
  routes: RouteAnalysis[]; level: LevelEffect; party: PartyEffect;
}

const round = (n: number) => Math.round(n);
const spread = (values: number[]): TimeSpread => {
  const a = [...values].sort((x, y) => x - y);
  return { n: a.length, min: a[0] ?? null, p10: quantileOf(a, 0.1), p25: quantileOf(a, 0.25), median: medianOf(a), p75: quantileOf(a, 0.75), p90: quantileOf(a, 0.9), max: a[a.length - 1] ?? null };
};
const medianNumber = (values: number[]): number | null => {
  const a = [...values].sort((x, y) => x - y);
  return a.length ? (a[Math.floor((a.length - 1) / 2)]! + a[Math.floor(a.length / 2)]!) / 2 : null;
};

/** Robust outliers on ln(time): beyond `outlierMads` scaled MADs, or under a third / over three times the median. */
export function findOutliers(runs: { runId: string; durationSec: number }[]): Outlier[] {
  if (runs.length < 5) return [];
  const logs = runs.map(r => Math.log(r.durationSec));
  const center = medianNumber(logs)!;
  const mad = medianNumber(logs.map(v => Math.abs(v - center)))!;
  const scale = Math.max(1.4826 * mad, 0.08); // never flag 8% jitter on a very tight route
  const median = Math.exp(center);
  return runs.flatMap((r, i) => {
    const z = Math.abs(logs[i]! - center) / scale;
    const ratio = r.durationSec / median;
    if (ratio < 1 / 3) return [{ runId: r.runId, durationSec: r.durationSec, ratio, reason: "under a third of the median (skipped content or a timer error)" }];
    if (ratio > 3) return [{ runId: r.runId, durationSec: r.durationSec, ratio, reason: "over three times the median (a long break or an AFK)" }];
    return z > ANALYSIS_POLICY.outlierMads ? [{ runId: r.runId, durationSec: r.durationSec, ratio, reason: `${z.toFixed(1)} robust deviations ${ratio < 1 ? "fast" : "slow"}` }] : [];
  });
}

/** Least-squares slope of y on x. */
function slope(points: { x: number; y: number }[]): number | null {
  if (points.length < 3) return null;
  const mx = points.reduce((s, p) => s + p.x, 0) / points.length, my = points.reduce((s, p) => s + p.y, 0) / points.length;
  const sxx = points.reduce((s, p) => s + (p.x - mx) ** 2, 0);
  return sxx === 0 ? null : points.reduce((s, p) => s + (p.x - mx) * (p.y - my), 0) / sxx;
}

/** Stable crew key: the sorted party (order and observer do not matter). */
const crewOf = (run: ScoreRun) => run.players.map(p => p.character.toLowerCase()).sort().join("|");

export function analyzeRuns(runs: ScoreRun[], rules: BracketedRules): DungeonAnalysis {
  const routeByKey = new Map(rules.routes.filter(r => r.targetSec !== null).map(r => [r.dungeonKey, r]));
  const clears = runs.filter(r => !r.challenge && r.evidence?.completedBy === "final boss");
  const grouped = new Map<string, ScoreRun[]>();
  const unrouted = new Map<number, { name: string; runs: number }>();
  for (const run of clears) {
    const key = run.routeKey ?? String(run.instanceId);
    if (!routeByKey.has(key)) {
      const row = unrouted.get(run.instanceId) ?? { name: run.dungeonName, runs: 0 };
      row.runs++; unrouted.set(run.instanceId, row);
      continue;
    }
    grouped.set(key, [...grouped.get(key) ?? [], run]);
  }
  const ratios: { over: number; ratio: number; size: number }[] = [];
  const routes: RouteAnalysis[] = [...routeByKey.values()].map(route => {
    const rows = grouped.get(route.dungeonKey) ?? [];
    const band = rules.levelBands[route.dungeonKey];
    const outliers = findOutliers(rows.map(r => ({ runId: r.runId, durationSec: r.durationSec })));
    const bad = new Set(outliers.map(o => o.runId));
    const clean = rows.filter(r => !bad.has(r.runId));
    const median = medianOf(clean.map(r => r.durationSec));
    if (median) for (const run of clean) {
      const levels = run.players.map(p => p.level).filter((l): l is number => typeof l === "number");
      if (!band || !levels.length) continue;
      ratios.push({ over: Math.max(...levels) - band.max, ratio: run.durationSec / median, size: run.players.length });
    }
    const crews = new Set(rows.map(crewOf)).size;
    const inBand = clean.filter(r => band && r.players.every(p => typeof p.level === "number" && p.level <= band.max && p.level >= band.min));
    const measured = rows.length >= ANALYSIS_POLICY.measuredRuns && crews >= ANALYSIS_POLICY.measuredCrews;
    const target = rules.targets[route.dungeonKey] ?? route.targetSec!;
    const clip = medianOf(inBand.length >= 8 ? inBand.map(r => r.durationSec) : clean.map(r => r.durationSec));
    return { key: route.dungeonKey, name: route.name, bracket: rules.routeBracket[route.dungeonKey] ?? "", targetSec: target,
      provisional: !!rules.catalog.find(c => c.dungeonKey === route.dungeonKey)?.provisional,
      runs: rows.length, crews, time: spread(rows.map(r => r.durationSec)), trimmed: spread(clean.map(r => r.durationSec)), outliers,
      medianVsTarget: median ? Math.round((median / target) * 100) / 100 : null,
      status: rows.length === 0 ? "none" : measured ? "measured" : "thin",
      suggestedTargetSec: measured && clip ? Math.max(300, round(clip / 60) * 60) : null };
  });
  // Level effect: ln(time / route median) against levels over the band, pooled over every route.
  const [lo, hi] = ANALYSIS_POLICY.slopeWindow;
  const fit = ratios.filter(r => r.over >= lo && r.over <= hi);
  const fitted = fit.length >= ANALYSIS_POLICY.slopeMinRuns ? slope(fit.map(r => ({ x: r.over, y: Math.log(r.ratio) }))) : null;
  const bucket = (label: string, rows: { ratio: number }[]): BucketEffect => ({ label, n: rows.length, medianRatio: rows.length ? Math.round(medianNumber(rows.map(r => r.ratio))! * 100) / 100 : null });
  const overs = [...new Set(ratios.map(r => Math.max(-3, Math.min(8, r.over))))].sort((a, b) => a - b);
  const sizes = [[0, 3, "1-3 players"], [4, 4, "4 players"], [5, 99, "5 players"]] as const;
  return {
    totalRuns: runs.length, clears: clears.length, unrouted: [...unrouted].map(([instanceId, row]) => ({ instanceId, ...row })).sort((a, b) => b.runs - a.runs),
    routes: routes.sort((a, b) => a.bracket.localeCompare(b.bracket) || a.name.localeCompare(b.name)),
    level: { timePerLevel: fitted === null ? null : Math.round((1 - Math.exp(fitted)) * 1000) / 1000, runsFitted: fit.length,
      byOverlevel: overs.map(o => bucket(o <= -3 ? "3+ under" : o >= 8 ? "8+ over" : o === 0 ? "in band" : o < 0 ? `${-o} under` : `${o} over`, ratios.filter(r => Math.max(-3, Math.min(8, r.over)) === o))) },
    party: { bySize: sizes.map(([from, to, label]) => bucket(label, ratios.filter(r => r.size >= from && r.size <= to))) }
  };
}

const mm = (seconds: number | null) => seconds === null ? "–" : `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, "0")}`;

/** Plain-text report for the owner / the coordinator. */
export function analysisReport(a: DungeonAnalysis): string {
  const lines = [`# Dungeon run analysis`, ``, `${a.totalRuns} runs read, ${a.clears} final-boss clears.`, ``,
    `| Route | Bracket | Runs | Crews | p10 | Median | p90 | Target | Median/target | Status | Suggested | Outliers |`,
    `| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: |`];
  for (const r of a.routes) lines.push(`| ${r.name} | ${r.bracket} | ${r.runs} | ${r.crews} | ${mm(r.time.p10)} | ${mm(r.time.median)} | ${mm(r.time.p90)} | ${mm(r.targetSec)}${r.provisional ? " (estimate)" : ""} | ${r.medianVsTarget ?? "–"} | ${r.status} | ${mm(r.suggestedTargetSec)} | ${r.outliers.length} |`);
  lines.push(``, `## Level effect (${a.level.runsFitted} runs fitted)`, a.level.timePerLevel === null ? `Too few runs to fit a slope.` : `Each level above the band takes about ${(a.level.timePerLevel * 100).toFixed(1)}% off the time.`, ``,
    `| Over the band | Runs | Time vs route median |`, `| --- | ---: | ---: |`, ...a.level.byOverlevel.map(b => `| ${b.label} | ${b.n} | ${b.medianRatio ?? "–"} |`),
    ``, `## Party size`, ``, `| Size | Runs | Time vs route median |`, `| --- | ---: | ---: |`, ...a.party.bySize.map(b => `| ${b.label} | ${b.n} | ${b.medianRatio ?? "–"} |`));
  if (a.unrouted.length) lines.push(``, `## Cleared but no route`, ...a.unrouted.map(u => `- ${u.name} (map ${u.instanceId}): ${u.runs} clears`));
  const flagged = a.routes.filter(r => r.outliers.length);
  if (flagged.length) lines.push(``, `## Outliers`, ...flagged.flatMap(r => r.outliers.slice(0, 5).map(o => `- ${r.name} ${o.runId}: ${mm(o.durationSec)} (${o.reason})`)));
  return lines.join("\n");
}
