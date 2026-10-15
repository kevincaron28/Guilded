import { EmbedBuilder } from "discord.js";
import type { Lang } from "../i18n.js";

// Discovery/planning data only. Never feed this into season rotation or imports.
// Slugs are catalog identifiers, NOT map IDs or competition keys.
const sources = {
  announcement: { label: "Blizzard: nine new dungeons (September 15)", url: "https://us.forums.blizzard.com/en/wow/t/krol%E2%80%99dok-stronghold/2349672", authority: "official" },
  beta: { label: "Blizzard: beta updates (October 1 / October 8)", url: "https://us.forums.blizzard.com/en/wow/t/wow-forever-beta-development-notes-%E2%80%93-updated-october-8/2360696/1", authority: "official-beta" },
  roster: { label: "Icy Veins: dungeon/wing roster (October 7)", url: "https://www.icy-veins.com/wow-forever/dungeons-overview/", authority: "community" }
} as const;
type SourceId = keyof typeof sources;
type Entry = {
  id: string; name: string; family: string;
  evidence: "beta-instance-listed" | "announced-new" | "community-listed";
  sources: SourceId[];
  betaScoringKey: string | null;
  participation: "planned-pending-verification";
  rating: "participation-only" | "candidate-pending-verification";
  launchVerified: false;
  targetSec: null; difficultyId: null; allowedLevels: null;
};
const entry = (id: string, name: string, family: string, evidence: Entry["evidence"], betaScoringKey: string | null = null, candidate = false, isNew = false): Entry => ({
  id, name, family, evidence,
  sources: [...(isNew ? ["announcement" as const] : []), ...(evidence === "beta-instance-listed" ? ["beta" as const] : []), "roster"],
  betaScoringKey, participation: "planned-pending-verification",
  rating: candidate ? "candidate-pending-verification" : "participation-only",
  launchVerified: false, targetSec: null, difficultyId: null, allowedLevels: null
});

// Ten endgame route candidates are a guild proposal, not an active rotation.
// Shared-map families require a verified classifier before any wing is scored.
const routes: Entry[] = [
  entry("ragefire-chasm", "Ragefire Chasm", "ragefire-chasm", "beta-instance-listed", "389"),
  entry("hall-of-thanes", "The Hall of Thanes", "hall-of-thanes", "beta-instance-listed", "3065", false, true),
  entry("ruins-of-lordaeron", "Ruins of Lordaeron", "ruins-of-lordaeron", "beta-instance-listed", "2999", false, true),
  entry("wailing-caverns", "Wailing Caverns", "wailing-caverns", "beta-instance-listed", "43"),
  entry("deadmines", "The Deadmines", "deadmines", "beta-instance-listed", "36"),
  entry("shadowfang-keep", "Shadowfang Keep", "shadowfang-keep", "beta-instance-listed", "33"),
  entry("blackfathom-deeps", "Blackfathom Deeps", "blackfathom-deeps", "beta-instance-listed", "48"),
  entry("stockade", "The Stockade", "stockade", "beta-instance-listed", "34"),
  entry("excavation-wetlands", "Excavation Site: Wetlands", "excavation-wetlands", "beta-instance-listed", "2998", false, true),
  entry("city-of-dalaran", "City of Dalaran", "city-of-dalaran", "beta-instance-listed", "2959", false, true),
  entry("gnomeregan", "Gnomeregan", "gnomeregan", "beta-instance-listed", "90"),
  entry("razorfen-kraul", "Razorfen Kraul", "razorfen-kraul", "beta-instance-listed", "47"),
  entry("scarlet-graveyard", "Scarlet Monastery: Graveyard", "scarlet-monastery", "beta-instance-listed", "189:graveyard"),
  entry("scarlet-library", "Scarlet Monastery: Library", "scarlet-monastery", "beta-instance-listed", "189:library"),
  entry("drowned-city", "The Drowned City", "drowned-city", "announced-new", null, false, true),
  entry("scarlet-armory", "Scarlet Monastery: Armory", "scarlet-monastery", "beta-instance-listed"),
  entry("razorfen-downs", "Razorfen Downs", "razorfen-downs", "beta-instance-listed", "129"),
  entry("scarlet-cathedral", "Scarlet Monastery: Cathedral", "scarlet-monastery", "beta-instance-listed"),
  entry("kroldok-stronghold", "Krol'dok Stronghold", "kroldok-stronghold", "announced-new", null, false, true),
  entry("uldaman", "Uldaman", "uldaman", "beta-instance-listed", "70"),
  entry("zulfarrak", "Zul'Farrak", "zulfarrak", "community-listed"),
  entry("maraudon", "Maraudon", "maraudon", "community-listed"),
  entry("alcaz-prison", "Alcaz Prison", "alcaz-prison", "announced-new", null, false, true),
  entry("sunken-temple", "Temple of Atal'Hakkar (Sunken Temple)", "sunken-temple", "community-listed"),
  entry("blackrock-depths", "Blackrock Depths", "blackrock-depths", "community-listed", null, true),
  entry("dire-maul-east", "Dire Maul: East", "dire-maul", "community-listed", null, true),
  entry("blackmaw-hold", "Blackmaw Hold", "blackmaw-hold", "announced-new", null, true, true),
  entry("lower-blackrock-spire", "Lower Blackrock Spire", "blackrock-spire", "community-listed", null, true),
  entry("dire-maul-north", "Dire Maul: North", "dire-maul", "community-listed", null, true),
  entry("dire-maul-west", "Dire Maul: West", "dire-maul", "community-listed", null, true),
  entry("scholomance", "Scholomance", "scholomance", "community-listed", null, true),
  entry("shapers-terrace", "Shaper's Terrace", "shapers-terrace", "announced-new", null, true, true),
  entry("stratholme-main", "Stratholme: Main Gate", "stratholme", "community-listed", null, true),
  entry("stratholme-service", "Stratholme: Service Gate", "stratholme", "community-listed", null, true),
  entry("upper-blackrock-spire", "Upper Blackrock Spire", "blackrock-spire", "community-listed")
];

/** A fresh, deliberately non-executable planning document; no DB access. */
export function novemberDungeonCatalog() {
  return structuredClone({
    kind: "dungeon-planning-catalog" as const, schemaVersion: 1,
    id: "forever-november-2026-draft", researchedAt: "2026-10-15",
    intendedDate: "2026-11-04", timezone: "America/Toronto", startsAt: null,
    state: "draft-not-active" as const,
    competitionProposal: { level: 60, bestCount: 8, status: "proposal-not-approved" },
    ratedRoutes: [] as string[], // Intentionally empty until launch evidence and calibration.
    sources, routes
  });
}

export function novemberCatalogEmbeds(lang: Lang): EmbedBuilder[] {
  const fr = lang === "fr";
  const catalog = novemberDungeonCatalog();
  const candidates = catalog.routes.filter(r => r.rating === "candidate-pending-verification");
  const participation = catalog.routes.filter(r => r.rating === "participation-only");
  const names = (rows: Entry[]) => rows.map(r => r.name).join("\n");
  return [new EmbedBuilder().setColor(0xd4a017)
    .setTitle(fr ? "4 novembre · catalogue en préparation" : "November 4 · planning catalog")
    .setDescription(fr
      ? "35 donjons/ailes à préparer pour la participation; aucun parcours coté activé pour novembre. La sélection bêta et ses archives ne changent pas. Une annonce ou une liste communautaire ne prouve pas la validation en jeu au lancement."
      : "35 dungeon/wing entries planned for participation; no November rated routes activated. The beta selection and archives are unchanged. An announcement or community listing does not establish launch-client verification.")
    .addFields(
      { name: fr ? "Participation seulement · proposition" : "Participation only · proposal", value: names(participation) },
      { name: fr ? "Participation + candidats à la cote · non activés" : "Participation + rating candidates · not activated", value: names(candidates) },
      { name: fr ? "Avant activation" : "Before activation", value: fr
        ? "Proposition : niveau 60, 8 meilleurs parcours. Niveaux admis, difficulté et temps cibles non définis. Vérifier accès, taille du groupe, identité des ailes et boss final; calibrer les temps puis figer une nouvelle saison. Aucun gain automatique de points par ajout au catalogue. /dungeon rules explique la phase active."
        : "Proposal: level 60, best 8 routes. Allowed bands, difficulty and targets are unset. Verify access, party size, wing identity and final boss; calibrate times, then freeze a new season. Catalog inclusion awards no points automatically. /dungeon rules explains the active phase." },
      { name: fr ? "Sources et limites" : "Sources and limits", value: fr
        ? `[Blizzard : nouveaux donjons](${sources.announcement.url}) · [bêta](${sources.beta.url}) · [Icy Veins : catalogue](${sources.roster.url}). Les ailes d’une même instance restent à distinguer en jeu; les niveaux d’accès bêta ne sont pas des règles de novembre.`
        : `[Blizzard: new dungeons](${sources.announcement.url}) · [beta](${sources.beta.url}) · [Icy Veins: roster](${sources.roster.url}). Shared-instance wings need in-game classification; beta access levels are not November rules.` }
    ).setFooter({ text: fr ? "Préparation au 15 octobre 2026 · aucune activation" : "Prepared October 15, 2026 · not activated" })];
}

export function novemberCatalogMarkdown(lang: Lang): string {
  const fr = lang === "fr";
  const catalog = novemberDungeonCatalog();
  const evidence = fr
    ? { "beta-instance-listed": "Instance citée en bêta", "announced-new": "Nouveau donjon annoncé", "community-listed": "Catalogue communautaire" }
    : { "beta-instance-listed": "Instance listed in beta", "announced-new": "New dungeon announced", "community-listed": "Community roster" };
  const title = fr ? "Catalogue de donjons pour le 4 novembre — préparation" : "November 4 dungeon catalog — preparation";
  const intro = fr
    ? "Préparé le 15 octobre 2026. Brouillon distinct des règles de saison : 35 entrées, regroupées en 28 familles d’instances. Ce comptage distingue les ailes et n’est pas un total officiel garanti. Les noms anglais servent de références; ce ne sont pas des noms de boss à utiliser pour la détection."
    : "Prepared October 15, 2026. A draft separate from season rules: 35 entries grouped into 28 instance families. This counts wings separately and is not a guaranteed official total. English names are catalog references, not boss-detection aliases.";
  const separation = fr
    ? "Les 35 entrées sont prévues pour la participation après validation. Parmi elles, 10 sont proposées comme candidates à la cote, les 25 autres pour la participation seulement. Aucun parcours de novembre n’est activé. Proposition de compétition : personnages niveau 60, huit meilleurs parcours. Ce choix reste à valider; il ne remplace pas le Best 8 bêta niveau 30. Aucun temps cible, niveau admissible ou difficulté n’est configuré. Le 4 novembre est une date de préparation, sans heure UTC ni activation programmée."
    : "All 35 entries are planned for participation after verification. Ten are also proposed rating candidates; the other 25 are participation-only. No November rated route is activated. Competition proposal: level-60 characters, best eight routes. This remains a proposal and does not replace the level-30 beta Best 8. Targets, allowed bands and difficulty are unset. November 4 is the intended date, with no scheduled activation or UTC start time.";
  const header = fr ? "| Donjon / aile | Plan de novembre | Preuve de présence | Référence bêta |\n| --- | --- | --- | --- |" : "| Dungeon / wing | November plan | Presence evidence | Beta reference |\n| --- | --- | --- | --- |";
  const rows = catalog.routes.map(r => `| ${r.name} | ${r.rating === "participation-only" ? (fr ? "Participation" : "Participation") : (fr ? "Participation + candidat cote" : "Participation + rating candidate")} | ${evidence[r.evidence]} | ${r.betaScoringKey ?? "—"} |`).join("\n");
  const gates = fr
    ? `## Validation avant toute activation

- Confirmer l’accès dans le client de lancement, avec date, build et preuve de run.
- Relever le vrai map ID, la difficulté, les niveaux observés et la taille du groupe. Les slugs du JSON ne sont pas des identifiants de jeu. Les références bêta ne prouvent pas la compatibilité au lancement.
- Valider départ, présence, boss final et remplacements. Distinguer chaque aile par des preuves fiables. Le code actuel ne distingue automatiquement que les ailes de Scarlet pour la cote; Dire Maul, Stratholme et Blackrock Spire nécessitent un travail spécifique. Ne jamais donner deux récompenses pour une seule fin ambiguë.
- Définir le parcours complet de Blackrock Depths et de chaque aile. Ne pas comparer une aile, une visite partielle et un parcours complet comme un même run.
- Mesurer les candidats avec plusieurs groupes comparables; fixer les cibles et niveaux pour la nouvelle saison seulement. Ne pas reprendre automatiquement les chronos ou accès temporaires de la bêta.
- Confirmer la liste et l’heure de début, puis utiliser une rotation sauvegardée et transactionnelle. Aucun script de ce dossier n’active une saison.

Les 10 candidats favorisent une compétition à niveau fixe accessible aux arrivants tardifs. Dire Maul et Stratholme ont plusieurs ailes : revoir leur poids et leur indépendance avant de figer la sélection. Upper Blackrock Spire reste en participation seulement en attendant la vérification de la taille du groupe et du format. Les points de participation, compteurs hebdomadaires, gestion des helpers et bandes de niveaux de novembre restent à figer séparément.

## Conservation et outils

Le catalogue ne modifie ni le preset bêta, ni les saisons en base, ni les scores, transactions ou archives. Tous les contrôles de lancement sont en attente. Ne pas importer ce JSON comme règles de saison. Aucun nouveau boss ID, map ID, difficulté ou chrono n’a été inventé.

\`/dungeon catalog\` affiche cette préparation en anglais/français après déploiement et enregistrement de la commande. \`/dungeon rules\` continue d’expliquer la phase active. Aucun message Discord n’est publié par la génération locale.

Régénérer : \`npx tsx scripts/prepare-november-dungeon-catalog.ts\`. Vérifier sans écrire : ajouter \`--check\`. Le JSON est dans [data/november-dungeon-catalog.json](data/november-dungeon-catalog.json).

## Sources et incertitudes

La liste officielle annonce neuf nouveaux donjons; les notes bêta établissent la présence des premières instances. Le catalogue communautaire complète les anciens donjons et les ailes. Une instance citée n’établit pas la validation de chaque aile. Les plages publiées diffèrent entre sources; elles ne sont donc pas copiées dans les règles proposées. Aucun run de lancement n’a encore été vérifié.
`
    : `## Gates before activation

- Confirm access in the launch client and retain date, build and run evidence.
- Record actual map ID, difficulty, observed levels and party size. JSON slugs are not game IDs; beta references do not prove launch compatibility.
- Verify starts, presence, final boss and replacements. Distinguish wings using reliable evidence. Current rating code classifies Scarlet wings only; Dire Maul, Stratholme and Blackrock Spire require additional implementation. Never award two completions from one ambiguous route.
- Define the required Blackrock Depths route and each wing. Partial visits, wings and full clears must not silently share a scoring standard.
- Calibrate candidates with several comparable crews, then freeze new-season targets and bands. Do not automatically carry forward beta timers or temporary access levels.
- Confirm the selection and exact start time, then use backed-up transactional season rotation. No script supplied here activates a season.

The ten candidates propose fixed-level competition that late starters can join. Dire Maul and Stratholme have multiple wings: review their weight and independence before freezing the selection. Upper Blackrock Spire remains participation-only pending verification of party size and format. November participation awards, weekly counters, helper rules and level bands must be frozen separately.

## Preservation and tools

This catalog changes no beta preset, database season, score, transaction or archive. Every launch-client check is pending. Do not import its JSON as season rules. No new boss ID, map ID, difficulty or timer was invented.

\`/dungeon catalog\` displays this plan in English/French after deployment and command registration. \`/dungeon rules\` continues to explain the active phase. Local generation publishes no Discord messages.

Regenerate: \`npx tsx scripts/prepare-november-dungeon-catalog.ts\`. Add \`--check\` to verify without writing. Machine-readable data: [data/november-dungeon-catalog.json](data/november-dungeon-catalog.json).

## Sources and uncertainty

The official announcement names nine new dungeons; beta notes establish early instance presence. The community roster supplies remaining Classic entries and wings. Listing an instance does not verify every wing. Published ranges differ between sources, so none are copied into proposed eligibility rules. No launch-client run has yet been verified.
`;
  return `# ${title}\n\n${intro}\n\n${separation}\n\n${header}\n${rows}\n\n${gates}\n${Object.values(catalog.sources).map(s => `- [${s.label}](${s.url})`).join("\n")}\n`;
}
