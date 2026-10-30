import { provisionalSeasonRules } from "./dungeon-bracket-season.js";
import { editionDungeonRules } from "./dungeon-edition-catalog.js";
import type { GameEdition } from "./game-edition.js";
import { reviewedTimingRules, type TimingReview } from "./dungeon-timing-policy.js";

export const LAUNCH_TIMING_REVIEW = "launch-timings-2026-10-30-v1";
const reviewedAt = "2026-10-30T11:10:42.000Z";
// Explicit old targets/bands prevent a later baseline change silently inheriting
// this review. These are design choices within authored guide ranges, not samples.
const forever: TimingReview["routes"] = [
  ["36", 17, 26, 40, 30, 20, 30, "the-deadmines"],
  ["33", 20, 29, 30, 30, 20, 30, "shadowfang-keep"],
  ["34", 24, 29, 20, 20, 15, 25, "the-stockade"],
  ["43", 15, 24, 40, 40, 30, 40, "wailing-caverns"],
  ["48", 24, 29, 40, 35, 25, 35, "blackfathom-deeps"],
  ["2998", 26, 29, 35, 35, 20, 35, "excavation-site-wetlands"],
  ["2959", 30, 36, 45, 40, 30, 40, "city-of-dalaran"]
].map(([key, min, max, old, target, low, high, slug]) => ({
  key: String(key), difficultyId: 0, minLevel: Number(min), maxLevel: Number(max),
  previousTargetSec: Number(old) * 60, targetSec: Number(target) * 60,
  basis: "guide-estimate", clock: "First recorded combat to the frozen route endpoint; guide full-run clock is not controlled",
  note: "Provisional Guilded design target informed by Method/Jurdi's authored full-run range. Not measured calibration. Party, gear and clock differ; optional bosses receive no invented time deduction. Forever gameplay acceptance pending.",
  sources: [`https://www.method.gg/wow-forever/dungeons/${slug}`],
  rangeSec: { min: Number(low) * 60, max: Number(high) * 60 }
}));

/** Explicit prospective export/install only. Do not use for historical fallback. */
export function launchTimingRules(edition: GameEdition) {
  const base = edition === "forever" ? provisionalSeasonRules().rules : editionDungeonRules(edition);
  return reviewedTimingRules(base, { id: LAUNCH_TIMING_REVIEW, reviewedAt, edition,
    routes: edition === "forever" ? forever : [] });
}
