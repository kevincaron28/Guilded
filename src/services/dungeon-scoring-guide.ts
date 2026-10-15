import { EmbedBuilder } from "discord.js";
import type { Lang } from "../i18n.js";
import type { DungeonConfig } from "./dungeon-rules.js";

// Values come from guild configuration; this explains current imports, not archived rules.
export function dungeonScoringGuide(config: DungeonConfig, lang: Lang): EmbedBuilder {
  const fr = lang === "fr";
  const repeats = config.weeklyRepeat.map(value => `${Math.round(value * 100)}%`).join(" → ");
  return new EmbedBuilder().setColor(0x8b5cf6)
    .setTitle(fr ? "Comment les points de donjon sont calculés" : "How dungeon points are calculated")
    .setDescription(fr
      ? "Deux scores distincts : la cote de donjon par personnage et les points de participation par compte. Voici les règles actuelles du code; les archives conservent leurs anciennes règles."
      : "Two separate scores: dungeon rating per character and participation points per account. These are the current source rules; archives keep their original rules.")
    .addFields(
      { name: fr ? "Cote de donjon · modèle 3" : "Dungeon rating · model 3", value: fr
        ? "Arrondi(200 × temps cible ÷ durée), limité à 50–400 par donjon/aile admissible. Somme des meilleurs scores du personnage; les répétitions ne s’additionnent pas. Sans cible : 0 (calibration). Cibles figées pour la saison.\nCible 30 min : 40 min = 150; 30 min = 200; 20 min = 300; 15 min = 400. Améliorer 240 à 280 ajoute seulement 40 à la cote."
        : "Round(200 × target time ÷ duration), limited to 50–400 per eligible dungeon/wing. Sum of that character’s best scores; repeats do not stack. No target: 0 (calibrating). Targets are frozen for the season.\n30-minute target: 40 min = 150; 30 min = 200; 20 min = 300; 15 min = 400. Improving 240 to 280 adds only 40 to your rating." },
      { name: fr ? "Admissibilité à la cote" : "Rating eligibility", value: fr
        ? "Import valide, boss final détecté, personnage lié, présence ≥ 80 %, bonne difficulté et niveaux observés de tous les participants dans la plage autorisée (remplaçants et invités inclus). Preuves manquantes ou hors plage : non classé, 0. Aucun bonus de cote pour les morts, rôles, records ou boss. C’est un résultat d’équipe, pas une mesure du talent individuel."
        : "Valid import, detected final boss, linked character, ≥80% presence, matching difficulty and observed levels of ALL participants within the allowed band (including outsiders and replacements). Missing or out-of-band evidence: unranked, 0. Deaths, roles, records and boss kills add no rating bonuses. This is a team result, not a measure of individual skill." },
      { name: fr ? "Points de participation · valeurs configurées" : "Participation points · configured values", value: fr
        ? `Fin : ${config.completion}. Morts personnelles suivies : 0 → +${config.noDeaths}; 1 → +${config.oneDeath}; 2 → +${config.twoDeaths}; 3+ ou inconnues → +0. Première fin : +${config.firstCompletion}. Record personnel existant amélioré : +${config.personalRecord}; record de guilde existant amélioré : +${config.guildRecord}. Groupe de guilde : +${config.fullGuildGroup}. À la cible ou plus rapide : +${config.underTarget}. Les bonus admissibles s’additionnent.`
        : `Completion: ${config.completion}. Tracked personal deaths: 0 → +${config.noDeaths}; 1 → +${config.oneDeath}; 2 → +${config.twoDeaths}; 3+ or unknown → +0. First completion: +${config.firstCompletion}. Improved existing personal best: +${config.personalRecord}; improved existing guild best: +${config.guildRecord}. Guild group: +${config.fullGuildGroup}. At or below target: +${config.underTarget}. Eligible bonuses stack.` },
      { name: fr ? "Participation · limites et conditions" : "Participation · limits and conditions", value: fr
        ? `Présence ≥ 50 %. Une attribution par compte et parcours, même avec plusieurs alts. Répétitions hebdomadaires : ${repeats} (dernière valeur répétée ensuite); remise à zéro mardi à 15 h UTC. Multiplier la somme des bonus admissibles, puis arrondir une seule fois. Les ailes reconnues de Scarlet Monastery sont distinctes.\nSans admissibilité aux bonus : fin seulement. Aide hors niveau : fin seulement si un membre admissible dans la plage est présent; sinon 0. Bonus complets : boss final et preuves de niveaux/difficulté admissibles. Groupe de guilde = ≥ 5 participants enregistrés, tous de la guilde, remplaçants inclus.`
        : `≥50% presence. One award per account per run, even with multiple alts. Weekly repeats: ${repeats} (last value continues thereafter); resets Tuesday at 15:00 UTC. Multiply the sum of eligible awards, then round once. Recognized Scarlet Monastery wings are separate.\nWithout bonus eligibility: completion only. Overlevel helper: completion only when an eligible in-band guild member is present; otherwise 0. Full bonuses require detected final boss and eligible level/difficulty evidence. Guild group = ≥5 recorded participants, all in the guild, including replacements.` },
      { name: fr ? "Temps, saisons et historique" : "Timing, seasons and history", value: fr
        ? "Chronomètre automatique : premier combat observé → boss final détecté; voyage avant combat exclu. Le départ manuel existe. Aucun contrôle universel de tous les boss/trash. Les deux scores exigent le début dans la saison et la fin avant sa limite exclusive. Les points de participation s’accumulent et peuvent être ajustés par un officier. Les cibles de participation suivent celles de la saison pour le modèle 3. Les résultats historiques figés sont conservés."
        : "Automatic timer: first observed combat → detected final boss; travel before combat is excluded. Manual start exists. There is no universal all-boss/trash route check. Both scores require starting within the season and finishing before its exclusive cutoff. Participation points accumulate and officers can adjust them. Model 3 participation uses season targets. Frozen historical results are preserved." }
    );
}
