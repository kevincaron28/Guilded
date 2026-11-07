// The achievement catalogue: every achievement a member can earn, in one place. Each one is computed from
// data the bot already recorded (synced characters, stored dungeon runs, officer-taken raid attendance, the
// participation ledger, the member's own PoE2 client log). Nothing here is self-reported, and none of it
// awards points. The evaluator is src/services/achievements.ts; the card is achievementsCard in end-cards.ts.
//
// Adding one: add a row, keep the id stable forever (it is stored), and add the threshold to the metric's
// facts if it is a new metric. French text is part of the row, so no separate i18n entry is needed.

import { POE_TRACKING_ENABLED } from "../../companion/active-games.mjs";
export type AchievementGame = "wow" | "poe2" | "guild";
export type AchievementTier = "bronze" | "silver" | "gold" | "platinum" | "epic" | "legendary";

/** Bumped whenever rows are added that older data can already satisfy; guilds that announce re-baseline quietly once. */
export const ACHIEVEMENT_CATALOGUE_VERSION = 7;

/**
 * What is measured:
 * - wowLevel / wowMaxLevel: the original edition-less level rows. They are legacy: kept so rows already earned stay
 *   earned, never awarded again (the edition rows below replace them).
 * - wowEditionLevel: the highest level among the member's synced characters of ONE edition (def.edition).
 * - wowEditionCap: characters of that edition standing at its level cap (threshold = how many).
 * - wowEditionProfession: the highest profession skill on a character of that edition.
 * - dungeonRuns: valid, completed dungeon runs the member took part in.
 * - raidsAttended: completed guild raids where an officer recorded the member present, late or benched.
 * - raidClears: those raids where every boss was marked defeated.
 * - activeDays: distinct days with recorded Discord participation (messages, reactions or voice).
 * - dungeonVariety: distinct dungeons completed (the first completion of each).
 * - professionSkill: the highest profession skill among the member's synced characters.
 * - poeLevel: the highest PoE2 character level the member's own client log reported.
 * - poeMaps: distinct PoE2 map instances the member's companion recorded.
 * - messagesSent / reactionsGiven / reactionsReceived / voiceHours: Discord activity totals. Guilded keeps a
 *   counter per member (numbers only, never message text) from the day counting started; the larger of that
 *   counter and the season participation record is used, so earlier tracked activity still counts.
 * - communityPoints: points earned on the guild's community leaderboards (awards minus reversals).
 * - epEarned: effort points (EP) the raid ledger awarded.
 * - honorableKills: the member's lifetime honorable kills, as their own addon reported (milestones the companion uploads).
 * - duelStreak: the longest run of counted duel wins in a row.
 * - beatTopDuelist: 1 once the member has a counted win over the guild's current #1 duelist (who needs 3+ wins).
 * - duelWins: duels the member won against another member of the guild (counted duels only, see services/duels.ts).
 * - mvpWeeks: weeks the member was named MVP of the week (the community honors record).
 * - serverAnniversaries: server anniversaries (the Discord server's birthday, from its creation date) that came
 *   while the member was on the server. The member's start is when Guilded first recorded them.
 */
export type AchievementMetric = "wowLevel" | "wowMaxLevel" | "dungeonRuns" | "dungeonVariety" | "professionSkill" | "raidsAttended" | "raidClears" | "activeDays" | "poeLevel" | "poeMaps" | "wowEditionLevel" | "wowEditionCap" | "wowEditionProfession" | "messagesSent" | "voiceHours" | "reactionsGiven" | "reactionsReceived" | "communityPoints" | "epEarned" | "mvpWeeks" | "serverAnniversaries" | "honorableKills" | "duelWins" | "duelStreak" | "beatTopDuelist";

export interface AchievementText { name: string; description: string }
export interface AchievementDef {
  id: string;
  game: AchievementGame;
  tier: AchievementTier;
  metric: AchievementMetric;
  threshold: number;
  /** Position in a long progression (1 = first step); the badge shows that many pips so same-tier steps differ. */
  rank?: number;
  /** WoW edition this row belongs to; it is evaluated from characters of that edition only. */
  edition?: WowEdition;
  /** Replaced by edition rows: never awarded again, but an already earned row stays earned and is shown. */
  legacy?: boolean;
  en: AchievementText;
  fr: AchievementText;
}

// Level caps per WoW edition (checked 2 Nov 2026): WoW Forever is fixed at 60 (growth is horizontal), Era 60,
// TBC 70, Mists Classic and Retail (Midnight) 90. Anything not listed counts as 60. PoE2 caps at 100.
export const WOW_LEVEL_CAP: Record<string, number> = { forever: 60, "classic-era": 60, "classic-tbc": 70, "classic-mists": 90, retail: 90 };
export const wowLevelCap = (edition: string | null | undefined) => WOW_LEVEL_CAP[edition ?? "forever"] ?? 60;

export type WowEdition = "forever" | "classic-era" | "classic-tbc" | "classic-mists" | "retail";
export const WOW_EDITIONS: readonly WowEdition[] = ["forever", "classic-era", "classic-tbc", "classic-mists", "retail"];
/** `label` heads the website section; `short` prefixes the achievement names. */
export const EDITION_LABEL: Record<WowEdition, { en: string; fr: string; short: string }> = {
  forever: { en: "WoW Forever", fr: "WoW Forever", short: "Forever" }, "classic-era": { en: "Classic Era", fr: "Classic Era", short: "Era" },
  "classic-tbc": { en: "TBC Classic", fr: "TBC Classic", short: "TBC" }, "classic-mists": { en: "Mists Classic", fr: "Mists Classic", short: "Mists" },
  retail: { en: "Retail", fr: "Retail", short: "Retail" }
};
/**
 * Editions whose achievements are in the catalogue (version 7: WoW Forever only). The other editions keep their level
 * caps and labels above, and their ids are in RETIRED_ACHIEVEMENT_IDS. To bring one back, add it here AND remove its ids
 * from the retired list (docs/FOREVER_ONLY_FOCUS.md).
 */
export const CATALOGUE_EDITIONS: readonly WowEdition[] = ["forever"];
// Highest profession skill per edition (Forever and Era 300, TBC 375, Mists 600). Retail's skill is per expansion, so it has no profession rows.
const PROFESSION_STEPS: Partial<Record<WowEdition, number[]>> = { forever: [150, 300], "classic-era": [150, 300], "classic-tbc": [150, 300, 375], "classic-mists": [150, 300, 450, 600] };
/** Two rows share a progression (and a "next" slot) only if they share this key. */
export const ladderKey = (def: AchievementDef) => `${def.metric}:${def.edition ?? ""}`;

const def = (id: string, game: AchievementGame, tier: AchievementTier, metric: AchievementMetric, threshold: number, en: [string, string], fr: [string, string]): AchievementDef =>
  ({ id, game, tier, metric, threshold, en: { name: en[0], description: en[1] }, fr: { name: fr[0], description: fr[1] } });

const grouped = (n: number, fr: boolean) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, fr ? "\u00a0" : ",");
type Step = [threshold: number, tier: AchievementTier, en: string, fr: string];
/** A long progression: one row per step, same metric and glyph, tier rising with the number. Ids are `${prefix}-${threshold}`. */
function ladder(prefix: string, metric: AchievementMetric, steps: Step[], text: (n: number, fr: boolean) => string): AchievementDef[] {
  return steps.map(([threshold, tier, en, fr], i) => ({
    id: `${prefix}-${threshold}`, game: "guild" as const, tier, metric, threshold, rank: i + 1,
    en: { name: en, description: text(threshold, false) }, fr: { name: fr, description: text(threshold, true) }
  }));
}
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

const ACTIVITY_LADDERS: AchievementDef[] = [
  ...ladder("messages", "messagesSent", [
    [100, "bronze", "First Words", "Premiers mots"], [500, "bronze", "Chatterbox", "Moulin à paroles"], [1000, "silver", "Regular Poster", "Habitué du clavardage"],
    [2500, "silver", "Town Crier", "Crieur public"], [5000, "gold", "Voice of the Guild", "Voix de la guilde"], [10000, "gold", "Silver Tongue", "Langue d'argent"],
    [25000, "platinum", "Orator", "Orateur"], [50000, "platinum", "Bard of Legend", "Barde de légende"], [100000, "epic", "Living Archive", "Archive vivante"],
    [250000, "legendary", "Never Stops Talking", "Intarissable"]
  ], (n, fr) => fr ? `Envoyer ${grouped(n, true)} messages sur le Discord de la guilde.` : `Send ${grouped(n, false)} messages in the guild's Discord.`),
  ...ladder("voice-hours", "voiceHours", [
    [1, "bronze", "Mic Check", "Test du micro"], [10, "bronze", "Voice Chat Regular", "Habitué du vocal"], [25, "silver", "Comms Specialist", "Spécialiste des comms"],
    [50, "silver", "Fireside Storyteller", "Conteur au coin du feu"], [100, "gold", "Hundred Hours Aloud", "Cent heures de vocal"], [250, "platinum", "Callsign Veteran", "Vétéran des ondes"],
    [500, "epic", "Voice of the Hall", "Voix de la grande salle"], [1000, "legendary", "Always On Comms", "Toujours au vocal"]
  ], (n, fr) => fr ? `Passer ${grouped(n, true)} ${plural(n, "heure", "heures")} en vocal avec d'autres membres.` : `Spend ${grouped(n, false)} ${plural(n, "hour", "hours")} in voice channels with other members.`),
  ...ladder("reactions-given", "reactionsGiven", [
    [25, "bronze", "Thumbs Up", "Pouce en l'air"], [100, "silver", "Cheerleader", "Meneur de claque"], [250, "silver", "Applause", "Applaudissements"],
    [1000, "gold", "Hype Machine", "Machine à enthousiasme"], [2500, "platinum", "Morale Booster", "Booster de moral"], [5000, "epic", "Beacon of Positivity", "Phare de positivité"],
    [10000, "legendary", "Reaction Legend", "Légende des réactions"]
  ], (n, fr) => fr ? `Réagir à ${grouped(n, true)} messages de la guilde.` : `React to ${grouped(n, false)} messages in the guild.`),
  ...ladder("reactions-received", "reactionsReceived", [
    [10, "bronze", "Noticed", "Remarqué"], [50, "silver", "Well Liked", "Apprécié"], [250, "gold", "Crowd Favourite", "Chouchou du public"],
    [1000, "platinum", "Guild Icon", "Icône de la guilde"], [5000, "epic", "Beloved", "Adulé"]
  ], (n, fr) => fr ? `Recevoir ${grouped(n, true)} réactions sur vos messages.` : `Receive ${grouped(n, false)} reactions on your messages.`),
  ...ladder("points", "communityPoints", [
    [100, "bronze", "Contributor", "Contributeur"], [500, "bronze", "Steady Earner", "Gagnant constant"], [1000, "silver", "Point Collector", "Collectionneur de points"],
    [2500, "gold", "Season Standout", "Éclat de la saison"], [5000, "platinum", "Leaderboard Climber", "Grimpeur du classement"], [10000, "epic", "Top of the Board", "Tête du classement"],
    [25000, "legendary", "Hall of Fame", "Temple de la renommée"]
  ], (n, fr) => fr ? `Gagner ${grouped(n, true)} points communautaires au classement de la guilde.` : `Earn ${grouped(n, false)} community points on the guild leaderboards.`),
  ...ladder("ep", "epEarned", [
    [100, "bronze", "EP Initiate", "Initié des PE"], [500, "silver", "Effort Rewarded", "Effort récompensé"], [2000, "gold", "Pillar of Effort", "Pilier de l'effort"], [10000, "epic", "Effort Incarnate", "Effort incarné"]
  ], (n, fr) => fr ? `Gagner ${grouped(n, true)} points d'effort (PE) dans le registre de raid.` : `Earn ${grouped(n, false)} effort points (EP) in the raid ledger.`),
  ...ladder("mvp-weeks", "mvpWeeks", [
    [1, "bronze", "MVP of the Week", "MVP de la semaine"], [3, "silver", "Triple Threat", "Triple menace"], [5, "gold", "Perennial MVP", "MVP perpétuel"],
    [10, "platinum", "Ten-Time MVP", "MVP dix fois"], [25, "epic", "Dynasty", "Dynastie"]
  ], (n, fr) => fr ? `Être nommé MVP de la semaine ${n} ${plural(n, "fois", "fois")}.` : `Be named MVP of the week ${n} ${plural(n, "time", "times")}.`),
  ...ladder("honorable-kills", "honorableKills", [
    [1, "bronze", "First Blood", "Premier sang"], [100, "silver", "Honor Seeker", "Chercheur d'honneur"], [500, "gold", "Warmonger", "Belliciste"],
    [1000, "epic", "Thousand Fallen", "Mille vaincus"]
  ], (n, fr) => fr ? `Obtenir ${grouped(n, true)} ${plural(n, "mise à mort honorable", "mises à mort honorables")} (JcJ).` : `Score ${grouped(n, false)} honorable ${plural(n, "kill", "kills")} in PvP.`),
  ...ladder("duel-wins", "duelWins", [
    [1, "bronze", "First Duel Won", "Premier duel gagné"], [10, "silver", "Duelist", "Duelliste"], [50, "gold", "Blademaster", "Maître d'armes"],
    [100, "epic", "Duel Champion", "Champion des duels"]
  ], (n, fr) => fr ? `Gagner ${grouped(n, true)} ${plural(n, "duel", "duels")} contre des membres de la guilde.` : `Win ${grouped(n, false)} ${plural(n, "duel", "duels")} against guild members.`),
  ...ladder("anniversary", "serverAnniversaries", [
    [1, "bronze", "Anniversary Guest", "Invité d'anniversaire"], [2, "silver", "Two Candles", "Deux chandelles"], [3, "gold", "Triple Toast", "Triple toast"],
    [5, "platinum", "High Five", "Haut les cinq"], [10, "legendary", "Decade Strong", "Une décennie ensemble"]
  ], (n, fr) => fr ? `Être sur le serveur pour ${n} ${plural(n, "anniversaire", "anniversaires")} du serveur.` : `Be on the server for ${n} server ${plural(n, "anniversary", "anniversaries")}.`)
];

const tierFor = (value: number, cap: number): AchievementTier => value >= cap ? "epic" : value / cap >= 0.7 ? "gold" : value / cap >= 0.4 ? "silver" : "bronze";

/** Per edition: a level step every 10 levels up to that edition's cap (so none is unreachable), the cap, three characters at it, and profession steps. */
const EDITION_ACHIEVEMENTS: AchievementDef[] = CATALOGUE_EDITIONS.flatMap(edition => {
  const cap = WOW_LEVEL_CAP[edition]!, { short } = EDITION_LABEL[edition], label = EDITION_LABEL[edition];
  const base = { game: "wow" as const, edition };
  const levels: number[] = [];
  for (let level = 10; level < cap; level += 10) levels.push(level);
  levels.push(cap);
  const rows: AchievementDef[] = levels.map((level, i) => ({
    ...base, id: `wow-${edition}-level-${level}`, tier: tierFor(level, cap), metric: "wowEditionLevel" as const, threshold: level, rank: i + 1,
    en: { name: `${short}: Level ${level}${level === cap ? " (Max)" : ""}`, description: level === cap ? `Reach the level cap (${level}) on a ${label.en} character.` : `Reach level ${level} on a ${label.en} character.` },
    fr: { name: `${short} : niveau ${level}${level === cap ? " (max)" : ""}`, description: level === cap ? `Atteindre le niveau maximum (${level}) avec un personnage ${label.fr}.` : `Atteindre le niveau ${level} avec un personnage ${label.fr}.` }
  }));
  rows.push({
    ...base, id: `wow-${edition}-alts-3`, tier: "epic", metric: "wowEditionCap", threshold: 3,
    en: { name: `${short}: Army of Alts`, description: `Have three ${label.en} characters at the level cap (${cap}).` },
    fr: { name: `${short} : armée de rerolls`, description: `Avoir trois personnages ${label.fr} au niveau maximum (${cap}).` }
  });
  const skills = PROFESSION_STEPS[edition] ?? [];
  skills.forEach((skill, i) => rows.push({
    ...base, id: `wow-${edition}-profession-${skill}`, tier: tierFor(skill, skills[skills.length - 1]!), metric: "wowEditionProfession", threshold: skill, rank: i + 1,
    en: { name: `${short}: Artisan ${skill}`, description: `Reach skill ${skill} in a profession on a ${label.en} character.` },
    fr: { name: `${short} : artisan ${skill}`, description: `Atteindre la compétence ${skill} dans un métier avec un personnage ${label.fr}.` }
  }));
  return rows;
});

const BASE_ACHIEVEMENTS: AchievementDef[] = [
  // Guild dungeon runs.
  def("dungeon-runs-1", "guild", "bronze", "dungeonRuns", 1, ["First Descent", "Complete a guild dungeon run."], ["Première descente", "Terminer un donjon de guilde."]),
  def("dungeon-runs-10", "guild", "bronze", "dungeonRuns", 10, ["Dungeon Regular", "Complete 10 guild dungeon runs."], ["Habitué des donjons", "Terminer 10 donjons de guilde."]),
  def("dungeon-runs-25", "guild", "silver", "dungeonRuns", 25, ["Dungeon Delver", "Complete 25 guild dungeon runs."], ["Fouilleur de donjons", "Terminer 25 donjons de guilde."]),
  def("dungeon-runs-50", "guild", "gold", "dungeonRuns", 50, ["Dungeon Veteran", "Complete 50 guild dungeon runs."], ["Vétéran des donjons", "Terminer 50 donjons de guilde."]),
  def("dungeon-runs-100", "guild", "epic", "dungeonRuns", 100, ["Centurion of the Depths", "Complete 100 guild dungeon runs."], ["Centurion des profondeurs", "Terminer 100 donjons de guilde."]),

  def("dungeon-variety-1", "guild", "bronze", "dungeonVariety", 1, ["First Dungeon Clear", "Complete your first dungeon with the guild."], ["Premier donjon terminé", "Terminer votre premier donjon avec la guilde."]),
  def("dungeon-variety-10", "guild", "gold", "dungeonVariety", 10, ["Dungeon Collector", "Complete 10 different dungeons with the guild."], ["Collectionneur de donjons", "Terminer 10 donjons différents avec la guilde."]),
  def("duel-streak-5", "guild", "gold", "duelStreak", 5, ["Unbeaten", "Win 5 guild duels in a row."], ["Invaincu", "Gagner 5 duels de guilde d'affilée."]),
  def("duel-beat-top", "guild", "epic", "beatTopDuelist", 1, ["Giant Slayer", "Beat the guild's top duelist in a duel."], ["Tueur de géant", "Battre le meilleur duelliste de la guilde en duel."]),
  def("dungeon-variety-5", "guild", "silver", "dungeonVariety", 5, ["Dungeon Explorer", "Complete 5 different dungeons with the guild."], ["Explorateur de donjons", "Terminer 5 donjons différents avec la guilde."]),

  // Guild raids: attendance an officer recorded, and full clears.
  def("raids-1", "guild", "bronze", "raidsAttended", 1, ["Into the Raid", "Attend a guild raid."], ["Au raid", "Participer à un raid de guilde."]),
  def("raids-5", "guild", "bronze", "raidsAttended", 5, ["Raid Regular", "Attend 5 guild raids."], ["Habitué des raids", "Participer à 5 raids de guilde."]),
  def("raids-10", "guild", "silver", "raidsAttended", 10, ["Raid Stalwart", "Attend 10 guild raids."], ["Pilier du raid", "Participer à 10 raids de guilde."]),
  def("raids-25", "guild", "gold", "raidsAttended", 25, ["Raid Veteran", "Attend 25 guild raids."], ["Vétéran des raids", "Participer à 25 raids de guilde."]),
  def("raids-50", "guild", "epic", "raidsAttended", 50, ["Raid Legend", "Attend 50 guild raids."], ["Légende des raids", "Participer à 50 raids de guilde."]),
  def("raid-clears-1", "guild", "silver", "raidClears", 1, ["Clean Sweep", "Attend a raid where every boss was defeated."], ["Balayage complet", "Participer à un raid où tous les boss ont été vaincus."]),
  def("raid-clears-5", "guild", "gold", "raidClears", 5, ["Boss Slayer", "Attend 5 raids where every boss was defeated."], ["Tueur de boss", "Participer à 5 raids où tous les boss ont été vaincus."]),
  def("raid-clears-10", "guild", "epic", "raidClears", 10, ["Unstoppable", "Attend 10 raids where every boss was defeated."], ["Inarrêtable", "Participer à 10 raids où tous les boss ont été vaincus."]),

  // Participation in the guild's Discord.
  def("active-days-7", "guild", "bronze", "activeDays", 7, ["Regular Voice", "Be active in the guild's Discord on 7 different days."], ["Voix régulière", "Être actif sur le Discord de la guilde pendant 7 jours différents."]),
  def("active-days-30", "guild", "silver", "activeDays", 30, ["Pillar of the Community", "Be active in the guild's Discord on 30 different days."], ["Pilier de la communauté", "Être actif sur le Discord de la guilde pendant 30 jours différents."]),
  def("active-days-100", "guild", "gold", "activeDays", 100, ["Heart of the Guild", "Be active in the guild's Discord on 100 different days."], ["Cœur de la guilde", "Être actif sur le Discord de la guilde pendant 100 jours différents."]),

  // Discord activity, community points and EP: long progressions (see ACTIVITY_LADDERS above).
  ...ACTIVITY_LADDERS,

  // WoW per edition (levels, level cap, profession skill).
  ...EDITION_ACHIEVEMENTS
];

/**
 * Achievement ids that left the catalogue in version 7 (only WoW Forever and guild rows remain). Never reuse one. Rows
 * already earned stay in `MemberAchievement` (history, and the way back), but nothing that is not in ACHIEVEMENTS is
 * evaluated, announced, counted or shown, whatever the edition or game switches say.
 */
export const RETIRED_ACHIEVEMENT_IDS: readonly string[] = [
  // The edition-less WoW rows (replaced by the per-edition rows in catalogue 6).
  "wow-level-20", "wow-level-40", "wow-level-60", "wow-level-80", "wow-max-level", "wow-max-level-3", "profession-150", "profession-300",
  // Path of Exile 2 (levels, maps).
  "poe2-level-75", "poe2-level-90", "poe2-level-99", "poe2-level-100", "poe2-maps-100", "poe2-maps-500",
  // Classic Era.
  "wow-classic-era-level-10", "wow-classic-era-level-20", "wow-classic-era-level-30", "wow-classic-era-level-40", "wow-classic-era-level-50", "wow-classic-era-level-60", "wow-classic-era-alts-3", "wow-classic-era-profession-150", "wow-classic-era-profession-300",
  // TBC Classic.
  "wow-classic-tbc-level-10", "wow-classic-tbc-level-20", "wow-classic-tbc-level-30", "wow-classic-tbc-level-40", "wow-classic-tbc-level-50", "wow-classic-tbc-level-60", "wow-classic-tbc-level-70", "wow-classic-tbc-alts-3", "wow-classic-tbc-profession-150", "wow-classic-tbc-profession-300", "wow-classic-tbc-profession-375",
  // Mists Classic.
  "wow-classic-mists-level-10", "wow-classic-mists-level-20", "wow-classic-mists-level-30", "wow-classic-mists-level-40", "wow-classic-mists-level-50", "wow-classic-mists-level-60", "wow-classic-mists-level-70", "wow-classic-mists-level-80", "wow-classic-mists-level-90", "wow-classic-mists-alts-3", "wow-classic-mists-profession-150", "wow-classic-mists-profession-300", "wow-classic-mists-profession-450", "wow-classic-mists-profession-600",
  // Retail.
  "wow-retail-level-10", "wow-retail-level-20", "wow-retail-level-30", "wow-retail-level-40", "wow-retail-level-50", "wow-retail-level-60", "wow-retail-level-70", "wow-retail-level-80", "wow-retail-level-90", "wow-retail-alts-3"
];

/** Every achievement a member can see or earn. Retired ids (above) are not in it, so no surface can show them. */
export const ACHIEVEMENTS: readonly AchievementDef[] = BASE_ACHIEVEMENTS;
/** What can still be earned (everything in the catalogue; kept as its own name for the surfaces that mean "earnable"). */
export const ACTIVE_ACHIEVEMENTS: readonly AchievementDef[] = ACHIEVEMENTS;

const BY_ID = new Map(ACHIEVEMENTS.map(row => [row.id, row]));
export const achievementById = (id: string): AchievementDef | undefined => BY_ID.get(id);
export const TIER_COLOR: Record<AchievementTier, string> = { bronze: "#cd7f32", silver: "#c9d1d9", gold: "#ffd100", platinum: "#7fe3f5", epic: "#c56cf0", legendary: "#ff6a2e" };
export const TIER_LABEL: Record<AchievementTier, { en: string; fr: string }> = {
  bronze: { en: "Bronze", fr: "Bronze" }, silver: { en: "Silver", fr: "Argent" }, gold: { en: "Gold", fr: "Or" },
  platinum: { en: "Platinum", fr: "Platine" }, epic: { en: "Epic", fr: "Épique" }, legendary: { en: "Legendary", fr: "Légendaire" }
};
export const GAME_LABEL: Record<AchievementGame, { en: string; fr: string }> = {
  wow: { en: "World of Warcraft", fr: "World of Warcraft" }, poe2: { en: "Path of Exile 2", fr: "Path of Exile 2" }, guild: { en: "Guild", fr: "Guilde" }
};
/** Where a row is listed: its WoW edition if it has one, else its game. */
export const groupLabel = (def: AchievementDef, lang: "en" | "fr") => def.edition ? EDITION_LABEL[def.edition][lang] : GAME_LABEL[def.game][lang];

/**
 * Forever-only focus (companion/active-games.mjs): a PoE2 row is shown only while PoE2 tracking is on. The data
 * is never deleted; turning ACTIVE_TRACKING back on makes rows that are still in the catalogue show again.
 */
export const achievementGameVisible = (def: Pick<AchievementDef, "game">, tracking = POE_TRACKING_ENABLED) => def.game !== "poe2" || tracking;
