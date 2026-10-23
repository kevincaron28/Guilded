import { penalized, timeRating, type DungeonRatingDetail, type RatingRow } from "./dungeon-rating.js";
import { routeTargetAt, type BracketedRules } from "./dungeon-november-rules.js";
import { MIN_DURATION_SEC, MAX_DURATION_SEC } from "./dungeon-rules.js";

/** Scenarios from immutable earned points, including scores earned before recalibration. */
export function snapshotGuidance(row: Pick<RatingRow, "points" | "details" | "bracket" | "level">, rules: BracketedRules, now: Date) {
  const bracket = rules.brackets.find(b => b.key === row.bracket);
  if (!bracket || !row.details || row.level === undefined) return null;
  const select = (details: Pick<DungeonRatingDetail, "dungeonKey" | "points">[]) => [...details].filter(d => d.points > 0)
    .sort((a, b) => b.points - a.points || (a.dungeonKey! < b.dungeonKey! ? -1 : a.dungeonKey! > b.dungeonKey! ? 1 : 0)).slice(0, bracket.bestCount);
  const before = select(row.details);
  if (before.reduce((total, d) => total + d.points, 0) !== row.points) return null;
  const routes = rules.routes.filter(r => rules.routeBracket[r.dungeonKey] === row.bracket).map(route => {
    const key = route.dungeonKey;
    const band = rules.levelBands[key]!;
    const fit = row.level! < band.min ? "below" : row.level! > band.max + rules.overlevelPenalty.maxLevels ? "carry" : "ok";
    const penalty = Math.max(0, row.level! - band.max) * rules.overlevelPenalty.percentPerLevel;
    const targetSec = routeTargetAt(rules, key, now)!;
    const current = row.details!.find(d => d.dungeonKey === key);
    const at = (seconds: number) => {
      const points = penalized(timeRating(seconds, targetSec), penalty);
      const after = select([...row.details!.filter(d => d.dungeonKey !== key), { dungeonKey: key, points: Math.max(current?.points ?? 0, points) }]);
      const total = after.reduce((sum, d) => sum + d.points, 0);
      return { durationSec: seconds as number | null, routePoints: points, gain: total - row.points, total,
        pushedOut: before.filter(d => !after.some(a => a.dungeonKey === d.dungeonKey)).map(d => rules.routes.find(r => r.dungeonKey === d.dungeonKey)?.name ?? d.dungeonKey!) };
    };
    let next: ReturnType<typeof at> | null = null;
    const most = at(MIN_DURATION_SEC).gain;
    if (fit !== "carry" && most > 0) {
      const need = Math.min(5, most);
      if (at(MAX_DURATION_SEC).gain >= need) next = { ...at(MAX_DURATION_SEC), durationSec: null };
      else {
        let fast = MIN_DURATION_SEC, slow = MAX_DURATION_SEC;
        while (slow - fast > 1) { const mid = Math.floor((fast + slow) / 2); if (at(mid).gain >= need) fast = mid; else slow = mid; }
        next = at(fast);
      }
    }
    return { key, name: route.name, targetSec, bestPoints: current?.points ?? 0, counted: before.some(d => d.dungeonKey === key), fit, penaltyPercent: penalty, next };
  });
  return { level: row.level, bracket: bracket.key, bestCount: bracket.bestCount, routes };
}
