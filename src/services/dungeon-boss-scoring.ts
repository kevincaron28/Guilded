import { isBoss, routesOfInstance } from "./dungeon-bosses.js";

// Boss-skip scoring (docs/plans/BOSS_SKIP_SCORING_2026-11-14.md). Inactive unless a season's rules carry `bossScoring`.
//
// A run that kills every boss of its dungeon scores exactly as before. A run that skips bosses is rated against the same target,
// but its time points are capped at the full-clear on-target score (200) and then multiplied by the share of bosses killed (never below the shared floor of 50).
// So skipping can never beat a full clear that is within the target, and at any pace a full clear scores at least as much.

export const BOSS_SCORING_V1 = { version: 1 as const };
/** The score of a full clear exactly on target (`200 x target / time` at time = target). */
export const ON_TARGET_POINTS = 200;

export interface BossTally { killed: number; total: number }

/**
 * The bosses this run killed, from its successful native-style encounters (a boss matches by any of its ids, or by name). The final boss
 * always counts (the run was completed by it); optional bosses are neither counted nor required. A run that has encounters but none of
 * the dungeon's listed bosses is read as final-boss-only. Returns null when the bot cannot tell: no boss list for this dungeon, a list
 * with fewer than two required bosses, no encounters at all, or a Scarlet Monastery run whose wing cannot be told.
 */
export function bossTally(instanceId: number, encounters: unknown): BossTally | null {
  const routes = routesOfInstance(instanceId);
  if (!routes.length || !Array.isArray(encounters)) return null;
  const events = encounters.filter((raw): raw is { id?: unknown; name?: unknown; kind?: unknown; success?: unknown } => !!raw && typeof raw === "object");
  if (!events.length) return null;
  const kills = events.filter((e) => e.success === true && e.kind !== "npc");
  const route = routes.length === 1 ? routes[0]! : (() => {
    const wings = routes.filter((r) => r.bosses.some((boss) => boss.final && kills.some((e) => isBoss(boss, e))));
    return wings.length === 1 ? wings[0]! : null;
  })();
  if (!route) return null;
  const required = route.bosses.filter((boss) => !boss.optional);
  if (required.length < 2) return null;
  const killed = required.filter((boss) => boss.final || kills.some((e) => isBoss(boss, e))).length;
  return { killed, total: required.length };
}

/** The lowest score of a counted run (the shared floor of the rating). */
export const SCORE_FLOOR = 50;

/** Time points after the boss rule: unchanged for a full clear; otherwise capped at 200, scaled by the boss share, then raised to the shared floor of 50. */
export function bossAdjusted(timePoints: number, tally: BossTally | null | undefined): number {
  if (!tally || tally.killed >= tally.total) return timePoints;
  return Math.min(timePoints, Math.max(SCORE_FLOOR, Math.round(Math.min(timePoints, ON_TARGET_POINTS) * tally.killed / tally.total)));
}

/** The rule in plain words, for "How scores work" (public pages and the Discord guide). */
export const BOSS_RULE_TEXT = {
  en: "Bosses count: a run that kills every boss of the dungeon keeps its full time score. A run that skips bosses is rated against the same target, but its time score is capped at the on-target score (200) and multiplied by the share of bosses killed, so skipping never beats a full clear. When the bosses of a run cannot be read, the run is scored as before.",
  fr: "Les boss comptent : un essai qui tue tous les boss du donjon garde son score de temps complet. Un essai qui en saute est évalué contre la même cible, mais son score de temps est plafonné au score du rythme cible (200) puis multiplié par la part de boss tués : sauter des boss ne bat jamais un donjon complet. Quand les boss d'un essai ne peuvent pas être lus, l'essai est noté comme avant."
} as const;

/** The rule text, with the date it took effect when it was switched on in a running season. */
export function bossRuleText(lang: "en" | "fr", rule: { version?: number; since?: string | undefined } | undefined): string {
  const day = rule?.since ? rule.since.slice(0, 10) : null;
  return BOSS_RULE_TEXT[lang] + (day ? (lang === "fr" ? ` En vigueur depuis le ${day} (UTC).` : ` In force since ${day} (UTC).`) : "");
}

export function validTally(killed: unknown, total: unknown): boolean {
  return Number.isInteger(killed) && Number.isInteger(total) && (total as number) >= 2 && (total as number) <= 30 && (killed as number) >= 1 && (killed as number) <= (total as number);
}
