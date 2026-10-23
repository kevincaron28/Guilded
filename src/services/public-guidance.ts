import { bracketForLevel, routeTargetAt, type BracketedRules } from "./dungeon-november-rules.js";
import type { LevelBand } from "./dungeon-rating.js";
import { characterId, characterScores, rateRun, type ScorePlayer, type ScoreRow, type ScoreRun } from "./public-score.js";
import { ROLES, type Role } from "./recruitment.js";
import { MIN_DURATION_SEC, MAX_DURATION_SEC } from "./dungeon-rules.js";

// Player guidance on the public character page (docs/RAIDER_IO_SCORING_ANALYSIS_2026-10-22.md, item 2).
// - Best next improvement: for each route of the character's bracket, the slowest clear that would
//   raise the season score, and by exactly how much. Each scenario adds one hypothetical run and
//   recomputes the whole best-N selection with characterScores, so the points come from the same
//   timeRating, penalty and rounding as real runs, and a faster run on a route outside best N
//   honestly adds nothing. Times are scenarios under the season's rules, not predictions.
// - Role totals: tank, healer and DPS scores, each from the runs played in that role only. Never
//   added together; a run with no recorded role counts in the overall score only.

/** The smallest season gain a scenario suggests (less when only less is possible): one point is rounding. */
export const GAIN_STEP = 5;

export interface Scenario {
  /** The slowest whole-second clear that earns `gain`; null when any ranked clear does. */
  durationSec: number | null;
  /** What the scenario run itself scores, level penalty included. */
  routePoints: number;
  gain: number;
  /** The bracket's season score after the run. */
  total: number;
  /** Counted routes the run would push out of best N. */
  pushedOut: { key: string; points: number }[];
}
/** The character's level against a route's: rateable ("ok"), too low yet, too high (a carry), or unknown. */
export type LevelFit = "ok" | "below" | "carry" | "unknown";
export interface RoutePlan {
  key: string; name: string; band: LevelBand; targetSec: number;
  best: { points: number; durationSec: number; counted: boolean; evidence: "verified" | "legacy"; confirmations: number } | null;
  fit: LevelFit; penaltyPercent: number;
  /** Null when no run of this route can raise the season score (already 400, or a carry). */
  next: Scenario | null;
}
export interface ImprovementPlan {
  bracket: string; bestCount: number; level: number | null; total: number; counted: number;
  /** The lowest counted route once best N is full: what an uncounted route has to beat. */
  weakest: { key: string; points: number } | null;
  routes: RoutePlan[];
  /** The route needing the least speed for its next gain (null while best N has open places). */
  easiest: RoutePlan | null;
}

/** One season's runs for `me`, scored with `rules`; `level` is the character's level now (null when unknown). */
export interface PlanInput { runs: ScoreRun[]; rules: BracketedRules; me: ScorePlayer; level: number | null; now: Date }
export interface PlanBase { rules: BracketedRules; me: ScorePlayer; bracket: string; runs: ScoreRun[]; before: ScoreRow | undefined; now: Date }

function rowOf(runs: ScoreRun[], rules: BracketedRules, me: ScorePlayer, bracket: string): ScoreRow | undefined {
  const id = characterId(me);
  return characterScores(runs, rules, (player) => characterId(player) === id).find((row) => row.bracket === bracket);
}
const countedRoutes = (row: ScoreRow | undefined) => row?.routes.filter((r) => r.counted) ?? [];

/** The character's season row in `bracket`; scenarios start from its best run per route, which alone decide the selection. */
export function planBase(input: PlanInput, bracket: string): PlanBase {
  const before = rowOf(input.runs, input.rules, input.me, bracket);
  return { rules: input.rules, me: input.me, bracket, runs: before?.routes.map((r) => r.run) ?? [], before, now: input.now };
}

/** What one more ranked run of `key`, in `durationSec` at `level`, would do to the season score. */
export function scenarioAt(base: PlanBase, key: string, durationSec: number, level: number): Scenario {
  const route = base.rules.routes.find((r) => r.dungeonKey === key)!;
  // No evidence: rateRun's route-and-levels check, which gives an evidence run of this route the same points.
  const run: ScoreRun = { runId: "scenario", instanceId: route.instanceId, routeKey: key, difficultyId: base.rules.levelBands[key]!.difficultyId, dungeonName: route.name,
    durationSec, endedAt: base.now, confirmations: 1, evidence: null, players: [{ ...base.me, level, minLevel: level, presentSec: durationSec }] };
  const after = rowOf([...base.runs, run], base.rules, base.me, base.bracket);
  const kept = new Set(countedRoutes(after).map((r) => r.key));
  return { durationSec, routePoints: rateRun(run, base.rules).score?.points ?? 0, gain: (after?.points ?? 0) - (base.before?.points ?? 0), total: after?.points ?? 0,
    pushedOut: countedRoutes(base.before).filter((r) => !kept.has(r.key)).map((r) => ({ key: r.key, points: r.points })) };
}

/** The slowest clear that adds GAIN_STEP points (or all that is left); null when nothing can be added. */
export function nextGain(base: PlanBase, key: string, targetSec: number, level: number): Scenario | null {
  const most = scenarioAt(base, key, MIN_DURATION_SEC, level).gain;
  if (most <= 0) return null;
  const need = Math.min(GAIN_STEP, most);
  // From 4 x target on, every clear scores the 50-point floor.
  const slowest = MAX_DURATION_SEC;
  const floor = scenarioAt(base, key, slowest, level);
  if (floor.gain >= need) return { ...floor, durationSec: null };
  // The gain only grows as the time drops: the last second that still earns `need`.
  let fast = MIN_DURATION_SEC;
  let slow = slowest;
  while (slow - fast > 1) {
    const mid = Math.floor((fast + slow) / 2);
    if (scenarioAt(base, key, mid, level).gain >= need) fast = mid; else slow = mid;
  }
  return scenarioAt(base, key, fast, level);
}

function levelFit(level: number | null, band: LevelBand, rules: BracketedRules): { fit: LevelFit; at: number; penaltyPercent: number } {
  if (level === null) return { fit: "unknown", at: band.max, penaltyPercent: 0 };
  if (level < band.min) return { fit: "below", at: band.min, penaltyPercent: 0 };
  const over = Math.max(0, level - band.max);
  if (over > rules.overlevelPenalty.maxLevels) return { fit: "carry", at: level, penaltyPercent: 0 };
  return { fit: "ok", at: level, penaltyPercent: over * rules.overlevelPenalty.percentPerLevel };
}

/**
 * Best next improvement for `me` in `runs` (one season, scored with `rules`). The bracket is the
 * one for the character's level, else the bracket of their newest rated run; null when neither is rated.
 */
export function planImprovements(input: PlanInput): ImprovementPlan | null {
  const { rules, me, level, now } = input;
  const id = characterId(me);
  const rows = characterScores(input.runs, rules, (player) => characterId(player) === id);
  const newest = (row: ScoreRow) => Math.max(...row.routes.map((r) => r.run.endedAt.getTime()));
  const bracket = level !== null ? bracketForLevel(rules.brackets, level) : rules.brackets.find((b) => b.key === [...rows].sort((a, b) => newest(b) - newest(a))[0]?.bracket);
  if (!bracket) return null;
  const base = planBase(input, bracket.key);
  const before = base.before;
  const counted = countedRoutes(before);
  const ordered = [...counted].sort((a, b) => b.points - a.points || a.key.localeCompare(b.key));
  const weakest = counted.length >= bracket.bestCount ? ordered[ordered.length - 1]! : null;
  const routes = rules.routes.filter((r) => rules.routeBracket[r.dungeonKey] === bracket.key).map((route): RoutePlan => {
    const key = route.dungeonKey;
    const band = rules.levelBands[key]!;
    const targetSec = routeTargetAt(rules, key, now)!;
    const own = before?.routes.find((r) => r.key === key);
    const fit = levelFit(level, band, rules);
    return { key, name: route.name, band, targetSec, best: own ? { points: own.points, durationSec: own.run.durationSec, counted: own.counted,
      evidence: own.run.evidence ? "verified" : "legacy", confirmations: own.run.confirmations } : null,
      fit: fit.fit, penaltyPercent: fit.penaltyPercent, next: fit.fit === "carry" ? null : nextGain(base, key, targetSec, fit.at) };
  }).sort((a, b) => a.band.min - b.band.min || a.band.max - b.band.max || a.name.localeCompare(b.name));
  // Easiest: the clear allowed to be slowest against its target.
  const ease = (r: RoutePlan) => r.next!.durationSec === null ? Number.MAX_VALUE : r.next!.durationSec / r.targetSec;
  const easiest = counted.length < bracket.bestCount ? null
    : routes.filter((r) => r.next && (r.fit === "ok" || r.fit === "unknown")).sort((a, b) => ease(b) - ease(a) || b.next!.gain - a.next!.gain || a.name.localeCompare(b.name))[0] ?? null;
  return { bracket: bracket.key, bestCount: bracket.bestCount, level, total: before?.points ?? 0, counted: counted.length,
    weakest: weakest ? { key: weakest.key, points: weakest.points } : null, routes, easiest };
}

export interface RoleScores { role: Role; rows: ScoreRow[] }
/** Each role's season scores from the runs `me` played in that role only; runs with no known role are only counted. */
export function roleScores(runs: ScoreRun[], rules: BracketedRules, me: ScorePlayer): { roles: RoleScores[]; unknownRuns: number } {
  const id = characterId(me);
  const roleOf = (player: ScorePlayer) => (ROLES as readonly string[]).find((role) => role === player.role?.toUpperCase()) as Role | undefined;
  const roles = ROLES.map((role) => ({ role, rows: characterScores(runs, rules, (player) => characterId(player) === id && roleOf(player) === role) }));
  const unknownRuns = runs.filter((run) => {
    const player = run.players.find((p) => characterId(p) === id);
    return player && !roleOf(player) && rateRun(run, rules, player).score;
  }).length;
  return { roles, unknownRuns };
}
