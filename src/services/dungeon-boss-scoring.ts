import { routeBosses } from "./dungeon-bosses.js";

// Boss-skip scoring (docs/plans/BOSS_SKIP_SCORING_2026-11-14.md). Inactive unless a season's rules carry `bossScoring`.
//
// A run that kills every boss of its dungeon scores exactly as before. A run that skips bosses is rated against the same target,
// but its time points are capped at the full-clear on-target score (200) and then multiplied by the share of bosses killed.
// So skipping can never beat a full clear that is within the target, and at any pace a full clear scores at least as much.

export const BOSS_SCORING_V1 = { version: 1 as const };
/** The score of a full clear exactly on target (`200 x target / time` at time = target). */
export const ON_TARGET_POINTS = 200;

export interface BossTally { killed: number; total: number }

/**
 * The bosses this run killed, from its successful native-style encounters. The final boss always counts (the run was completed by
 * it). Returns null when the bot cannot tell: no boss list for this dungeon, or none of its listed bosses appears in the run's
 * encounters (the run has no usable boss evidence), so nothing is adjusted and nothing is shown.
 */
export function bossTally(instanceId: number, encounters: unknown): BossTally | null {
  const route = routeBosses(instanceId);
  if (!route || !Array.isArray(encounters)) return null;
  const seen = new Set<number>();
  for (const raw of encounters) {
    const e = raw as { id?: unknown; kind?: unknown; success?: unknown } | null;
    if (e && e.success === true && e.kind !== "npc" && typeof e.id === "number") seen.add(e.id);
  }
  if (!route.bosses.some((boss) => seen.has(boss.id))) return null;
  const killed = route.bosses.filter((boss) => boss.final || seen.has(boss.id)).length;
  return { killed, total: route.bosses.length };
}

/** Time points after the boss rule: unchanged for a full clear, capped at 200 and scaled by the boss share otherwise. */
export function bossAdjusted(timePoints: number, tally: BossTally | null | undefined): number {
  if (!tally || tally.killed >= tally.total) return timePoints;
  return Math.round(Math.min(timePoints, ON_TARGET_POINTS) * tally.killed / tally.total);
}

/** The rule in plain words, for "How scores work" (public pages and the Discord guide). */
export const BOSS_RULE_TEXT = {
  en: "Bosses count: a run that kills every boss of the dungeon keeps its full time score. A run that skips bosses is rated against the same target, but its time score is capped at the on-target score (200) and multiplied by the share of bosses killed, so skipping never beats a full clear. When the bosses of a run cannot be read, the run is scored as before.",
  fr: "Les boss comptent : un essai qui tue tous les boss du donjon garde son score de temps complet. Un essai qui en saute est évalué contre la même cible, mais son score de temps est plafonné au score du rythme cible (200) puis multiplié par la part de boss tués : sauter des boss ne bat jamais un donjon complet. Quand les boss d'un essai ne peuvent pas être lus, l'essai est noté comme avant."
} as const;

export function validTally(killed: unknown, total: unknown): boolean {
  return Number.isInteger(killed) && Number.isInteger(total) && (total as number) >= 2 && (total as number) <= 30 && (killed as number) >= 1 && (killed as number) <= (total as number);
}
