import type { Continent } from "./pvp-zones.js";

// Where each zone's marker sits on its continent picture: x and y as a percent of the picture (0-100). These are working positions for the
// neutral background; once the painted continent pictures exist, move each marker here to the right place on them. A zone missing from
// this table is listed in the table below the map only.
export const ZONE_POSITIONS: Record<number, [number, number]> = {
  // Kalimdor
  1438: [22, 8], 1439: [30, 22], 1440: [40, 30], 1447: [66, 20], 1448: [56, 12], 1452: [78, 8], 1450: [66, 8], 1442: [36, 44], 1411: [62, 34], 1412: [40, 58],
  1413: [52, 48], 1443: [24, 56], 1441: [46, 68], 1444: [26, 72], 1445: [64, 64], 1446: [54, 84], 1449: [36, 86], 1451: [20, 92],
  // Eastern Kingdoms
  1420: [32, 8], 1421: [22, 18], 1422: [45, 12], 1423: [62, 10], 1424: [36, 24], 1416: [46, 22], 1417: [54, 30], 1425: [66, 30], 1437: [50, 38], 1426: [36, 46],
  1432: [50, 48], 1427: [44, 57], 1428: [50, 64], 1418: [60, 56], 1429: [38, 68], 1436: [26, 76], 1433: [54, 72], 1431: [40, 78], 1430: [62, 80], 1435: [68, 84],
  1419: [62, 92], 1434: [44, 90]
};

/** The picture of each continent, when it exists (a path under /images/pvp-map/); null draws the neutral background. */
export const CONTINENT_IMAGES: Record<Continent, string | null> = { kalimdor: null, eastern: null };
