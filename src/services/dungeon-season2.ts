import { BOSS_SCORING_V1 } from "./dungeon-boss-scoring.js";
import { createBracketedDungeonRules, type BracketedRules } from "./dungeon-november-rules.js";
import type { RouteObservation } from "./dungeon-season-observations.js";
import { SEASON2_ENDGAME_ROUTES, SEASON2_WAITING, season2EndgameBrackets, season2EndgameRoutes } from "./dungeon-endgame-routes.js";

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

/** `added`: a route Season 1 never had (Season 2 endgame, dungeon-endgame-routes.ts): provisional, no data, starts from its design target. */
export interface Season2Row extends TargetProposal { key: string; name: string; bracket: string; previousSec: number; added?: true }
export interface Season2Proposal { rules: BracketedRules; rows: Season2Row[]; counts: Record<TargetBasis, number>; added: number; waiting: readonly { id: string; reason: string }[] }

/**
 * Season 2 rules: Season 1's routes, level bands, brackets and over-level penalty unchanged, targets from
 * `proposeTarget`, and the stricter `current-v2` evidence policy. Measured and blended routes are recorded as
 * recalibrations from the season start, so only carried routes stay flagged "provisional".
 * Throws when the result is not a valid rule set.
 */
export type Season2Policy = "current-v1" | "current-v2";
/** Scoring model 2 defaults (docs/plans/DUNGEON_SCORING_V2.md): 5% of the time per level of difference, parties of 3 or more. */
export const SCORING_V2 = { version: 2 as const, timePerLevel: 0.05, minParty: 3 };
export function season2Proposal(base: BracketedRules, observations: RouteObservation[], startsAt: Date, policy: Season2Policy = "current-v2", scoring: BracketedRules["scoring"] = undefined, bossScoring: BracketedRules["bossScoring"] | null = BOSS_SCORING_V1): Season2Proposal {
  const byKey = new Map(observations.map(o => [o.key, o]));
  // Every Season 2 endgame route (levels 45-60, plus Drowned City) the base rules lack joins with zero observations: a current-v2
  // season cannot gain routes later. Their brackets join too, with best-N capped by the routes that exist.
  const known = new Set(base.routes.map(r => r.dungeonKey));
  const extra = season2EndgameRoutes().filter(r => !known.has(r.dungeonKey));
  const brackets = [...base.brackets, ...season2EndgameBrackets(extra).filter(b => !base.brackets.some(x => x.key === b.key))];
  const rows: Season2Row[] = [...base.routes, ...extra].filter(r => r.targetSec !== null).map(route => {
    const isNew = !known.has(route.dungeonKey);
    const previousSec = base.targets[route.dungeonKey] ?? route.targetSec!;
    const band = route.competitionBand!;
    const bracket = base.routeBracket[route.dungeonKey] ?? brackets.find(b => b.min <= band.min && band.max <= b.max)?.key ?? "";
    return { key: route.dungeonKey, name: route.name, bracket, previousSec,
      ...(isNew ? { targetSec: previousSec, basis: "carried" as const, samples: 0, note: "new route: no Season 1 data, provisional design target", added: true as const }
        : proposeTarget(previousSec, byKey.get(route.dungeonKey))) };
  });
  const planIds = new Set(SEASON2_ENDGAME_ROUTES.map(r => r.planId));
  const waiting = [...(base.provisional?.waiting ?? []).filter(w => !planIds.has(w.id) && !SEASON2_WAITING.some(x => x.id === w.id)), ...SEASON2_WAITING];
  const target = new Map(rows.map(r => [r.key, r.targetSec]));
  const changed = rows.filter(r => r.basis !== "carried");
  const rules = createBracketedDungeonRules({
    ...(base.gameEdition ? { gameEdition: base.gameEdition } : {}),
    // The route's own starting target is the Season 2 one; Season 1's recalibrations never carry over.
    routes: [...base.routes, ...extra].map(r => r.targetSec === null ? r : { ...r, targetSec: target.get(r.dungeonKey)! }),
    brackets, overlevelPenalty: base.overlevelPenalty, evidencePolicy: policy, ...(scoring ? { scoring } : {}), ...(bossScoring ? { bossScoring } : {}),
    provisional: { plan: "season-2-from-season-1", waiting },
    ...(changed.length ? { recalibrations: changed.map(r => ({ dungeonKey: r.key, targetSec: r.targetSec, from: startsAt.toISOString(), runs: Math.max(1, r.samples) })) } : {})
  });
  return { rules, rows, added: rows.filter(r => r.added).length, waiting, counts: { measured: rows.filter(r => r.basis === "measured").length, blended: rows.filter(r => r.basis === "blended").length,
    carried: rows.filter(r => r.basis === "carried").length } };
}
