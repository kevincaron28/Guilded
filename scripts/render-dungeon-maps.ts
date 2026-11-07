// Renders sample dungeon cards with a traced map under the death heat map, for design review and docs/cards/.
// The walked cells here are SYNTHETIC (rooms joined by corridors from a seeded generator): real outlines come only from members'
// recorded runs (dungeon-map-grid.ts). Usage: npx tsx scripts/render-dungeon-maps.ts [outDir]
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { seededRandom } from "../src/services/dungeon-art.js";
import { dungeonRunCard } from "../src/services/dungeon-card.js";
import type { DungeonImportResult } from "../src/services/dungeon-import.js";
import { MAP_GRID, scoreCardPng } from "../src/services/score-card.js";

const outDir = process.argv[2] ?? "docs/cards";

/** Seeded synthetic floor: `rooms` discs joined in a chain by 2-cell-wide corridors, inside a region of the map. */
export function syntheticFloor(seed: number, rooms = 7): { cells: number[]; roomCentres: [number, number][] } {
  const rand = seededRandom(seed), cells = new Set<number>(), centres: [number, number][] = [];
  const put = (x: number, y: number) => { if (x >= 0 && y >= 0 && x < MAP_GRID && y < MAP_GRID) cells.add(Math.round(x) * MAP_GRID + Math.round(y)); };
  for (let i = 0; i < rooms; i++) centres.push([40 + rand() * 110, 40 + rand() * 110]);
  for (const [i, [cx, cy]] of centres.entries()) {
    const r = 4 + rand() * 5;
    for (let x = -r; x <= r; x++) for (let y = -r; y <= r; y++) if (x * x + y * y <= r * r) put(cx + x, cy + y);
    const next = centres[i + 1];
    if (next) {
      const steps = Math.ceil(Math.hypot(next[0] - cx, next[1] - cy));
      const bend: [number, number] = [cx + (next[0] - cx) * rand(), cy + (next[1] - cy) * rand()];
      for (let s = 0; s <= steps; s++) {
        const t = s / steps, x = (1 - t) ** 2 * cx + 2 * (1 - t) * t * bend[0] + t * t * next[0], y = (1 - t) ** 2 * cy + 2 * (1 - t) * t * bend[1] + t * t * next[1];
        put(x, y); put(x + 1, y); put(x, y + 1);
      }
    }
  }
  return { cells: [...cells].sort((a, b) => a - b), roomCentres: centres };
}

const party = [["Gauthier", "WARRIOR", "TANK"], ["Melodie", "PRIEST", "HEALER"], ["Kev", "MAGE", "DAMAGER"], ["Xaldin", "HUNTER", "DAMAGER"], ["Aurore", "ROGUE", "DAMAGER"]] as const;
const dungeons: [string, number, number][] = [["Ragefire Chasm", 213, 11], ["Wailing Caverns", 279, 23], ["The Deadmines", 291, 37], ["Shadowfang Keep", 310, 41]];

mkdirSync(outDir, { recursive: true });
for (const [i, [name, map, seed]] of dungeons.entries()) {
  const floor = syntheticFloor(seed), rand = seededRandom(seed + 1);
  const deathPoints = Array.from({ length: 9 }, (_, k) => {
    const [cx, cy] = floor.roomCentres[(k * 3 + 2) % floor.roomCentres.length]!;
    return { x: (cx + (rand() - 0.5) * 6) / MAP_GRID, y: (cy + (rand() - 0.5) * 6) / MAP_GRID, map };
  });
  const run: DungeonImportResult = {
    runRef: `MAP-${i}`, dungeonName: name, difficultyId: 1, state: "COMPLETED", valid: true, durationSec: 1500 + i * 233, points: 0, completedBy: "final boss",
    guildRecord: false, previousGuildBest: null, personalRecords: [], players: party.map(p => p[0]), deaths: 9, unlinked: [], inGuildPlayers: party.map(p => p[0]),
    achievements: [], endedAt: 1794000000, deathPoints, encounters: [{ id: 1, name: ["Taragaman the Hungerer", "Mutanus the Devourer", "Edwin VanCleef", "Archmage Arugal"][i]!, success: true, at: 1794000000 }], mapOutline: { map, cells: floor.cells },
    playerDetails: party.map(([character, cls, role], k) => ({ character, class: cls, role, deaths: [1, 0, 4, 2, 2][k]!, presentSec: 1500, points: 0 }))
  };
  const png = await scoreCardPng(dungeonRunCard(run, i % 2 ? "fr" : "en"));
  const file = join(outDir, `dungeon-map-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}.png`);
  writeFileSync(file, png!);
  console.log(`${file} ${(png!.length / 1024).toFixed(0)} KB, ${floor.cells.length} cells`);
}
