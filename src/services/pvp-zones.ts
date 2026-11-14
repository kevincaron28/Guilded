// The zones of the two continents, keyed by the game's map id (uiMapID, the same in every language): a call for help names its zone by
// map id, so a French and an English client land on one zone. A zone name alone (older uploads) is matched by its folded English or French
// name. Where each zone sits on its continent is in pvp-zone-rects.ts.

export type Continent = "kalimdor" | "eastern";
export interface PvpZone { id: number; continent: Continent; en: string; fr: string; /** A capital city: a small rectangle inside its zone. */ city?: boolean }

export const PVP_ZONES: readonly PvpZone[] = [
  { id: 1411, continent: "kalimdor", en: "Durotar", fr: "Durotar" }, { id: 1412, continent: "kalimdor", en: "Mulgore", fr: "Mulgore" },
  { id: 1413, continent: "kalimdor", en: "The Barrens", fr: "Les Tarides" }, { id: 1416, continent: "eastern", en: "Alterac Mountains", fr: "Montagnes d'Alterac" },
  { id: 1417, continent: "eastern", en: "Arathi Highlands", fr: "Hautes-terres d'Arathi" }, { id: 1418, continent: "eastern", en: "Badlands", fr: "Terres ingrates" },
  { id: 1419, continent: "eastern", en: "Blasted Lands", fr: "Terres foudroyées" }, { id: 1420, continent: "eastern", en: "Tirisfal Glades", fr: "Clairières de Tirisfal" },
  { id: 1421, continent: "eastern", en: "Silverpine Forest", fr: "Forêt des Pins-d'Argent" }, { id: 1422, continent: "eastern", en: "Western Plaguelands", fr: "Maleterres de l'ouest" },
  { id: 1423, continent: "eastern", en: "Eastern Plaguelands", fr: "Maleterres de l'est" }, { id: 1424, continent: "eastern", en: "Hillsbrad Foothills", fr: "Contreforts de Hautebrande" },
  { id: 1425, continent: "eastern", en: "The Hinterlands", fr: "Les Hinterlands" }, { id: 1426, continent: "eastern", en: "Dun Morogh", fr: "Dun Morogh" },
  { id: 1427, continent: "eastern", en: "Searing Gorge", fr: "Gorge des Vents brûlants" }, { id: 1428, continent: "eastern", en: "Burning Steppes", fr: "Steppes ardentes" },
  { id: 1429, continent: "eastern", en: "Elwynn Forest", fr: "Forêt d'Elwynn" }, { id: 1430, continent: "eastern", en: "Deadwind Pass", fr: "Défilé de Deuillevent" },
  { id: 1431, continent: "eastern", en: "Duskwood", fr: "Bois de la Pénombre" }, { id: 1432, continent: "eastern", en: "Loch Modan", fr: "Loch Modan" },
  { id: 1433, continent: "eastern", en: "Redridge Mountains", fr: "Montagnes de Rougecrête" }, { id: 1434, continent: "eastern", en: "Stranglethorn Vale", fr: "Vallée de Strangleronce" },
  { id: 1435, continent: "eastern", en: "Swamp of Sorrows", fr: "Marais des Chagrins" }, { id: 1436, continent: "eastern", en: "Westfall", fr: "Marche de l'Ouest" },
  { id: 1437, continent: "eastern", en: "Wetlands", fr: "Les Paluns" }, { id: 1438, continent: "kalimdor", en: "Teldrassil", fr: "Teldrassil" },
  { id: 1439, continent: "kalimdor", en: "Darkshore", fr: "Sombrivage" }, { id: 1440, continent: "kalimdor", en: "Ashenvale", fr: "Orneval" },
  { id: 1441, continent: "kalimdor", en: "Thousand Needles", fr: "Mille pointes" }, { id: 1442, continent: "kalimdor", en: "Stonetalon Mountains", fr: "Les Serres-Rocheuses" },
  { id: 1443, continent: "kalimdor", en: "Desolace", fr: "Désolace" }, { id: 1444, continent: "kalimdor", en: "Feralas", fr: "Féralas" },
  { id: 1445, continent: "kalimdor", en: "Dustwallow Marsh", fr: "Marécage d'Âprefange" }, { id: 1446, continent: "kalimdor", en: "Tanaris", fr: "Tanaris" },
  { id: 1447, continent: "kalimdor", en: "Azshara", fr: "Azshara" }, { id: 1448, continent: "kalimdor", en: "Felwood", fr: "Gangrebois" },
  { id: 1449, continent: "kalimdor", en: "Un'Goro Crater", fr: "Cratère d'Un'Goro" }, { id: 1450, continent: "kalimdor", en: "Moonglade", fr: "Reflet-de-Lune" },
  { id: 1451, continent: "kalimdor", en: "Silithus", fr: "Silithus" }, { id: 1452, continent: "kalimdor", en: "Winterspring", fr: "Berceau-de-l'Hiver" },
  { id: 1453, continent: "eastern", en: "Stormwind City", fr: "Hurlevent", city: true }, { id: 1454, continent: "kalimdor", en: "Orgrimmar", fr: "Orgrimmar", city: true },
  { id: 1455, continent: "eastern", en: "Ironforge", fr: "Forgefer", city: true }, { id: 1456, continent: "kalimdor", en: "Thunder Bluff", fr: "Pitons-du-Tonnerre", city: true },
  { id: 1457, continent: "kalimdor", en: "Darnassus", fr: "Darnassus", city: true }, { id: 1458, continent: "eastern", en: "Undercity", fr: "Fossoyeuse", city: true }
];

const BY_ID = new Map(PVP_ZONES.map((zone) => [zone.id, zone]));
const fold = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const BY_NAME = new Map(PVP_ZONES.flatMap((zone) => [[fold(zone.en), zone], [fold(zone.fr), zone]] as const));

export const zoneById = (id: number | null | undefined): PvpZone | null => (id === null || id === undefined ? null : BY_ID.get(id) ?? null);
/** A zone from the text a game client sent (English or French), or null. */
export const zoneByName = (name: string): PvpZone | null => BY_NAME.get(fold(name)) ?? null;
/** The zone of a call: its map id when the catalogue knows it, else its name. */
export const zoneOf = (mapId: number | null | undefined, name: string): PvpZone | null => zoneById(mapId) ?? zoneByName(name);
export const foldZoneName = fold;
