import { rankChallenges, type ChallengeRun, type ChallengeRank } from "./challenge-leaderboard.js";
import type { ChallengeEvidence } from "./challenge-evidence.js";
import type { ChallengeRatingRules } from "./challenge-rating-rules.js";

// Version 1 is immutable. Inspired by Raider.IO's documented base values and
// best-per-dungeon sum. The bounded speed bonus is Guilded's own provisional rule,
// NOT Blizzard/Raider.IO's exact rating formula. Overtime never scores in v1.
// https://support.raider.io/kb/frequently-asked-questions/what-is-the-base-score-value-for-each-level-keystone
const BASE = [155,170,200,215,230,260,275,290,320,335,365];
export function challengePolicyText(model: ChallengeRatingRules["model"], lang: "en" | "fr"): string {
  if (model === "guilded-keystone-v2") return lang === "fr"
    ? "Règles v2 : les clés à temps peuvent recevoir un bonus de vitesse. Les clés admissibles hors délai conservent de 100 à 50 % des points de base jusqu’à 40 % de dépassement, sans bonus. Chaque donjon compte une fois, tous affixes confondus. Formule provisoire propre à Guilded."
    : "Rules v2: in-time keys can earn a speed bonus. Eligible overtime keys retain 100–50% of base points up to 40% overtime, without a bonus. Each dungeon counts once across affixes. Guilded’s own provisional formula.";
  return lang === "fr" ? "Règles v1 figées : seules les clés à temps comptent. Chaque donjon compte une fois, tous affixes confondus."
    : "Frozen v1 rules: only in-time keys count. Each dungeon counts once across affixes.";
}
export function keystonePoints(c: ChallengeEvidence, model: ChallengeRatingRules["model"] = "guilded-keystone-v1"): number | null {
  const ratio = c.durationMs / (c.timeLimitSec * 1000);
  if (c.level < 2 || c.level > 30 || c.practiceRun || !c.eligibleForScore || !Number.isFinite(ratio) || ratio <= 0
    || c.onTime !== (ratio <= 1) || ratio > (model === "guilded-keystone-v2" ? 1.4 : 1)) return null;
  const base = c.level <= 12 ? BASE[c.level - 2]! : 365 + (c.level - 12) * 15;
  // Guilded's v2 policy: eligible completed overtime keys retain 50–100% of
  // base credit up to 40% overtime. No speed bonus; never Blizzard's formula.
  if (ratio > 1) return Math.round(base * (1 - (ratio - 1) / 0.4 * 0.5) * 10) / 10;
  const bonus = 25 * Math.min(1, Math.max(0, (1 - c.durationMs / (c.timeLimitSec * 1000)) / 0.4));
  return Math.round((base + bonus) * 10) / 10;
}
export interface ChallengeScore<T extends ChallengeRun> {
  character: string; realm: string; points: number; completed: number;
  best: (ChallengeRank<T> & { points: number })[];
}
/** Best score per dungeon across affixes; never sum repeated runs, roles or affix weeks. */
export function challengeScores<T extends ChallengeRun>(runs: T[], rules: ChallengeRatingRules | undefined,
  keep: (player: T["players"][number], run: T) => boolean = () => true): ChallengeScore<T>[] {
  if (!rules) return [];
  const characters = new Map<string, Map<number, ChallengeRank<T> & { points: number }>>();
  for (const run of runs) for (const row of rankChallenges([run], keep, rules.model === "guilded-keystone-v2")) {
    const c = row.challenge;
    const dungeon = rules.dungeons.find(d => d.mapId === c.mapId && d.instanceId === run.instanceId && d.timeLimitSec === c.timeLimitSec);
    const points = keystonePoints(c, rules.model);
    if (!dungeon || points === null) continue;
    const key = JSON.stringify([row.player.character.toLowerCase(), row.player.realm.toLowerCase()]);
    const best = characters.get(key) ?? new Map<number, ChallengeRank<T> & { points: number }>();
    const old = best.get(c.mapId);
    if (!old || points > old.points || points === old.points && (run.endedAt < old.run.endedAt
      || run.endedAt.getTime() === old.run.endedAt.getTime() && run.runId < old.run.runId)) best.set(c.mapId, {...row, points});
    characters.set(key, best);
  }
  return [...characters.values()].map(best => {
    const rows = [...best.values()].sort((a,b) => a.challenge.mapId - b.challenge.mapId);
    return { character: rows[0]!.player.character, realm: rows[0]!.player.realm,
      points: Math.round(rows.reduce((sum,row) => sum + row.points,0)*10)/10, completed: rows.length, best: rows };
  }).sort((a,b) => b.points-a.points || b.completed-a.completed || a.character.localeCompare(b.character) || a.realm.localeCompare(b.realm));
}
