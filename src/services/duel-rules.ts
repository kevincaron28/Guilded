import { RATING } from "./duel-rating.js";

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
    "Seuls les duels entre membres de la même guilde comptent. Aucune récompense."
  ] : [
    `A win is worth ${r.basePoints} points, +${r.pointsPerLevel} per level the opponent was above the winner, -${r.pointsPerLevel} per level below (0 to ${r.maxPoints}). Unknown level: ${r.basePoints}.`,
    "A loss takes no points away, but counts in wins-losses, win rate and streak.",
    "Only duels between members of the same guild count. No rewards."
  ];
}

// ----- rating-v1 (from 13 November 2026; see duel-rating.ts and docs/DUEL_SCORING_RESEARCH.md) -----

/**
 * False until the addon release that shows the rating in game ships. While false, a board that scores by rating says that the
 * game still shows the old score. Flip it in the same release that updates the addon (docs/DUEL_RATING_ADDON_SPEC.md).
 */
export const ADDON_SHOWS_RATING = false;

/**
 * Duels that ended before this instant (13 November 2026 00:00 UTC) were test data: they are stored with `archived = true` and appear in no
 * ladder, card, count or page. Nothing is deleted. Undo: `UPDATE "DuelResult" SET "archived" = false WHERE "endedAt" < '2026-11-13T00:00:00Z'`.
 */
export const DUEL_ARCHIVE_BEFORE = new Date("2026-11-13T00:00:00.000Z");

const dayText = (iso: string, lang: "en" | "fr") => new Date(iso).toLocaleDateString(lang === "fr" ? "fr-CA" : "en-CA", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/** What the member-facing "how scoring works" says for the rating. Every number comes from `RATING` and `DUEL_RULES`. */
export function ratingRuleLines(lang: "en" | "fr", startsAt: Date = new Date(RATING.startsAt)): string[] {
  const r = { ...RATING, startsAt: startsAt.toISOString() };
  const [k1, k2, k3] = r.kBands.map(band => band.k);
  return lang === "fr" ? [
    `Depuis le ${dayText(r.startsAt, "fr")} (UTC), les duels sont classés par cote. La première saison dure jusqu'au 31 décembre 2026, puis chaque saison est un mois civil (UTC). Tout le monde commence à ${r.start} à chaque saison.`,
    `Battre un joueur plus fort fait gagner plus; perdre contre un joueur plus faible fait perdre plus. Chaque niveau d'écart ajoute ${r.handicapPerLevel} points de cote à l'adversaire de plus haut niveau (jusqu'à ${r.handicapMaxLevels} niveaux). Un duel entre joueurs séparés de plus de ${r.maxLevelGap} niveaux ne change rien.`,
    `Le changement est plus grand au début : facteur ${k1} pour les 10 premiers duels, ${k2} jusqu'à 30, puis ${k3}.`,
    `Le score affiché rapproche la cote de ${r.start} tant que le dossier est court : ${r.start} + (cote − ${r.start}) × duels / (duels + ${r.shrinkGames}).`,
    "Chaque duelliste est classé dès son premier duel compté.",
    `Les duels comptés sont réévalués dans l'ordre des dates : Aucune récompense.`
  ] : [
    `From ${dayText(r.startsAt, "en")} (UTC), duels are ranked by a rating. The first season runs to December 31, 2026, then each season is a calendar month (UTC). Everyone starts at ${r.start} each season.`,
    `Beating a stronger player earns more; losing to a weaker one costs more. Each level of difference adds ${r.handicapPerLevel} rating points to the higher-level player's side (up to ${r.handicapMaxLevels} levels). A duel between players more than ${r.maxLevelGap} levels apart changes nothing.`,
    `Moves are bigger early on: factor ${k1} for the first 10 duels, ${k2} up to 30, then ${k3}.`,
    `The score shown pulls the rating toward ${r.start} while a record is short: ${r.start} + (rating − ${r.start}) × duels / (duels + ${r.shrinkGames}).`,
    "Every duelist is ranked from their first counted duel.",
    `Counted duels are re-rated in date order: No rewards.`
  ];
}

/** One line for a footer: the rules that apply and since when. */
export function ratingFooter(lang: "en" | "fr", seasonLabel: string, startsAt: Date = new Date(RATING.startsAt), addonUpdated = ADDON_SHOWS_RATING): string {
  const r = { ...RATING, startsAt: startsAt.toISOString() };
  return lang === "fr"
    ? `Cote ${r.start} au départ · saison ${seasonLabel} (depuis le ${dayText(r.startsAt, "fr")}) · aucune récompense${addonUpdated ? "" : " · le classement dans le jeu affiche l'ancien score jusqu'à la prochaine mise à jour de l'addon"}`
    : `Rating starts at ${r.start} · season ${seasonLabel} (since ${dayText(r.startsAt, "en")}) · no rewards${addonUpdated ? "" : " · the in-game ladder shows the old score until the next addon update"}`;
}
