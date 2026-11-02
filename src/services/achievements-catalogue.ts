// The achievement catalogue: every achievement a member can earn, in one place. Each one is computed from
// data the bot already recorded (synced characters, stored dungeon runs, officer-taken raid attendance, the
// participation ledger, the member's own PoE2 client log). Nothing here is self-reported, and none of it
// awards points. The evaluator is src/services/achievements.ts; the card is achievementsCard in end-cards.ts.
//
// Adding one: add a row, keep the id stable forever (it is stored), and add the threshold to the metric's
// facts if it is a new metric. French text is part of the row, so no separate i18n entry is needed.

export type AchievementGame = "wow" | "poe2" | "guild";
export type AchievementTier = "bronze" | "silver" | "gold" | "epic";

/**
 * What is measured:
 * - wowLevel: the highest level among the member's synced characters.
 * - wowMaxLevel: characters standing at their edition's level cap (threshold = how many).
 * - dungeonRuns: valid, completed dungeon runs the member took part in.
 * - raidsAttended: completed guild raids where an officer recorded the member present, late or benched.
 * - raidClears: those raids where every boss was marked defeated.
 * - activeDays: distinct days with recorded Discord participation (messages, reactions or voice).
 * - dungeonVariety: distinct dungeons completed (the first completion of each).
 * - professionSkill: the highest profession skill among the member's synced characters.
 * - poeLevel: the highest PoE2 character level the member's own client log reported.
 * - poeMaps: distinct PoE2 map instances the member's companion recorded.
 */
export type AchievementMetric = "wowLevel" | "wowMaxLevel" | "dungeonRuns" | "dungeonVariety" | "professionSkill" | "raidsAttended" | "raidClears" | "activeDays" | "poeLevel" | "poeMaps";

export interface AchievementText { name: string; description: string }
export interface AchievementDef {
  id: string;
  game: AchievementGame;
  tier: AchievementTier;
  metric: AchievementMetric;
  threshold: number;
  en: AchievementText;
  fr: AchievementText;
}

// Level caps per WoW edition (checked 2 Nov 2026): WoW Forever is fixed at 60 (growth is horizontal), Era 60,
// TBC 70, Mists Classic and Retail (Midnight) 90. Anything not listed counts as 60. PoE2 caps at 100.
export const WOW_LEVEL_CAP: Record<string, number> = { forever: 60, "classic-era": 60, "classic-tbc": 70, "classic-mists": 90, retail: 90 };
export const wowLevelCap = (edition: string | null | undefined) => WOW_LEVEL_CAP[edition ?? "forever"] ?? 60;

const def = (id: string, game: AchievementGame, tier: AchievementTier, metric: AchievementMetric, threshold: number, en: [string, string], fr: [string, string]): AchievementDef =>
  ({ id, game, tier, metric, threshold, en: { name: en[0], description: en[1] }, fr: { name: fr[0], description: fr[1] } });

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  // WoW: levels, then the level cap.
  def("wow-level-20", "wow", "bronze", "wowLevel", 20, ["Getting Started", "Reach level 20 on a character."], ["Premiers pas", "Atteindre le niveau 20 avec un personnage."]),
  def("wow-level-40", "wow", "silver", "wowLevel", 40, ["Seasoned Adventurer", "Reach level 40 on a character."], ["Aventurier aguerri", "Atteindre le niveau 40 avec un personnage."]),
  def("wow-level-60", "wow", "gold", "wowLevel", 60, ["Sixty and Counting", "Reach level 60 on a character."], ["Soixante et plus", "Atteindre le niveau 60 avec un personnage."]),
  def("wow-level-80", "wow", "epic", "wowLevel", 80, ["Veteran of Azeroth", "Reach level 80 on a character."], ["Vétéran d'Azeroth", "Atteindre le niveau 80 avec un personnage."]),
  def("wow-max-level", "wow", "gold", "wowMaxLevel", 1, ["Maximum Level", "Reach the level cap of your WoW edition."], ["Niveau maximum", "Atteindre le niveau maximum de votre édition de WoW."]),
  def("wow-max-level-3", "wow", "epic", "wowMaxLevel", 3, ["Army of Alts", "Have three characters at the level cap."], ["Armée de rerolls", "Avoir trois personnages au niveau maximum."]),

  // Professions (skill 300 is the Era and Forever cap; later editions go higher).
  def("profession-150", "wow", "bronze", "professionSkill", 150, ["Journeyman Artisan", "Reach skill 150 in a profession."], ["Artisan compagnon", "Atteindre la compétence 150 dans un métier."]),
  def("profession-300", "wow", "gold", "professionSkill", 300, ["Master Artisan", "Reach skill 300 in a profession."], ["Maître artisan", "Atteindre la compétence 300 dans un métier."]),

  // Guild dungeon runs.
  def("dungeon-runs-1", "guild", "bronze", "dungeonRuns", 1, ["First Descent", "Complete a guild dungeon run."], ["Première descente", "Terminer un donjon de guilde."]),
  def("dungeon-runs-10", "guild", "bronze", "dungeonRuns", 10, ["Dungeon Regular", "Complete 10 guild dungeon runs."], ["Habitué des donjons", "Terminer 10 donjons de guilde."]),
  def("dungeon-runs-25", "guild", "silver", "dungeonRuns", 25, ["Dungeon Delver", "Complete 25 guild dungeon runs."], ["Fouilleur de donjons", "Terminer 25 donjons de guilde."]),
  def("dungeon-runs-50", "guild", "gold", "dungeonRuns", 50, ["Dungeon Veteran", "Complete 50 guild dungeon runs."], ["Vétéran des donjons", "Terminer 50 donjons de guilde."]),
  def("dungeon-runs-100", "guild", "epic", "dungeonRuns", 100, ["Centurion of the Depths", "Complete 100 guild dungeon runs."], ["Centurion des profondeurs", "Terminer 100 donjons de guilde."]),

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

  // Path of Exile 2, from the member's own companion (client log).
  def("poe2-level-75", "poe2", "silver", "poeLevel", 75, ["Seasoned Exile", "Reach level 75 in Path of Exile 2."], ["Exilé aguerri", "Atteindre le niveau 75 dans Path of Exile 2."]),
  def("poe2-level-90", "poe2", "gold", "poeLevel", 90, ["Exile Ascendant", "Reach level 90 in Path of Exile 2."], ["Exilé ascendant", "Atteindre le niveau 90 dans Path of Exile 2."]),
  def("poe2-level-99", "poe2", "epic", "poeLevel", 99, ["On the Brink", "Reach level 99 in Path of Exile 2."], ["Au bord du sommet", "Atteindre le niveau 99 dans Path of Exile 2."]),
  def("poe2-level-100", "poe2", "epic", "poeLevel", 100, ["Pinnacle of Wraeclast", "Reach level 100 in Path of Exile 2."], ["Sommet de Wraeclast", "Atteindre le niveau 100 dans Path of Exile 2."]),
  def("poe2-maps-100", "poe2", "silver", "poeMaps", 100, ["Cartographer", "Clear 100 maps in Path of Exile 2."], ["Cartographe", "Parcourir 100 cartes dans Path of Exile 2."]),
  def("poe2-maps-500", "poe2", "gold", "poeMaps", 500, ["Master Cartographer", "Clear 500 maps in Path of Exile 2."], ["Maître cartographe", "Parcourir 500 cartes dans Path of Exile 2."])
];

const BY_ID = new Map(ACHIEVEMENTS.map(row => [row.id, row]));
export const achievementById = (id: string): AchievementDef | undefined => BY_ID.get(id);
export const TIER_COLOR: Record<AchievementTier, string> = { bronze: "#cd7f32", silver: "#c9d1d9", gold: "#ffd100", epic: "#c56cf0" };
export const TIER_LABEL: Record<AchievementTier, { en: string; fr: string }> = {
  bronze: { en: "Bronze", fr: "Bronze" }, silver: { en: "Silver", fr: "Argent" }, gold: { en: "Gold", fr: "Or" }, epic: { en: "Epic", fr: "Épique" }
};
export const GAME_LABEL: Record<AchievementGame, { en: string; fr: string }> = {
  wow: { en: "World of Warcraft", fr: "World of Warcraft" }, poe2: { en: "Path of Exile 2", fr: "Path of Exile 2" }, guild: { en: "Guild", fr: "Guilde" }
};
