import { describe, expect, it, vi } from "vitest";
import { assertForeverEdition, FOREVER_ONLY_MESSAGE, gameEditionOf, GAME_EDITIONS, SUPPORTED_EDITION } from "../companion/game-edition.mjs";
import { assertSnapshotEdition, GameEditionError } from "../src/services/game-edition.js";
import { validateRun, type DungeonRunInput } from "../src/services/dungeon-rules.js";
import { importCharacter } from "../src/services/character-import.js";
import type { AddonSnapshot } from "../src/integrations/addon.js";

// Stage 6 of docs/plans/FOREVER_ONLY_REMOVAL.md: Guilded supports WoW Forever only. Stored rows of the removed
// editions stay readable (the parser still knows their ids), but every upload entry point refuses new data
// from them with one plain message, before anything is written.
describe("WoW Forever only: uploads from another WoW version are refused", () => {
  it("still parses the removed editions' ids, so stored rows stay readable", () => {
    expect(SUPPORTED_EDITION).toBe("forever");
    expect(GAME_EDITIONS).toContain("retail");
    expect(gameEditionOf({ gameEdition: "classic-era" })).toBe("classic-era");
    expect(gameEditionOf({ interface: 120105 })).toBe("retail");
    expect(gameEditionOf({})).toBe("forever");
  });

  it("refuses with one plain message", () => {
    expect(() => assertForeverEdition("forever")).not.toThrow();
    for (const edition of ["classic-era", "classic-tbc", "classic-mists", "retail"]) expect(() => assertForeverEdition(edition)).toThrow(FOREVER_ONLY_MESSAGE);
  });

  it("addon snapshots: another WoW version is refused even for an old guild of that version", () => {
    const snapshot = (gameEdition: string) => ({ gameEdition, alts: [], characters: [], dungeonRuns: [] }) as unknown as AddonSnapshot;
    expect(() => assertSnapshotEdition(snapshot("forever"), "forever")).not.toThrow();
    expect(() => assertSnapshotEdition(snapshot("retail"), "retail")).toThrow(GameEditionError);
    expect(() => assertSnapshotEdition(snapshot("retail"), "retail")).toThrow(FOREVER_ONLY_MESSAGE);
  });

  it("dungeon runs: another WoW version is not a valid run", () => {
    const now = new Date("2026-11-07T20:00:00Z"), nowSec = Math.floor(now.getTime() / 1000);
    const run = (over: Partial<DungeonRunInput> = {}): DungeonRunInput => ({
      id: "QG-1", protocolVersion: 1, state: "COMPLETED", instanceId: 36, name: "The Deadmines", difficultyId: 1,
      startedAt: nowSec - 1800, endedAt: nowSec - 300, reporters: 1,
      players: [{ character: "Kev Stone", realm: "R", deaths: 0, presentSec: 1500, inGuild: true }], ...over
    });
    expect(validateRun(run(), now)).toEqual({ ok: true });
    expect(validateRun(run({ interface: 120105 } as Partial<DungeonRunInput>), now)).toEqual({ ok: false, reason: "WoW Forever only" });
    expect(validateRun(run({ gameEdition: "classic-era" } as Partial<DungeonRunInput>), now)).toEqual({ ok: false, reason: "WoW Forever only" });
  });

  it("character import: another WoW version is refused before any database write", async () => {
    const create = vi.fn();
    const db = { member: { findUnique: vi.fn(async () => ({ guildId: "g", guild: { gameEdition: "retail" } })) }, character: { findMany: vi.fn(async () => []), create } };
    const parsed = { name: "Kev", realm: "Realm", className: "Mage", level: 80, gameEdition: "retail" } as never;
    await expect(importCharacter(db as never, "m", parsed)).rejects.toThrow(FOREVER_ONLY_MESSAGE);
    expect(create).not.toHaveBeenCalled();
  });
});
