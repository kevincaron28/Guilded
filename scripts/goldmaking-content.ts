// Content and structure for the Goldmaking section (used by scripts/setup-goldmaking.ts and tests).
// Pure data: no Discord calls, no config import.
//
// Honesty convention used in every post (the legend is published in #welcome-to-goldmaking):
//   ✅ Vérifié dans WoW Forever   ⚠️ Base Classic, à valider en Forever   🧪 Non testé / hypothèse
// Nothing below is a gold/hour figure, drop rate or item location: those belong in member guides, with a source.

export const START_CATEGORY = "GOLDMAKING | START HERE";
export const LIBRARY_CATEGORY = "GOLDMAKING | FARMING LIBRARY";
export const MODERATOR_ROLE = "Goldmaking Moderator";
export const MODERATOR_USERNAME = "crashinbananas";
export const MARKER = "goldmaking";

export type TextChannelDef = { name: string; topic: string; posts: PostDef[] };
export type PostDef = { key: string; title: string; body: string };
export type ForumDef = { name: string; topic: string; tags: string[]; hint: string; example: string };

const NAMES = {
  start: ["welcome-to-goldmaking", "guide-index", "goldmaking-basics", "class-and-race-choice", "professions-and-alt-army", "addons-and-setup"],
  forums: ["leveling-gold-farms", "open-world-farms", "fishing-farms", "gathering-and-materials", "dungeon-farms", "rare-drops-and-formulas", "crafting-and-shuffles"]
} as const;
export const START_CHANNEL_NAMES: readonly string[] = NAMES.start;
export const FORUM_NAMES: readonly string[] = NAMES.forums;

// ---- Tags (Discord: at most 20 per forum, name at most 20 characters) -------------------------------------------
const LEVEL = ["Niv. 1–19", "Niv. 20–29", "Niv. 30–39", "Niv. 40–49", "Niv. 50–60"];
const DIFFICULTY = ["🟢 Facile", "🟡 Moyen", "🔴 Difficile"];
const COMPETITION = ["Compét. faible", "Compét. moyenne", "Compét. élevée"];
const REQUIREMENTS = ["Toute classe", "Mage", "Chasseur", "Paladin"];
const TYPE = { raw: "Or brut", mats: "Matériaux", rare: "Drops rares", vendor: "Vendeur" };
const PROF = { skin: "Dépeçage", mine: "Minage", herb: "Herboristerie", fish: "Pêche", craft: "Artisanat" };

// ---- Forums -------------------------------------------------------------------------------------------------------
const FORMAT_TOPIC =
  "Un guide par fil. Titre : [Niv.+] Zone — Ressource principale. Utilise le modèle épinglé, choisis tes étiquettes et indique ta source et la date de vérification. Aucun chiffre d'or/heure ou taux de drop sans preuve (capture, relevé, lien).";

export const FORUMS: ForumDef[] = [
  {
    name: "leveling-gold-farms",
    topic: `Or gagné pendant la montée en niveau : quêtes rentables, zones, matériaux à garder. ${FORMAT_TOPIC}`,
    tags: [...LEVEL, TYPE.raw, TYPE.mats, ...DIFFICULTY, ...COMPETITION, ...REQUIREMENTS],
    hint: "Montée en niveau rentable",
    example: "[20+] Zone — Matériaux"
  },
  {
    name: "open-world-farms",
    topic: `Farms en monde ouvert : mobs, parcours, nœuds. ${FORMAT_TOPIC}`,
    tags: [...LEVEL, TYPE.raw, TYPE.mats, TYPE.rare, TYPE.vendor, ...DIFFICULTY, ...COMPETITION, ...REQUIREMENTS],
    hint: "Farm en monde ouvert",
    example: "[30+] Zone — Ressource"
  },
  {
    name: "fishing-farms",
    topic: `Pêche : zones, bancs, prises utiles et revente. ${FORMAT_TOPIC}`,
    tags: [...LEVEL, PROF.fish, TYPE.raw, TYPE.mats, TYPE.vendor, ...DIFFICULTY, ...COMPETITION, REQUIREMENTS[0]!],
    hint: "Pêche",
    example: "[1+] Zone — Poisson ou prise"
  },
  {
    name: "gathering-and-materials",
    topic: `Récolte et matériaux : dépeçage, minage, herboristerie, pêche. ${FORMAT_TOPIC}`,
    tags: [...LEVEL, PROF.skin, PROF.mine, PROF.herb, PROF.fish, TYPE.mats, TYPE.raw, ...DIFFICULTY, ...COMPETITION],
    hint: "Récolte de matériaux",
    example: "[25+] Zone — Minerai ou herbe"
  },
  {
    name: "dungeon-farms",
    topic: `Donjons : boucles, boss, trash rentable, prérequis de groupe. ${FORMAT_TOPIC}`,
    tags: [...LEVEL, TYPE.raw, TYPE.mats, TYPE.rare, TYPE.vendor, ...DIFFICULTY, ...COMPETITION, ...REQUIREMENTS],
    hint: "Farm de donjon",
    example: "[25+] Donjon — Drop visé"
  },
  {
    name: "rare-drops-and-formulas",
    topic: `Drops rares, formules, patrons et recettes : où, comment et à quel prix. ${FORMAT_TOPIC}`,
    tags: [...LEVEL, TYPE.rare, TYPE.raw, PROF.craft, ...DIFFICULTY, ...COMPETITION, ...REQUIREMENTS],
    hint: "Drop rare, formule ou patron",
    example: "[40+] Zone — Formule ou patron"
  },
  {
    name: "crafting-and-shuffles",
    topic: `Artisanat et « shuffles » (transformer des matériaux en produits plus chers). ${FORMAT_TOPIC}`,
    tags: [...LEVEL, ...Object.values(PROF), TYPE.mats, TYPE.vendor, TYPE.raw, ...DIFFICULTY, ...COMPETITION],
    hint: "Artisanat ou shuffle",
    example: "[30+] Métier — Produit fabriqué"
  }
];

// ---- Forum starter template ---------------------------------------------------------------------------------------
export const TEMPLATE_THREAD_TITLE = "📌 Modèle de guide — à copier avant de publier";

export function templatePosts(forum: ForumDef): { intro: string; template: string } {
  const intro = [
    `Bienvenue dans **${forum.name}** (${forum.hint}).`,
    "",
    "**Comment publier**",
    "1. Copie le modèle ci-dessous dans un **nouveau fil** de ce forum.",
    `2. Titre exact : \`[Niv.+] Zone — Ressource principale\` (ex. : \`${forum.example}\`).`,
    "3. Choisis les étiquettes (niveau, difficulté, compétition, classe).",
    "4. Remplis **toutes** les sections. Écris « Inconnu » plutôt que de deviner.",
    "",
    "**Niveaux de confiance** (mets-en un sur chaque affirmation importante)",
    "✅ Vérifié dans WoW Forever · ⚠️ Base Classic, à valider en Forever · 🧪 Non testé / hypothèse",
    "",
    "**Interdit** : chiffres d'or/heure, taux de drop ou emplacements inventés ou copiés de Classic sans l'indiquer. Une estimation sans preuve doit être marquée 🧪 ou omise."
  ].join("\n");

  const template = [
    "```",
    "TITRE : [Niv.+] Zone — Ressource principale",
    "",
    "STATUT : ✅ Vérifié / ⚠️ Base Classic / 🧪 Non testé",
    "",
    "## Prérequis",
    "- Niveau :",
    "- Classe (ou « toutes ») :",
    "- Métiers et niveaux de compétence :",
    "- Équipement / consommables :",
    "",
    "## Emplacement",
    "- Zone et coordonnées :",
    "- Parcours suggéré :",
    "- Captures (carte, parcours) :",
    "",
    "## Quoi farmer",
    "- Monstres / nœuds / drops visés :",
    "",
    "## Pourquoi ça marche",
    "- Demande, taux de drop observé (nombre d'essais), avantages pratiques :",
    "",
    "## Rentabilité estimée",
    "- Seulement si tu as des preuves : durée de la session, nombre de",
    "  sessions, prix de l'HV avec date. Sinon : « Non mesuré ».",
    "",
    "## Stratégie de vente",
    "- Hôtel des ventes / vendeur / artisanat :",
    "",
    "## Conseils",
    "- Efficacité, compétition, alternatives :",
    "",
    "## Source et dernière vérification",
    "- Source (joueur, lien, capture) :",
    "- Vérifié en jeu par : ____ le AAAA-MM-JJ",
    "```"
  ].join("\n");
  return { intro, template };
}

// ---- Text channels ------------------------------------------------------------------------------------------------
// {{ch:name}} becomes a channel mention at publish time.
export const TEXT_CHANNELS: TextChannelDef[] = [
  {
    name: "welcome-to-goldmaking",
    topic: "Introduction, règles et navigation de la section Goldmaking pour WoW Forever. Commence ici.",
    posts: [
      {
        key: "welcome",
        title: "Bienvenue dans Goldmaking",
        body: [
          "Cette section réunit les guides et les conseils de la communauté Québec Gold pour **faire de l'or dans WoW Forever** : comprendre l'hôtel des ventes, choisir ses métiers et trouver des farms fiables.",
          "",
          "**Par où commencer ?**",
          "1. {{ch:goldmaking-basics}} — les notions de base (hôtel des ventes, valeurs de vente, inventaire).",
          "2. {{ch:class-and-race-choice}} — quelle classe et quelle race aident à farmer.",
          "3. {{ch:professions-and-alt-army}} — métiers, personnages de soutien et délais de fabrication.",
          "4. {{ch:addons-and-setup}} — addons et réglages utiles.",
          "5. {{ch:guide-index}} — l'index des guides de farm de la bibliothèque.",
          "",
          "**La bibliothèque de farms** (forums) : {{ch:leveling-gold-farms}}, {{ch:open-world-farms}}, {{ch:fishing-farms}}, {{ch:gathering-and-materials}}, {{ch:dungeon-farms}}, {{ch:rare-drops-and-formulas}} et {{ch:crafting-and-shuffles}}.",
          "",
          "Chaque forum a un **modèle de guide épinglé** : utilise-le pour que tous les guides se ressemblent et soient faciles à comparer.",
          "",
          "WoW Forever ouvre le **4 novembre 2026**. Tout est neuf : les prix, la concurrence et parfois les règles changeront vite. Une information datée et sourcée vaut mieux qu'une rumeur."
        ].join("\n")
      },
      {
        key: "rules",
        title: "Règles de la section",
        body: [
          "1. **Respect avant tout.** Pas d'insultes ni de moqueries envers les débutants. Les questions de base sont les bienvenues.",
          "2. **Zéro argent réel.** Aucune vente d'or, d'objets ou de comptes contre de l'argent réel, aucun service de « boost » payé en argent réel.",
          "3. **Pas de triche.** Pas de bots, d'exploits ni de contournement des règles du jeu. Ces guides sont retirés.",
          "4. **Sources obligatoires.** Un guide doit indiquer d'où vient l'information et quand elle a été vérifiée. Ne présente jamais une donnée de Classic comme une donnée de Forever sans le dire.",
          "5. **Pas de chiffres inventés.** Les gains par heure, les taux de drop et les emplacements doivent être appuyés par une preuve (captures, relevés, liens). Sinon, écris « non mesuré ».",
          "6. **Un sujet par fil.** Dans les forums, un guide par fil, avec le bon titre et les bonnes étiquettes. Les doublons seront fusionnés.",
          "7. **Pas de spam ni de publicité.** Pas de liens commerciaux, d'affiliation ou d'autopromotion.",
          "8. **Respecte la modération.** L'équipe **Goldmaking Moderator** peut verrouiller, archiver ou retirer un fil, ou demander une correction."
        ].join("\n")
      },
      {
        key: "legend",
        title: "Niveaux de confiance et façon de contribuer",
        body: [
          "**Niveaux de confiance** — à placer sur chaque affirmation importante :",
          "✅ **Vérifié dans WoW Forever** : tu l'as vu ou mesuré dans le jeu (date + capture si possible).",
          "⚠️ **Base Classic, à valider en Forever** : vrai dans Classic, mais Forever peut avoir changé.",
          "🧪 **Non testé / hypothèse** : idée à essayer. À dire clairement.",
          "",
          "**Publier un guide**",
          "1. Ouvre le forum du bon thème et lis le fil épinglé « Modèle de guide ».",
          "2. Crée un nouveau fil avec le titre `[Niv.+] Zone — Ressource principale`.",
          "3. Remplis toutes les sections et ajoute les étiquettes.",
          "4. Ajoute la source et la date de vérification.",
          "5. Tu as refait le farm et les chiffres ont changé ? Réponds dans le fil avec la date et tes relevés.",
          "",
          "**Un problème ?** Signale-le à l'équipe de modération de la section."
        ].join("\n")
      }
    ]
  },
  {
    name: "guide-index",
    topic: "Index des guides de farm par thème. Mis à jour automatiquement par le script de configuration.",
    posts: [] // built dynamically from the live forums (see setup-goldmaking.ts)
  },
  {
    name: "goldmaking-basics",
    topic: "Bases du goldmaking : hôtel des ventes, valeurs de vente, gestion d'inventaire, bonnes habitudes.",
    posts: [
      {
        key: "basics-1",
        title: "Leçon 1 — D'où vient l'or ?",
        body: [
          "Il y a trois grandes façons de gagner de l'or. Les meilleurs joueurs les combinent.",
          "",
          "**1. L'or brut** : l'or ramassé sur les monstres et récompensé par les quêtes. Simple, mais rarement le plus rentable.",
          "**2. Les matériaux** : minerais, herbes, cuirs, poissons… à vendre à l'hôtel des ventes (HV) ou à utiliser dans tes métiers.",
          "**3. Le commerce et l'artisanat** : acheter, transformer, revendre. Demande de connaître les prix, mais bat souvent le farm pur.",
          "",
          "**Le principe qui compte** : ton or par heure dépend de **ce que le serveur achète vraiment**, pas de ce que tu trouves cool. Avant de farmer, regarde ce qui se vend et à quel prix.",
          "",
          "⚠️ Les prix de Forever seront très instables à l'ouverture. Ne copie pas les prix d'un guide Classic : mesure-les toi-même."
        ].join("\n")
      },
      {
        key: "basics-2",
        title: "Leçon 2 — Les bases de l'hôtel des ventes",
        body: [
          "**Avant de vendre**",
          "- Cherche l'objet et regarde **plusieurs offres**, pas seulement la moins chère.",
          "- Note le prix **à plusieurs moments** (soir, matin, fin de semaine). Un prix isolé ne veut rien dire.",
          "- Compare avec la **valeur chez le vendeur** : ne vends jamais à l'HV sous cette valeur.",
          "",
          "**Frais** ⚠️ (valeurs de Classic, à confirmer en Forever)",
          "- Une **mise en dépôt** est payée en listant l'objet. Elle est perdue si l'objet n'est pas vendu.",
          "- L'HV prend une **commission** sur la vente.",
          "- La durée de l'enchère influence le dépôt : une courte durée coûte moins cher si l'objet se vend vite.",
          "",
          "**Bonnes pratiques**",
          "- Remets en vente par petits lots plutôt qu'un gros stock d'un coup : tu testes le marché.",
          "- Ne baisse pas ton prix de 1 pc à chaque fois par réflexe : regarde si les autres offres sont réalistes.",
          "- Garde une réserve d'or pour saisir les bonnes affaires.",
          "- Vérifie la **concurrence** : beaucoup d'offres au même prix = marché saturé.",
          "",
          "🧪 Idée à tester : tenir un petit tableau (objet, prix d'achat, prix de vente, date) pour voir ce qui rapporte réellement."
        ].join("\n")
      },
      {
        key: "basics-3",
        title: "Leçon 3 — Valeur chez le vendeur et tri du butin",
        body: [
          "Chaque objet affiche sa **valeur de revente** dans l'infobulle quand tu visites un marchand.",
          "",
          "**Règle simple de tri**",
          "- **Objets gris** : vends-les au marchand. Ils ne se vendent pas à l'HV.",
          "- **Objets blancs/verts** : compare le prix HV à la valeur du vendeur avant de décider.",
          "- **Matériaux de métier** : garde-les si tu en as besoin ou s'ils se vendent bien à l'HV.",
          "- **Objets d'équipement verts ou meilleurs** : vérifie d'abord s'ils sont pour toi, puis leur prix à l'HV.",
          "",
          "**Astuces**",
          "- Une valeur de vendeur élevée sert de **prix plancher** : si l'HV propose moins, vends au marchand.",
          "- Certains objets de quête ne se vendent pas : lis l'infobulle avant de détruire quoi que ce soit.",
          "",
          "⚠️ Les valeurs de revente exactes d'un objet de Forever peuvent différer de Classic. L'infobulle en jeu fait foi."
        ].join("\n")
      },
      {
        key: "basics-4",
        title: "Leçon 4 — Gérer son inventaire",
        body: [
          "Un sac plein = du farm perdu. Planifie ton espace.",
          "",
          "**Priorités**",
          "1. Achète/fabrique de **meilleurs sacs** dès que possible : c'est l'un des meilleurs investissements en début de jeu.",
          "2. Garde **1 à 2 emplacements libres** pour ne jamais manquer un drop important.",
          "3. Trie par catégories : matériaux, consommables, équipement à vérifier, objets à vendre.",
          "",
          "**Routine de fin de session**",
          "- Vends les objets gris.",
          "- Mets en vente à l'HV ce qui vaut la peine.",
          "- Envoie les matériaux utiles à ton personnage de soutien (voir {{ch:professions-and-alt-army}}).",
          "- Note ce qui s'est bien vendu : c'est ton meilleur guide pour la prochaine session.",
          "",
          "**Éviter les pertes**",
          "- Ne mets jamais en vente un objet que tu ne reconnais pas sans vérifier son prix.",
          "- Sépare l'or de ton équipement : ne laisse pas tout sur un seul personnage."
        ].join("\n")
      },
      {
        key: "basics-5",
        title: "Leçon 5 — Comment juger un farm",
        body: [
          "Avant de recommander un farm, il faut des **preuves**. Quand tu testes un farm, note :",
          "",
          "- La **durée** de la session (chronomètre).",
          "- Ce que tu as ramassé (nombre d'objets, d'or).",
          "- Les **prix de l'HV** relevés le même jour, avec la date.",
          "- La **concurrence** observée (autres joueurs sur le même parcours).",
          "- Le nombre de **sessions** répétées : une seule session peut être de la chance.",
          "",
          "**Valeur d'un guide**",
          "- ✅ Plusieurs sessions mesurées + captures + date.",
          "- ⚠️ Marche dans Classic, pas encore refait en Forever.",
          "- 🧪 Idée à tester.",
          "",
          "Un chiffre « X pièces d'or par heure » sans ces détails n'a pas sa place dans la bibliothèque. Il vaut mieux écrire « non mesuré »."
        ].join("\n")
      }
    ]
  },
  {
    name: "class-and-race-choice",
    topic: "Avantages de classe et de race pour farmer dans WoW Forever (à valider en jeu).",
    posts: [
      {
        key: "class-1",
        title: "Choisir sa classe pour farmer",
        body: [
          "Tout le contenu ci-dessous est ⚠️ **basé sur Classic** : les compétences, les talents et l'équilibre de Forever peuvent différer. Vérifie en jeu, puis corrige ce message avec la modération.",
          "",
          "**Ce qui rend une classe bonne pour farmer**",
          "- Elle tue vite sans se reposer longtemps (peu de **temps mort**).",
          "- Elle survit seule contre plusieurs monstres (**dégâts de zone**, contrôle, soins).",
          "- Elle se déplace bien (vitesse, évasion, retour rapide).",
          "- Elle a des **outils de métier ou de repérage** utiles.",
          "",
          "**Les trois classes les plus citées**",
          "🔥 **Mage** — dégâts de zone, contrôle, génération de nourriture et d'eau. Souvent cité pour les groupes de monstres. À tester : donjons et zones denses. *Étiquette : Mage.*",
          "🏹 **Chasseur** — familier qui absorbe les dégâts, dégâts à distance, repérage de types de créatures, feinte de mort. Très cohérent avec le dépeçage. *Étiquette : Chasseur.*",
          "🛡️ **Paladin** — résistant, soigne ses propres dégâts, utile en solo. *Étiquette : Paladin.*",
          "",
          "🧪 **D'autres classes** peuvent très bien farmer (druide pour les voyages et l'herboristerie, voleur pour la furtivité, démoniste pour les familiers et la vie). Si tu as un farm qui marche avec une autre classe, publie-le dans la bibliothèque avec l'étiquette « Toute classe » ou la classe concernée, et ta preuve."
        ].join("\n")
      },
      {
        key: "race-1",
        title: "Choisir sa race pour farmer",
        body: [
          "Les bonus raciaux sont modestes, mais certains aident le goldmaking. ⚠️ Exemples de **Classic**, à confirmer sur le personnage en jeu :",
          "",
          "- **Tauren** : bonus à l'herboristerie.",
          "- **Nain** : capacité qui aide à repérer des trésors/minerais sur la mini-carte.",
          "",
          "**Ce qui compte vraiment**",
          "- Ta faction détermine où tu vends (HV de ta faction) et la concurrence que tu affrontes.",
          "- Les villes de départ et les routes proches de tes zones de farm vont te faire gagner du temps.",
          "- Choisis la race que tu **aimes jouer** : un farm que tu ne supportes pas, tu ne le feras pas longtemps.",
          "",
          "Forever peut introduire des changements de races ou de capacités. Vérifie l'infobulle de la capacité raciale en jeu et corrige-nous au besoin."
        ].join("\n")
      }
    ]
  },
  {
    name: "professions-and-alt-army",
    topic: "Combinaisons de métiers, personnages d'artisanat et de récolte, gestion des délais de fabrication.",
    posts: [
      {
        key: "prof-1",
        title: "Choisir ses métiers",
        body: [
          "Deux types de métiers : **récolte** (dépeçage, minage, herboristerie, pêche) et **fabrication** (alchimie, forge, enchantement, ingénierie, couture, travail du cuir, etc.).",
          "",
          "**Combinaisons classiques** ⚠️ (logique de Classic, à confirmer en Forever)",
          "- **Minage + Dépeçage** : deux récoltes qui se pratiquent en même temps (tu dépeces ce que tu tues, tu mines ce que tu croises) et qui alimentent chacune un métier de fabrication.",
          "- **Herboristerie + Alchimie** : tu récoltes ce que tu transformes toi-même.",
          "- **Minage + Forge / Ingénierie** : même logique, avec les minerais.",
          "- **Dépeçage + Travail du cuir** : cuirs et peaux directement utilisables.",
          "",
          "**À savoir**",
          "- La récolte rapporte tôt ; la fabrication rapporte plus tard (souvent, mais pas toujours).",
          "- Deux métiers de récolte seuls rapportent des matériaux, pas des produits finis : tu devras vendre à l'HV.",
          "- Un métier sans demande sur ton serveur ne vaut rien. Regarde les prix **avant** de t'y engager.",
          "",
          "🧪 Les meilleures combinaisons de Forever resteront à établir avec les premiers relevés de la communauté. Publie les tiens dans {{ch:crafting-and-shuffles}}."
        ].join("\n")
      },
      {
        key: "prof-2",
        title: "L'armée de personnages secondaires (alt army)",
        body: [
          "Un personnage secondaire (« alt ») qui travaille pour toi peut doubler ta capacité de production.",
          "",
          "**Rôles utiles**",
          "- **Personnage de banque** : stocke matériaux et objets à revendre. Garde son inventaire propre.",
          "- **Personnage de récolte** : un métier de récolte, déplacement efficace, grosses zones.",
          "- **Personnage d'artisanat** : transforme ce que les autres récoltent.",
          "- **Personnage de vente** : gère l'HV (voir {{ch:addons-and-setup}}).",
          "",
          "**Conseils**",
          "- Utilise la **poste** pour déplacer matériaux et or entre tes personnages.",
          "- Garde les mêmes noms/logiques de tri sur tous les personnages.",
          "- Ne crée pas plus d'alts que tu peux gérer : chaque alt demande du temps de connexion.",
          "",
          "⚠️ Les règles de la poste, les limites de personnages par compte et les capacités de banque peuvent différer en Forever. Vérifie en jeu."
        ].join("\n")
      },
      {
        key: "prof-3",
        title: "Délais de fabrication (cooldowns) et organisation",
        body: [
          "Certaines recettes ne peuvent être fabriquées qu'**une fois par période** (cooldown). Elles servent surtout aux métiers de fabrication avancés.",
          "",
          "**Comment s'organiser**",
          "- Note, pour chaque personnage, **la recette, la durée du délai et le moment où elle sera prête**.",
          "- Un addon de suivi des métiers ou un tableau simple suffit (voir {{ch:addons-and-setup}}).",
          "- Lance le délai **dès qu'il est prêt** : un délai qui attend, c'est de l'or perdu.",
          "- Ne fabrique jamais sans vérifier le prix de revente : certaines recettes à délai ne sont rentables que si le marché les achète.",
          "",
          "⚠️ Les noms, durées et rentabilité des recettes à délai dépendent de la version du jeu. Vérifie l'infobulle de la recette dans Forever et partage tes relevés dans {{ch:rare-drops-and-formulas}} ou {{ch:crafting-and-shuffles}}."
        ].join("\n")
      }
    ]
  },
  {
    name: "addons-and-setup",
    topic: "Addons utiles pour le goldmaking, configuration, macros et recommandations d'interface.",
    posts: [
      {
        key: "addons-1",
        title: "Addons utiles pour faire de l'or",
        body: [
          "⚠️ **Compatibilité** : vérifie toujours que la version d'un addon est compatible avec WoW Forever (page de l'addon, numéro d'interface, date de mise à jour) avant de l'installer. Installe-les uniquement depuis les sites officiels (CurseForge, WoWInterface, etc.).",
          "",
          "**Hôtel des ventes**",
          "- **Auctionator** — recherche d'enchères plus rapide, historique de prix, listes d'achat.",
          "- **TradeSkillMaster (TSM)** — outils avancés de vente, d'artisanat et de statistiques. Demande du temps de configuration. À réserver aux joueurs à l'aise.",
          "",
          "**Récolte**",
          "- **GatherMate2** — enregistre les nœuds de minerai, d'herbes et de poissons sur la carte.",
          "",
          "**Inventaire et confort**",
          "- **Bagnon / Baganator** (ou équivalent) — un seul sac unifié, recherche d'objets entre personnages.",
          "- **Leatrix Plus** — nombreuses options de confort (vente automatique des objets gris, pillage rapide, etc.).",
          "",
          "**Organisation de la guilde**",
          "- **Guilded** — l'outil de la guilde pour la gestion des raids et des personnages (à utiliser seulement si ta guilde s'en sert)."
        ].join("\n")
      },
      {
        key: "addons-2",
        title: "Réglages et interface recommandés",
        body: [
          "**Réglages du jeu**",
          "- Active le **pillage rapide** (auto-loot) pour gagner du temps.",
          "- Garde un sac séparé (ou une section) pour les matériaux.",
          "",
          "**Interface**",
          "- Place la **mini-carte** et le suivi (repérage de minerais, d'herbes, etc.) à un endroit facile à voir.",
          "- Barres d'actions avec les sorts de farm principaux à portée de la souris.",
          "- Garde l'interface simple : trop d'addons ralentissent le jeu et distraient.",
          "",
          "**Macros** 🧪 (exemple à adapter, à tester en jeu avant de s'y fier)",
          "```",
          "#showtooltip",
          "/cast [mod:shift] Find Herbs; Find Minerals",
          "```",
          "Les noms de sorts de repérage dépendent de ta classe, de ton métier et de la langue du client. Adapte-les.",
          "",
          "**Sécurité**",
          "- N'installe jamais d'addon trouvé sur un lien partagé par un inconnu.",
          "- Ne partage jamais tes identifiants Battle.net."
        ].join("\n")
      }
    ]
  }
];
