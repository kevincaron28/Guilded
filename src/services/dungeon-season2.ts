import { createBracketedDungeonRules, type BracketedRules } from "./dungeon-november-rules.js";
import type { RouteObservation } from "./dungeon-season-observations.js";

// Season 2 proposal (owner request, 6 November 2026). Season 1 keeps its frozen current-v1 rules;
// this module only PROPOSES the next season from what Season 1 observed. Nothing is scheduled or
// activated until the owner runs `/guilded-season season2-activate`. Formula and owner steps:
// docs/DUNGEON_SEASON_2_PLAN.md.

/** Forever's first raids open on 9 December 2026; 15:00 Pacific is the same 23:00 UTC as Season 1. */
export const SEASON2_DATE = { date: "2026-12-09", hour: 15, timeZone: "America/Los_Angeles" } as const;
export const SEASON2_NAME = "Season 2";

export const TARGET_POLICY = {
  /** Independent crew/day samples needed before a new target is blended in at all. */
  minBlendSamples: 8,
  /** Prior weight, in samples, of the Season 1 estimate when blending (a target seen 12 times counts as much as the estimate). */
  priorWeight: 12,
  /** A new target stays within this multiple of the Season 1 one (a thin or farmed sample cannot move it further). */
  floor: 0.5, ceiling: 2,
  roundSec: 60, minSec: 300, maxSec: 7200
} as const;

export type TargetBasis = "measured" | "blended" | "carried";
export interface TargetProposal { targetSec: number; basis: TargetBasis; samples: number; note: string }

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/**
 * One route's Season 2 target (the time that earns 200 points).
 * - measured: the crew/day median of Season 1 once the review policy is met (20 samples, 5 crews, 3 days),
 * - blended: with 8-19 samples, the median weighted by sample count against the Season 1 estimate (12 samples' worth),
 * - carried: fewer samples; the Season 1 target stays, still marked as an estimate.
 * Always within 0.5x-2x of the Season 1 target and rounded to a whole minute.
 */
export function proposeTarget(priorSec: number, obs: Pick<RouteObservation, "samples" | "independentMedian" | "ready"> | undefined): TargetProposal {
  const samples = obs?.samples ?? 0;
  const median = obs?.independentMedian ?? null;
  if (median === null || samples < TARGET_POLICY.minBlendSamples) {
    return { targetSec: priorSec, basis: "carried", samples, note: `only ${samples} independent sample(s); Season 1 estimate kept` };
  }
  const raw = obs!.ready ? median : (samples * median + TARGET_POLICY.priorWeight * priorSec) / (samples + TARGET_POLICY.priorWeight);
  const bounded = clamp(raw, priorSec * TARGET_POLICY.floor, priorSec * TARGET_POLICY.ceiling);
  const targetSec = clamp(Math.round(bounded / TARGET_POLICY.roundSec) * TARGET_POLICY.roundSec, TARGET_POLICY.minSec, TARGET_POLICY.maxSec);
  return { targetSec, basis: obs!.ready ? "measured" : "blended", samples,
    note: obs!.ready ? "crew/day median" : `median blended with the Season 1 estimate (${samples} samples)` };
}

export interface Season2Row extends TargetProposal { key: string; name: string; bracket: string; previousSec: number }
export interface Season2Proposal { rules: BracketedRules; rows: Season2Row[]; counts: Record<TargetBasis, number> }

/**
 * Season 2 rules: Season 1's routes, level bands, brackets and over-level penalty unchanged, targets from
 * `proposeTarget`, and the stricter `current-v2` evidence policy. Measured and blended routes are recorded as
 * recalibrations from the season start, so only carried routes stay flagged "provisional".
 * Throws when the result is not a valid rule set.
 */
export type Season2Policy = "current-v1" | "current-v2";
export function season2Proposal(base: BracketedRules, observations: RouteObservation[], startsAt: Date, policy: Season2Policy = "current-v2"): Season2Proposal {
  const byKey = new Map(observations.map(o => [o.key, o]));
  const rows: Season2Row[] = base.routes.filter(r => r.targetSec !== null).map(route => {
    const previousSec = base.targets[route.dungeonKey] ?? route.targetSec!;
    return { key: route.dungeonKey, name: route.name, bracket: base.routeBracket[route.dungeonKey] ?? "", previousSec,
      ...proposeTarget(previousSec, byKey.get(route.dungeonKey)) };
  });
  const target = new Map(rows.map(r => [r.key, r.targetSec]));
  const changed = rows.filter(r => r.basis !== "carried");
  const rules = createBracketedDungeonRules({
    ...(base.gameEdition ? { gameEdition: base.gameEdition } : {}),
    // The route's own starting target is the Season 2 one; Season 1's recalibrations never carry over.
    routes: base.routes.map(r => r.targetSec === null ? r : { ...r, targetSec: target.get(r.dungeonKey)! }),
    brackets: base.brackets, overlevelPenalty: base.overlevelPenalty, evidencePolicy: policy,
    provisional: { plan: "season-2-from-season-1", waiting: base.provisional?.waiting ?? [] },
    ...(changed.length ? { recalibrations: changed.map(r => ({ dungeonKey: r.key, targetSec: r.targetSec, from: startsAt.toISOString(), runs: Math.max(1, r.samples) })) } : {})
  });
  return { rules, rows, counts: { measured: rows.filter(r => r.basis === "measured").length, blended: rows.filter(r => r.basis === "blended").length,
    carried: rows.filter(r => r.basis === "carried").length } };
}
