import { afterEach, describe, expect, it, vi } from "vitest";
import { dungeonResetCutoff, predatesDungeonReset } from "../src/services/dungeon-reset.js";
import { importDungeonRuns } from "../src/services/dungeon-import.js";
import { ingestPublicRuns, type PublicRunStore } from "../src/services/public-runs.js";

afterEach(() => vi.unstubAllEnvs());
const boundary = "2026-10-23T18:00:00Z";
const cutoff = Date.parse(boundary) / 1000;
const oldRun = { id: "old-run", protocolVersion: 1, state: "COMPLETED", instanceId: 36, name: "Deadmines", difficultyId: 1,
  startedAt: cutoff - 1800, endedAt: cutoff + 60, players: [] };
describe("durable dungeon reset", () => {
  it("leaves unconfigured hosts unchanged and accepts the exact boundary", () => {
    expect(dungeonResetCutoff("")).toBeNull();
    expect(predatesDungeonReset({}, null)).toBe(false);
    expect(predatesDungeonReset({ startedAt: cutoff }, dungeonResetCutoff(boundary))).toBe(false);
    expect(predatesDungeonReset({ startedAt: cutoff - 1 }, cutoff)).toBe(true);
    expect(predatesDungeonReset({}, cutoff)).toBe(true);
  });
  it.each(["yesterday", "2026-10-23", "2026-10-23T18:00:00", "2026-99-23T18:00:00Z"])("fails closed for %s", value => {
    expect(() => dungeonResetCutoff(value)).toThrow(/ISO UTC/);
  });
  it("cannot recreate a guild season or points from an old or undated upload", async () => {
    vi.stubEnv("DUNGEON_RUNS_NOT_BEFORE", boundary);
    const tx = {} as Parameters<typeof importDungeonRuns>[0]; // Any database access fails.
    const result = await importDungeonRuns(tx, "guild", [oldRun, { ...oldRun, startedAt: undefined }], [], "owner", null);
    expect(result).toEqual({ results: [], duplicates: 2, malformed: 0 });
  });
  it.each(["personal", "guild"] as const)("cannot republish wiped %s runs", async source => {
    vi.stubEnv("DUNGEON_RUNS_NOT_BEFORE", boundary);
    const createRun = vi.fn();
    const store = { uploadsSince: async () => 0, storedRefs: async () => [], createRun } as unknown as PublicRunStore;
    const result = await ingestPublicRuns(store, { uploaderKey: "fixture", character: "Kev", source, runs: [oldRun] });
    expect(result.rejected).toEqual([{ id: oldRun.id, reason: "run predates the owner's dungeon history reset" }]);
    expect(createRun).not.toHaveBeenCalled();
  });
});
