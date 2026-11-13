// The duel scoring rules, in ONE place. duels.ts (the points and the caps), the Discord board footers and the public
// duel page's "how scoring works" box all read these values, so a rule change shows up everywhere at once. The
// in-game addon keeps its own copy (addon/Guilded/Modules/Duels.lua) that must be changed in step.
// See docs/DUEL_SCORING_RESEARCH.md for the weaknesses of these rules and the proposed replacements.

export const DUEL_RULES = {
  /** Identifies the rule set; a replacement ruleset gets a new id and a start date. */
  id: "points-v1",
  /** The day these rules started to apply (the first duels were recorded in 8.4.5). */
  since: "2026-10-29",
  basePoints: 10,
  pointsPerLevel: 2,
  maxPoints: 20,
  pairDailyCap: 5,
  reporterDailyCap: 25,
  dedupeSeconds: 120
} as const;

/** The rules as short sentences for a page or card. Same numbers as `duelPoints`. */
export function duelRuleLines(lang: "en" | "fr"): string[] {
  const r = DUEL_RULES;
  return lang === "fr" ? [
    `Une victoire vaut ${r.basePoints} points, +${r.pointsPerLevel} par niveau de l'adversaire au-dessus du gagnant, -${r.pointsPerLevel} par niveau en dessous (de 0 à ${r.maxPoints}). Niveau inconnu : ${r.basePoints}.`,
    "Une défaite ne retire aucun point, mais compte dans les victoires-défaites, le taux de victoire et la série.",
    `${r.pairDailyCap} duels par paire de joueurs et par jour (UTC) au maximum comptent; ${r.reporterDailyCap} par joueur rapporteur et par jour.`,
    "Les deux joueurs rapportent le même duel : il n'est compté qu'une fois. Seuls les duels entre membres de la même guilde comptent. Aucune récompense."
  ] : [
    `A win is worth ${r.basePoints} points, +${r.pointsPerLevel} per level the opponent was above the winner, -${r.pointsPerLevel} per level below (0 to ${r.maxPoints}). Unknown level: ${r.basePoints}.`,
    "A loss takes no points away, but counts in wins-losses, win rate and streak.",
    `At most ${r.pairDailyCap} duels per pair of players per day (UTC) count; ${r.reporterDailyCap} per reporting player per day.`,
    "Both players report the same duel: it counts once. Only duels between members of the same guild count. No rewards."
  ];
}
