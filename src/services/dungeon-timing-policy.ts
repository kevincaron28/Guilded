import { createHash } from "node:crypto";
import type { GameEdition } from "./game-edition.js";
import { createBracketedDungeonRules, validBracketedRules, type BracketedRules } from "./dungeon-november-rules.js";

export interface TimingReview {
  id: string; reviewedAt: string; edition: GameEdition;
  routes: {
    key: string; difficultyId: number; minLevel: number; maxLevel: number;
    previousTargetSec: number; targetSec: number;
    basis: "guide-estimate" | "native-timer" | "measured";
    clock: string; note: string; sources: string[];
    rangeSec?: { min: number; max: number };
  }[];
}

/** Builds a NEW snapshot only. Never used as a fallback for historical periods or
 * to recalculate stored runs. Installation uses configureNextSeasonRules's lock. */
export function reviewedTimingRules(base: BracketedRules, review: TimingReview) {
  if (!validBracketedRules(base)) throw new Error("A valid baseline snapshot is required");
  if ((base.gameEdition ?? "forever") !== review.edition) throw new Error("Timing review edition mismatch");
  if (new Set(review.routes.map(r => r.key)).size !== review.routes.length) throw new Error("Duplicate timing review route");
  const source = structuredClone(base);
  const updates = new Map(review.routes.map(r => [r.key, r]));
  for (const update of review.routes) {
    const route = source.routes.find(r => r.dungeonKey === update.key);
    if (!route?.competitionBand || route.targetSec !== update.previousTargetSec
      || route.competitionBand.difficultyId !== update.difficultyId
      || route.competitionBand.min !== update.minLevel || route.competitionBand.max !== update.maxLevel) {
      throw new Error(`Timing review no longer matches route/difficulty/levels: ${update.key}`);
    }
    if (!update.sources.length || update.sources.some(url => !url.startsWith("https://"))) throw new Error("Reviewed timings require HTTPS sources");
    if (update.rangeSec && (update.targetSec < update.rangeSec.min || update.targetSec > update.rangeSec.max)) throw new Error("Target is outside its reviewed range");
  }
  const routes = source.routes.map(route => {
    const update = updates.get(route.dungeonKey);
    return { ...route, ...(update ? { targetSec: update.targetSec } : {}), timing: {
      reviewId: review.id, reviewedAt: review.reviewedAt,
      basis: update?.basis ?? "legacy-design-unverified" as const,
      clock: update?.clock ?? "First recorded combat to the frozen route endpoint",
      note: update?.note ?? "Existing provisional design target retained. No compatible measured or guide timing was established in this review; this is not a calibrated benchmark.",
      sources: update?.sources ?? [], ...(update?.rangeSec ? { rangeSec: update.rangeSec } : {})
    } };
  });
  // Recalibrations belong to their original season; reject them rather than
  // silently carrying historical target overrides into an upcoming season.
  if (source.recalibrations?.length) throw new Error("Use an uncalibrated planning baseline for the upcoming season");
  const rules = createBracketedDungeonRules({ ...source, gameEdition: review.edition, routes,
    provisional: { plan: review.id, waiting: source.provisional?.waiting ?? [] } });
  return { rules, sha256: createHash("sha256").update(JSON.stringify(rules)).digest("hex"),
    changedRoutes: routes.filter(r => { const update = updates.get(r.dungeonKey); return update && update.targetSec !== update.previousTargetSec; }).map(r => r.dungeonKey),
    unverifiedRoutes: routes.filter(r => r.timing.basis === "legacy-design-unverified").map(r => r.dungeonKey) };
}
