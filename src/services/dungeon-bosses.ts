// The bosses of each Season 1 dungeon, as the addon reports them (Forever native encounter ids). Facts only: each boss name with every
// encounter id it has been recorded under (the guild's own runs of 10-14 November 2026 and the game's journal ids), written for this
// project; no other addon's files or text are used. A dungeon without an entry has no boss list: the bot treats its runs as having no
// boss information.
//
// - ids: one boss can carry several ids (the journal id and the native encounter id). Any of them counts as a kill.
// - final: ends the dungeon. Exactly one per dungeon.
// - optional: a rare or secret boss. It is not part of the "all bosses" total and killing it adds nothing, so a normal full clear never
//   looks like a skip because of it.
// Scarlet Monastery shares one map (189); each wing has its own list under the key "189:<wing>", told apart by the wing's last boss.

export interface RouteBoss {
  ids: readonly number[];
  name: string;
  final?: boolean;
  optional?: boolean;
}

export interface RouteBosses { key: string; instanceId: number; name: string; bosses: readonly RouteBoss[] }

export const ROUTE_BOSSES: readonly RouteBosses[] = [
  { key: "389", instanceId: 389, name: "Ragefire Chasm", bosses: [
    { ids: [430, 2732], name: "Oggleflint" },
    { ids: [431, 2733], name: "Taragaman the Hungerer" },
    { ids: [432, 2734], name: "Jergosh the Invoker" },
    { ids: [433, 2735], name: "Bazzalan", final: true }
  ] },
  { key: "3065", instanceId: 3065, name: "The Hall of Thanes", bosses: [
    { ids: [3493], name: "Faldrim Anvilmar" },
    { ids: [3494], name: "Plunder" },
    { ids: [3496], name: "Durgen Dirgehammer", final: true }
  ] },
  { key: "43", instanceId: 43, name: "Wailing Caverns", bosses: [
    { ids: [585], name: "Lady Anacondra" },
    { ids: [586], name: "Lord Cobrahn" },
    { ids: [587], name: "Kresh" },
    { ids: [588], name: "Lord Pythas" },
    { ids: [589], name: "Skum" },
    { ids: [590], name: "Lord Serpentis" },
    { ids: [591], name: "Verdan the Everliving" },
    { ids: [592], name: "Mutanus the Devourer", final: true }
  ] },
  { key: "2999", instanceId: 2999, name: "Ruins of Lordaeron", bosses: [
    { ids: [3353], name: "Witherfang" },
    { ids: [3354], name: "Rath'mael", final: true },
    { ids: [3357], name: "The Abandoned" },
    { ids: [3408], name: "Lordaeron Captain" },
    { ids: [3411], name: "Viktor the Vile", optional: true },
    { ids: [3412], name: "Bjork" },
    { ids: [3355], name: "The Butcher", optional: true }
  ] },
  { key: "36", instanceId: 36, name: "The Deadmines", bosses: [
    { ids: [161, 2741], name: "Rhahk'Zor" },
    { ids: [162, 2742], name: "Sneed" },
    { ids: [163, 2743], name: "Gilnid" },
    { ids: [164, 2745], name: "Mr. Smite" },
    { ids: [165, 2746], name: "Cookie", optional: true },
    { ids: [166, 2744], name: "Captain Greenskin" },
    { ids: [167, 2747], name: "Edwin VanCleef", final: true }
  ] },
  { key: "33", instanceId: 33, name: "Shadowfang Keep", bosses: [
    { ids: [464, 2748], name: "Rethilgore" },
    { ids: [465, 2749], name: "Razorclaw the Butcher" },
    { ids: [466, 2750], name: "Baron Silverlaine" },
    { ids: [467, 2751], name: "Commander Springvale" },
    { ids: [468, 2752], name: "Odo the Blindwatcher" },
    { ids: [469, 2753], name: "Fenrus the Devourer" },
    { ids: [470, 2754], name: "Wolf Master Nandos" },
    { ids: [471, 2755], name: "Archmage Arugal", final: true }
  ] },
  { key: "34", instanceId: 34, name: "The Stockade", bosses: [
    { ids: [2756], name: "Targorr the Dread" },
    { ids: [2757], name: "Kam Deepfury" },
    { ids: [2758], name: "Hamhock" },
    { ids: [2759], name: "Dextren Ward" },
    { ids: [2760], name: "Bazil Thredd", final: true }
  ] },
  { key: "48", instanceId: 48, name: "Blackfathom Deeps", bosses: [
    { ids: [219, 2761, 2916], name: "Ghamoo-ra" },
    { ids: [220, 2762, 2915], name: "Lady Sarevess" },
    { ids: [221, 2763, 2914], name: "Gelihast" },
    { ids: [222], name: "Lorgus Jett", optional: true },
    { ids: [224, 2765, 2912], name: "Old Serra'kis" },
    { ids: [225, 2766, 2911], name: "Twilight Lord Kelris" },
    { ids: [226, 2767, 2910], name: "Aku'mai", final: true }
  ] },
  { key: "129", instanceId: 129, name: "Razorfen Downs", bosses: [
    { ids: [434, 2780], name: "Tuten'kash" },
    { ids: [435, 2782], name: "Mordresh Fire Eye" },
    { ids: [436, 2784], name: "Glutton" },
    { ids: [437, 2785], name: "Amnennar the Coldbringer", final: true },
    { ids: [2781], name: "Plaguemaw the Rotting" },
    { ids: [2783], name: "Ragglesnout" }
  ] },
  { key: "2998", instanceId: 2998, name: "Excavation Site: Wetlands", bosses: [
    { ids: [3480], name: "Saltspine" },
    { ids: [3481], name: "Shadetooth" },
    { ids: [3482], name: "Relic Guardian", final: true }
  ] },
  { key: "189:graveyard", instanceId: 189, name: "Scarlet Monastery: Graveyard", bosses: [
    { ids: [444], name: "Interrogator Vishas" },
    { ids: [445, 2779], name: "Bloodmage Thalnos", final: true }
  ] },
  { key: "2959", instanceId: 2959, name: "City of Dalaran", bosses: [
    { ids: [3298], name: "Arcane Anomaly" },
    { ids: [3299], name: "Fel Ancient" },
    { ids: [3300], name: "Mana Devourer" },
    { ids: [3302], name: "Unstable Sentinel" },
    { ids: [3303], name: "Shade of the Archmage", final: true },
    { ids: [3310], name: "Lyn the Ignored", optional: true },
    { ids: [3311], name: "Atrexis the Grave Knight" },
    { ids: [3301], name: "Mana Elemental", optional: true }
  ] },
  { key: "90", instanceId: 90, name: "Gnomeregan", bosses: [
    { ids: [378, 2769], name: "Viscous Fallout" },
    { ids: [379, 2768], name: "Grubbis" },
    { ids: [380, 2770], name: "Electrocutioner 6000" },
    { ids: [381, 2771], name: "Crowd Pummeler 9-60" },
    { ids: [382, 2772], name: "Mekgineer Thermaplugg", final: true }
  ] },
  { key: "47", instanceId: 47, name: "Razorfen Kraul", bosses: [
    { ids: [439, 2774], name: "Aggem Thorncurse" },
    { ids: [440, 2775], name: "Death Speaker Jargba" },
    { ids: [441, 2776], name: "Overlord Ramtusk" },
    { ids: [443, 2778], name: "Charlga Razorflank", final: true },
    { ids: [883, 2777], name: "Agathelos the Raging" },
    { ids: [2773], name: "Roogug" }
  ] },
  { key: "189:library", instanceId: 189, name: "Scarlet Monastery: Library", bosses: [
    { ids: [446], name: "Houndmaster Loksey" },
    { ids: [447], name: "Arcanist Doan", final: true }
  ] },
  { key: "189:armory", instanceId: 189, name: "Scarlet Monastery: Armory", bosses: [
    { ids: [448], name: "Herod", final: true }
  ] },
  { key: "189:cathedral", instanceId: 189, name: "Scarlet Monastery: Cathedral", bosses: [
    { ids: [449], name: "High Inquisitor Fairbanks" },
    { ids: [450], name: "High Inquisitor Whitemane", final: true }
  ] },
  { key: "70", instanceId: 70, name: "Uldaman", bosses: [
    { ids: [547], name: "Revelosh" },
    { ids: [548], name: "The Lost Dwarves" },
    { ids: [549], name: "Ironaya" },
    { ids: [551], name: "Ancient Stone Keeper" },
    { ids: [552], name: "Galgann Firehammer" },
    { ids: [553], name: "Grimlok" },
    { ids: [554], name: "Archaedas", final: true },
    { ids: [1887], name: "Obsidian Sentinel", optional: true }
  ] },
  { key: "2970", instanceId: 2970, name: "The Drowned City", bosses: [
    { ids: [3474], name: "Zul'Alai" },
    { ids: [3475], name: "Var'Taka" },
    { ids: [3476], name: "Captain Dreadrise" },
    { ids: [3478], name: "Deathless Guardians" },
    { ids: [3479], name: "Min'loth the Serpent", final: true },
    { ids: [3511], name: "Primeval Elemental" }
  ] }
];

/** Every list of this instance (Scarlet Monastery has four, one per wing); empty when the dungeon has no boss list. */
export const routesOfInstance = (instanceId: number): readonly RouteBosses[] => ROUTE_BOSSES.filter((route) => route.instanceId === instanceId);

/** The single list of an instance, or null when it has none or several wings (use `routesOfInstance`). */
export const routeBosses = (instanceId: number): RouteBosses | null => {
  const routes = routesOfInstance(instanceId);
  return routes.length === 1 ? routes[0]! : null;
};

export const bossKillNormalName = (name: unknown): string => typeof name === "string" ? name.toLowerCase().replace(/[^a-z0-9]/g, "") : "";

/** Whether a recorded encounter (by id, or by name when the id is unknown to us) is this boss. */
export const isBoss = (boss: RouteBoss, event: { id?: unknown; name?: unknown }): boolean =>
  (typeof event.id === "number" && boss.ids.includes(event.id)) || (!!bossKillNormalName(event.name) && bossKillNormalName(event.name) === bossKillNormalName(boss.name));

/** The boss that ends this dungeon, or null when the bot has no (single) boss list for it. */
export const finalBossOf = (instanceId: number): RouteBoss | null => routeBosses(instanceId)?.bosses.find((boss) => boss.final) ?? null;

/** Dungeons whose unfinished runs may be completed at their final boss kill (dungeon-recovery.ts): only where an older addon did not know that boss. */
const RECOVERABLE_INSTANCES: ReadonlySet<number> = new Set([2970]);
export const recoverableFinalBoss = (instanceId: number): RouteBoss | null => RECOVERABLE_INSTANCES.has(instanceId) ? finalBossOf(instanceId) : null;
