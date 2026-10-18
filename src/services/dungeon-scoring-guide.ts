import { EmbedBuilder } from "discord.js";
import type { Lang } from "../i18n.js";
import type { DungeonConfig } from "./dungeon-rules.js";
import { hasDungeonRating, seasonDungeonCatalog } from "./dungeon-rating.js";
import { BETA_DUNGEONS } from "./dungeon-beta-preset.js";
import { validBracketedRules, validNovemberRules, type BracketedRules } from "./dungeon-november-rules.js";

// Values come from guild configuration; this explains current imports, not archived rules.
export function dungeonScoringGuide(config: DungeonConfig, lang: Lang, rules?: unknown): EmbedBuilder {
  const fr = lang === "fr";
  if (validNovemberRules(rules)) return novemberGuide(fr);
  if (validBracketedRules(rules)) return bracketGuide(rules, fr);
  if (hasDungeonRating(rules) && (rules as { version: number }).version === 4) return bestEightGuide(rules, fr);
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

function novemberGuide(fr: boolean): EmbedBuilder {
  return new EmbedBuilder().setColor(0x8b5cf6)
    .setTitle(fr ? "Niveau 60 · comment les points fonctionnent" : "Level 60 · how points work")
    .setDescription(fr ? "Cote par personnage; participation par compte. Les archives bêta gardent leurs résultats. Un résultat d’équipe ne mesure pas à lui seul le talent individuel."
      : "Rating belongs to each character; participation belongs to the account. Beta archives keep their results. A team result alone does not measure individual skill.")
    .addFields(
      { name: fr ? "Cote · 8 meilleurs parcours" : "Rating · best 8 routes", value: fr
        ? "Arrondi(200 × cible ÷ durée), limité à 50–400. Seuls vos 8 meilleurs donjons/ailes distincts comptent : 1 600 à la cible; maximum 3 200. Répéter n’accumule pas de cote. Un nouveau score de 240 remplaçant le 8e à 180 ajoute 60. Chaque alt commence sa propre cote. Arriver plus tard ne fait perdre aucun parcours de bas niveau obligatoire."
        : "Round(200 × target ÷ duration), clamped to 50–400. Only your best 8 distinct dungeons/wings count: 1,600 at target; maximum 3,200. Repeats do not accumulate rating. A new 240 replacing your 8th score of 180 adds 60. Each alt starts its own rating. Late starters have no required low-level scoring routes to miss." },
      { name: fr ? "Admissibilité et preuves" : "Eligibility and evidence", value: fr
        ? "Tous les participants observés, invités et remplaçants inclus, doivent rester niveau 60. Personnage lié, présence ≥ 80 %, difficulté configurée, import valide, boss final détecté et tous les boss requis par le parcours figé. Preuves réussies horodatées dans le run seulement. Aile ambiguë ou preuve manquante : 0 cote. Parcours de participation seulement : 0 cote."
        : "ALL observed participants, including guests and replacements, must remain level 60. Linked character, ≥80% presence, configured difficulty, valid import, detected final boss and every encounter required by the frozen route. Only timestamped successful evidence inside the run counts. Ambiguous wings or missing evidence: 0 rating. Participation-only routes: 0 rating." },
      { name: fr ? "Participation · variété et entraide" : "Participation · variety and helping", value: fr
        ? "Par compte et parcours chaque semaine : 75 pour la première fin admissible, 25 pour la deuxième, puis 0. Sans admissibilité aux bonus : 50 / 25 / 0. Présence ≥ 50 %, boss final et preuves de parcours requis. Les bandes de participation sont figées séparément. Helper hors niveau : 50 / 25 / 0 si un membre dans la plage est présent ≥ 50 %, sinon 0. Aucun bonus de vitesse, mort ou record."
        : "Per account and route each week: 75 for the first eligible completion, 25 for the second, then 0. Without bonus eligibility: 50 / 25 / 0. ≥50% presence, detected final boss and route evidence required. Participation bands are frozen separately. Overlevel helper: 50 / 25 / 0 with an in-band member present ≥50%; otherwise 0. No speed, death or record bonuses." },
      { name: fr ? "Limites et chronométrage" : "Limits and timing", value: fr
        ? "Alts et difficultés partagent le compteur; les ailes vérifiées sont distinctes. Remise à zéro mardi 15 h UTC. Une attribution par compte/run; simulations et fins manuelles : 0. Premier combat observé → boss final; aucun contrôle du trash, du départ manuel ou de la puissance du groupe. Début dans la saison et fin avant la limite exclusive. Cibles et preuves figées; aucune réécriture des anciennes saisons."
        : "Alts and difficulties share the counter; verified wings are separate. Resets Tuesday 15:00 UTC. One award per account/run; simulations and manual completions: 0. First observed combat → final boss; no trash, manual-start or group-power normalization. Start within the season and finish before its exclusive cutoff. Targets and evidence are frozen; older seasons are not rewritten." }
    );
}

function bracketGuide(rules: BracketedRules, fr: boolean): EmbedBuilder {
  const brackets = rules.brackets.map(b => {
    const routes = rules.catalog.filter(d => d.bracket === b.key);
    const levels = b.min === b.max ? `${b.min}` : `${b.min}–${b.max}`;
    return `**${fr ? "Niveaux" : "Levels"} ${levels}** · ${fr ? `${b.bestCount} meilleurs sur ${routes.length} parcours` : `best ${b.bestCount} of ${routes.length} routes`}`;
  }).join("\n");
  return new EmbedBuilder().setColor(0x8b5cf6)
    .setTitle(fr ? "Tous niveaux · comment les points fonctionnent" : "All levels · how points work")
    .setDescription(fr ? "Cote par personnage et par tranche de niveaux; participation par compte. Un résultat d’équipe ne mesure pas à lui seul le talent individuel."
      : "Rating belongs to each character in each level bracket; participation belongs to the account. A team result alone does not measure individual skill.")
    .addFields(
      { name: fr ? "Tranches" : "Brackets", value: brackets.slice(0, 1024) },
      { name: fr ? "Cote · meilleurs parcours par tranche" : "Rating · best routes per bracket", value: fr
        ? "Arrondi(200 × cible ÷ durée), limité à 50–400. Chaque parcours classé appartient à une tranche. Votre personnage est classé dans la tranche de son niveau pendant le run; seuls ses meilleurs parcours distincts de cette tranche comptent. En montant de niveau, vos anciens scores restent dans leur tranche. Répéter n’accumule pas de cote; chaque alt a sa propre cote."
        : "Round(200 × target ÷ duration), clamped to 50–400. Each rated route belongs to one bracket. Your character ranks in the bracket of their level during the run; only their best distinct routes in that bracket count. Scores stay in their bracket as you level up. Repeats do not accumulate rating; each alt has its own rating." },
      { name: fr ? "Admissibilité et preuves" : "Eligibility and evidence", value: fr
        ? "Tous les participants observés, invités et remplaçants inclus, doivent rester dans la plage de niveaux du parcours : un personnage de niveau supérieur rend le run non classé. Personnage lié, présence ≥ 80 %, difficulté configurée, import valide, boss final détecté et tous les boss requis par le parcours figé."
        : "ALL observed participants, including guests and replacements, must stay inside the route's level band: a higher-level character makes the run unranked. Linked character, ≥80% presence, configured difficulty, valid import, detected final boss and every encounter required by the frozen route." },
      { name: fr ? "Participation et historique" : "Participation and history", value: fr
        ? "La participation suit les mêmes règles hebdomadaires que la saison niveau 60. Cibles, tranches et preuves sont figées pour la saison; les archives gardent chaque tranche séparément."
        : "Participation follows the same weekly rules as the level-60 season. Targets, brackets and evidence are frozen for the season; archives keep each bracket separately." }
    );
}

function bestEightGuide(rules: unknown, fr: boolean): EmbedBuilder {
  const catalog = seasonDungeonCatalog(rules, []);
  const bands = (rules as { participationLevelBands?: Record<string, unknown> }).participationLevelBands ?? {};
  const ratedKeys = new Set(catalog.map(d => d.dungeonKey));
  const leveling = BETA_DUNGEONS.filter(d => Object.hasOwn(bands, d.key) && !ratedKeys.has(d.key));
  return new EmbedBuilder().setColor(0x8b5cf6)
    .setTitle(fr ? "Bêta Best 8 · comment les points fonctionnent" : "Best 8 beta · how points work")
    .setDescription(fr ? "Phase de test avant la première saison officielle prévue le 4 novembre. L’ancienne bêta est archivée; les points de participation acquis sont conservés. Deux scores distincts : cote par personnage et participation par compte."
      : "Test phase ahead of the first official season planned for November 4. The previous beta is archived; earned participation points are preserved. Two separate scores: rating per character and participation per account.")
    .addFields(
      { name: fr ? "Cote · vos 8 meilleurs parcours" : "Rating · your best 8 routes", value: fr
        ? "Arrondi(200 × cible ÷ durée), limité à 50–400. Une meilleure tentative par donjon/aile; seuls les 8 meilleurs scores comptent. Tous les participants, invités et remplaçants inclus, doivent rester niveau 30, difficulté 0. Personnage lié, présence ≥ 80 %, boss final détecté et import valide requis. Aucun bonus pour les morts, rôles ou records. C’est un résultat d’équipe."
        : "Round(200 × target ÷ duration), clamped to 50–400. One best per dungeon/wing; only your highest 8 scores count. ALL participants, including guests and replacements, must remain level 30, difficulty 0. Linked character, ≥80% presence, detected final boss and valid import required. Deaths, roles and records add no bonus. This is a team result." },
      { name: fr ? "Exemples et variété" : "Examples and variety", value: fr
        ? "Cible 30 min : 40 min = 150; 30 = 200; 20 = 300; 15 = 400. Huit parcours à la cible = 1 600; plafond = 3 200. Si votre 8e score est 180, un nouveau parcours à 240 ajoute 60. Un 9e parcours moins bon reste visible sans ajouter de points. Les répétitions n’accumulent pas de cote; chaque alt joue son propre classement."
        : "30-minute target: 40 min = 150; 30 = 200; 20 = 300; 15 = 400. Eight routes at target = 1,600; maximum = 3,200. If your 8th score is 180, a new route at 240 adds 60. A weaker 9th route stays visible without adding points. Repeats do not accumulate rating; each alt has its own ranking." },
      { name: fr ? "Participation · progression et entraide" : "Participation · leveling and helping", value: fr
        ? "Par compte et donjon/aile chaque semaine : 50 pour une fin détectée +25 pour la première fin admissible; deuxième fin = 25; suivantes = 0. Présence ≥ 50 %, import valide et boss final détecté requis. Les anciennes plages de niveaux restent valables pour la participation. Sans admissibilité aux bonus : 50 puis 25 puis 0. Aide hors niveau : même récompense si un membre dans la plage est présent ≥ 50 %, sinon 0. Aucun bonus de points pour vitesse, morts, records ou groupe de guilde."
        : "Per account and dungeon/wing each week: 50 for detected completion +25 for the first eligible completion; second completion = 25; later = 0. ≥50% presence, valid import and detected final boss required. The original leveling bands still govern participation. Without bonus eligibility: 50, then 25, then 0. Overlevel helpers receive the same when an in-band member is present ≥50%; otherwise 0. No point bonuses for speed, deaths, records or guild groups." },
      { name: fr ? "Limites et historique" : "Limits and history", value: fr
        ? "Une attribution par compte et parcours. Alts et difficultés partagent le compteur; les ailes reconnues sont distinctes. Remise à zéro mardi 15 h UTC; les parcours déjà effectués cette semaine comptent encore. Simulation et fin manuelle : 0 participation dans cette phase. Début dans la phase et fin avant toute limite exclusive. Les archives et transactions acquises ne sont pas recalculées."
        : "One award per account per run. Alts and difficulties share repeats; recognized wings are distinct. Resets Tuesday 15:00 UTC; runs already completed this week still count. Simulations and manual completions earn no participation in this phase. Start within the phase and finish before any exclusive cutoff. Archives and earned transactions are not recalculated." },
      { name: fr ? "Chronométrage · limites de cette bêta" : "Timing · beta limitations", value: fr
        ? "Premier combat observé → boss final détecté. Voyage avant combat exclu; raccourcis de trash permis. Le départ manuel n’est pas distingué de façon fiable dans les données actuelles. Aucun contrôle universel de tous les boss : ce classement mesure ce parcours détecté, pas un full clear certifié. Cibles provisoires figées pour cette phase; les 11 parcours candidats restent à vérifier en jeu. Hors critères : non classé, raison affichée, 0 cote."
        : "First observed combat → detected final boss. Travel before combat excluded; trash skips allowed. Current data cannot reliably distinguish manual starts. No universal all-boss checklist: this ranks the detected route, not a certified full clear. Provisional targets are frozen for this phase; all 11 candidate routes still need in-game acceptance. Failed criteria: unranked with a reason and 0 rating." },
      { name: fr ? "Cote niveau 30 · cibles de guilde provisoires" : "Level-30 rating · provisional guild targets", value: catalog.map(d => `${d.name}: ${d.targetSec! / 60} min`).join("\n") },
      ...(leveling.length ? [{ name: fr ? "Progression · participation seulement" : "Leveling · participation only", value: leveling.map(d => d.name).join("\n") + (fr
        ? "\nCes donjons sont bien présents dans WoW Forever. Ils sont hors de la sélection Best 8 niveau 30, mais restent admissibles à la participation selon les règles ci-dessus."
        : "\nThese dungeons are present in WoW Forever. They are outside the level-30 Best 8 selection, but remain eligible for participation under the rules above.") }] : []),
      { name: fr ? "Bêta ≠ catalogue de lancement" : "Beta selection ≠ launch catalog", value: fr
        ? "Cette liste décrit notre phase de test, pas tous les donjons du lancement. Les cibles sont des estimations de guilde, jamais des chronos officiels. L’accès bêta à Razorfen Downs (25+) et Uldaman (30+) ne fixe pas leurs niveaux au lancement. Les boss finaux et la classification des ailes restent à valider en jeu. Les règles de novembre seront définies séparément."
        : "This list describes our test phase, not every launch dungeon. Targets are guild estimates, never official timers. Beta access to Razorfen Downs (25+) and Uldaman (30+) does not establish their launch levels. Final-boss detection and wing classification still need in-game validation. November rules will be defined separately." }
    );
}
