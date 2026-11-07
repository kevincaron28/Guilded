import type { Prisma } from "../generated/prisma/client.js";
import type { DungeonRunInput } from "./dungeon-rules.js";

/**
 * Traced dungeon maps (9.2). Members' addons record the grid cells they walk through in a dungeon (Dungeon.lua, `run.trace`):
 * a 200 x 200 grid over each floor's map (uiMapID), the same coordinates as the death positions, with no times. On import the
 * cells are merged into one shared, anonymous grid per floor (DungeonMapGrid: cell key -> number of runs) and then dropped:
 * no per-player or per-run trail is kept. Once a floor has MIN_OUTLINE_CELLS cells, the dungeon card draws its outline under
 * the death heat map; before that the card keeps the painted scene.
 */
export const GRID = 200, MIN_OUTLINE_CELLS = 120, MAX_CARD_CELLS = 6000, MAX_CELL_COUNT = 10_000, MAX_RUN_CELLS = 600;
export type CellCounts = Record<string, number>;
type Tx = Partial<Pick<Prisma.TransactionClient, "dungeonMapGrid" | "$executeRaw">>;

/** Pure: the grid after one run's cells (each cell counted once per run, counts capped). */
export function mergeCounts(existing: CellCounts, cells: readonly number[]): CellCounts {
  const merged: CellCounts = { ...existing };
  for (const key of new Set(cells)) {
    if (!Number.isInteger(key) || key < 0 || key >= GRID * GRID) continue;
    merged[key] = Math.min(MAX_CELL_COUNT, (merged[key] ?? 0) + 1);
  }
  return merged;
}

/** Pure: the floor (uiMapID) with the most death points, as the card draws it; null without points. Ties go to the lower id. */
export function deathMapOf(points: readonly { map: number }[] | undefined): number | null {
  const counts = new Map<number, number>();
  for (const point of points ?? []) counts.set(point.map, (counts.get(point.map) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0] ?? null;
}

/** Merges one run's walked cells into the per-floor grids. Skipped (no error) when the database has no grid table. */
export async function mergeRunCells(tx: Tx, dungeonName: string, mapCells: DungeonRunInput["mapCells"]): Promise<void> {
  if (!tx.dungeonMapGrid || !mapCells?.length) return;
  let budget = MAX_RUN_CELLS;
  for (const floor of mapCells.slice(0, 20)) {
    const cells = floor.cells.slice(0, budget);
    budget -= cells.length;
    if (!cells.length) continue;
    // Grids are shared by every server: serialise writers per floor so concurrent imports never lose counts.
    if (tx.$executeRaw) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`dungeon-map:${floor.map}`}, 0))`;
    const row = await tx.dungeonMapGrid.findUnique({ where: { mapId: floor.map }, select: { cells: true, runs: true } });
    const counts = mergeCounts(row?.cells && typeof row.cells === "object" && !Array.isArray(row.cells) ? row.cells as CellCounts : {}, cells);
    await tx.dungeonMapGrid.upsert({ where: { mapId: floor.map },
      create: { mapId: floor.map, dungeonName: dungeonName.slice(0, 100), cells: counts, runs: 1 },
      update: { cells: counts, runs: { increment: 1 }, dungeonName: dungeonName.slice(0, 100) } });
  }
}

/** The outline cells for one floor, or null while the floor has fewer than MIN_OUTLINE_CELLS. */
export async function outlineFor(tx: Tx, mapId: number | null): Promise<{ map: number; cells: number[] } | null> {
  if (!tx.dungeonMapGrid || mapId === null) return null;
  const row = await tx.dungeonMapGrid.findUnique({ where: { mapId }, select: { cells: true } });
  const counts = row?.cells && typeof row.cells === "object" && !Array.isArray(row.cells) ? row.cells as CellCounts : {};
  const cells = Object.entries(counts).sort((a, b) => b[1] - a[1] || Number(a[0]) - Number(b[0])).slice(0, MAX_CARD_CELLS).map(([key]) => Number(key));
  return cells.length >= MIN_OUTLINE_CELLS ? { map: mapId, cells: cells.sort((a, b) => a - b) } : null;
}
