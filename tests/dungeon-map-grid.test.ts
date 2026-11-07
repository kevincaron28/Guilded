import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { exportDungeonRuns } from "../companion/lua-export-content.mjs";
import { dungeonRunCard } from "../src/services/dungeon-card.js";
import type { DungeonImportResult } from "../src/services/dungeon-import.js";
import { deathMapOf, mergeCounts, mergeRunCells, MIN_OUTLINE_CELLS, outlineFor } from "../src/services/dungeon-map-grid.js";
import { dungeonRunSchema } from "../src/services/dungeon-rules.js";
import { mapView, scoreCardPng } from "../src/services/score-card.js";

/** An in-memory stand-in for prisma.dungeonMapGrid. */
function fakeGrid() {
  const rows = new Map<number, { mapId: number; dungeonName: string; cells: Record<string, number>; runs: number }>();
  return {
    rows,
    tx: {
      dungeonMapGrid: {
        findUnique: async ({ where }: { where: { mapId: number } }) => rows.get(where.mapId) ?? null,
        upsert: async ({ where, create, update }: { where: { mapId: number }; create: { mapId: number; dungeonName: string; cells: Record<string, number>; runs: number }; update: { cells: Record<string, number> } }) => {
          const row = rows.get(where.mapId);
          if (row) { row.cells = update.cells; row.runs += 1; } else rows.set(where.mapId, { ...create });
          return rows.get(where.mapId);
        }
      }
    }
  };
}
const key = (column: number, row: number) => column * 200 + row;

describe("shared per-floor grid", () => {
  it("counts each walked cell once per run and keeps no run or player", async () => {
    expect(mergeCounts({ [key(1, 1)]: 2 }, [key(1, 1), key(1, 1), key(2, 3), -5, 40000])).toEqual({ [key(1, 1)]: 3, [key(2, 3)]: 1 });
    const grid = fakeGrid();
    await mergeRunCells(grid.tx as never, "Wailing Caverns", [{ map: 279, cells: [key(10, 10), key(10, 11)] }, { map: 280, cells: [key(5, 5)] }]);
    await mergeRunCells(grid.tx as never, "Wailing Caverns", [{ map: 279, cells: [key(10, 11), key(10, 12)] }]);
    expect(grid.rows.get(279)).toEqual({ mapId: 279, dungeonName: "Wailing Caverns", runs: 2, cells: { [key(10, 10)]: 1, [key(10, 11)]: 2, [key(10, 12)]: 1 } });
    expect(Object.keys(grid.rows.get(280)!)).toEqual(["mapId", "dungeonName", "cells", "runs"]);
    // No grid table (older test doubles, or a database before the migration): skipped quietly.
    await expect(mergeRunCells({} as never, "X", [{ map: 1, cells: [1] }])).resolves.toBeUndefined();
  });
  it("draws an outline only once a floor has enough cells, for the floor with the most deaths", async () => {
    expect(deathMapOf([{ map: 2 }, { map: 1 }, { map: 2 }])).toBe(2);
    expect(deathMapOf([{ map: 5 }, { map: 3 }])).toBe(3);
    expect(deathMapOf([])).toBeNull();
    const grid = fakeGrid();
    await mergeRunCells(grid.tx as never, "Deadmines", [{ map: 291, cells: Array.from({ length: MIN_OUTLINE_CELLS - 1 }, (_, i) => key(50 + (i % 20), 60 + Math.floor(i / 20))) }]);
    expect(await outlineFor(grid.tx as never, 291)).toBeNull();
    await mergeRunCells(grid.tx as never, "Deadmines", [{ map: 291, cells: [key(90, 90)] }]);
    expect((await outlineFor(grid.tx as never, 291))?.cells).toHaveLength(MIN_OUTLINE_CELLS);
    expect(await outlineFor(grid.tx as never, null)).toBeNull();
  });
});

describe("companion export and run schema", () => {
  const native = { id: "QG-Trace", gameEdition: "forever", protocolVersion: 1, state: "COMPLETED", instanceId: 36, difficultyId: 1, name: "Deadmines",
    startedAt: 1793998800, endedAt: 1794000000, completedBy: "final boss", recorder: "Kev", reporters: { Kev: true }, players: { Kev: { presentSec: 1200, deaths: 0 } } };
  const exported = (trace: unknown) => exportDungeonRuns({ dungeon: { runs: { fixture: { ...native, trace } } } }, "Forever")[0] as Record<string, unknown>;
  it("exports the walked cells per floor, deduplicated and capped, with no times", () => {
    const run = exported({ 1: { map: 291, cells: "4010,4011,4010,junk,40000" }, 2: { map: 0, cells: "1" }, 3: { map: 292, cells: "" } });
    expect(run["mapCells"]).toEqual([{ map: 291, cells: [4010, 4011] }]);
    const many = exported({ 1: { map: 1, cells: Array.from({ length: 500 }, (_, i) => i).join(",") }, 2: { map: 2, cells: Array.from({ length: 500 }, (_, i) => i).join(",") } });
    expect((many["mapCells"] as { cells: number[] }[]).reduce((sum, floor) => sum + floor.cells.length, 0)).toBe(600);
    expect(exported(undefined)).not.toHaveProperty("mapCells");
    expect(dungeonRunSchema.parse(run).mapCells).toEqual([{ map: 291, cells: [4010, 4011] }]);
    // Malformed cells never invalidate a run.
    expect(dungeonRunSchema.parse({ ...run, mapCells: [{ map: 1, cells: [-1] }] }).mapCells).toBeUndefined();
  });
});

describe("traced map on the dungeon card", () => {
  const cells = [...Array.from({ length: 30 }, (_, i) => key(60 + i, 80)), ...Array.from({ length: 12 * 12 }, (_, i) => key(90 + (i % 12), 74 + Math.floor(i / 12)))];
  const base = (overrides: Partial<DungeonImportResult> = {}): DungeonImportResult => ({
    runRef: "T-1", dungeonName: "Wailing Caverns", difficultyId: 1, state: "COMPLETED", valid: true, durationSec: 1200, points: 0, guildRecord: false, previousGuildBest: null,
    personalRecords: [], players: ["Kev"], deaths: 1, unlinked: [], inGuildPlayers: ["Kev"], achievements: [],
    deathPoints: [{ x: 96 / 200, y: 80 / 200, map: 279 }], mapOutline: { map: 279, cells }, ...overrides
  });
  const withoutOutline = () => { const run = base(); delete run.mapOutline; return run; };
  it("uses the outline only for the floor the deaths are drawn on", () => {
    expect(dungeonRunCard(base(), "en").dungeon!.mapOutline?.cells).toHaveLength(cells.length);
    expect(dungeonRunCard(base({ mapOutline: { map: 999, cells } }), "en").dungeon).not.toHaveProperty("mapOutline");
    expect(dungeonRunCard(base({ deathPoints: [] }), "en").dungeon).not.toHaveProperty("mapOutline");
  });
  it("frames the walked area at the map's 3:2 shape and keeps death points on their cells", () => {
    const view = mapView([key(10, 10), key(20, 10)], [], 0, 0, 300, 100);
    const a = view.at(10.5 / 200, 10.5 / 200), b = view.at(20.5 / 200, 10.5 / 200);
    expect(b.x - a.x).toBeCloseTo(10 / 200 * 1.5 * view.scale);
    expect(a.y).toBeCloseTo(b.y);
  });
  it("renders the outline in gold with the heat map on it; without an outline the painted scene shows through", async () => {
    const traced = (await scoreCardPng(dungeonRunCard(base(), "en")))!;
    const plain = (await scoreCardPng(dungeonRunCard(withoutOutline(), "en")))!;
    // Count gold outline pixels inside the map box (x 628..1112, y ~350..496).
    const gold = async (png: Buffer) => {
      const { data, info } = await sharp(png).extract({ left: 628, top: 352, width: 484, height: 140 }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      let n = 0;
      for (let i = 0; i < data.length; i += info.channels) if (data[i]! > 150 && data[i + 1]! > 110 && data[i + 2]! < 90) n++;
      return n;
    };
    expect(await gold(traced)).toBeGreaterThan(150);
    expect(await gold(plain)).toBeLessThan(50);
    // The death sits on the room: a bright heat dot where the outline is.
    const { data } = await sharp(traced).extract({ left: 600, top: 340, width: 540, height: 160 }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    let hot = 0;
    for (let i = 0; i < data.length; i += 3) if (data[i]! > 140 && data[i]! > data[i + 1]! * 2 && data[i + 2]! < 100) hot++;
    expect(hot).toBeGreaterThan(20);
  }, 60_000);
});
