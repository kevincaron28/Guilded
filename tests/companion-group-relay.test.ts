import { describe, expect, it } from "vitest";
import { deviceUploadBody } from "../companion/device-sync.mjs";
import { acknowledgements, pruneAcknowledged } from "../companion/delta.mjs";
import { exportDungeonRuns } from "../companion/lua-export-content.mjs";
import { minimalParkedExport } from "../companion/parked-runs.mjs";
import { featuresLua } from "../companion/group-relay.mjs";
import { linkedMapLua } from "../companion/standings-format.mjs";
import { acceptedToLua } from "../companion/personal-runs-content.mjs";
import { deviceReceiptsToLua, standaloneReceiptsToLua } from "../companion/device-receipts.mjs";

// 9.3.1: a companion sends runs it only heard through a group to a bot that announced it handles them, and only once.
const run = (id: string, over: Record<string, unknown> = {}) => ({ id, state: "COMPLETED", endedAt: 1000, reporterNames: ["Amy"], viaGroup: true,
  players: [{ character: "Amy", realm: "R" }, { character: "Bob", realm: "R" }], ...over });
const full = (dungeonRuns: unknown[]) => ({ guild: null, wowGuild: "Quebec Gold-Realm", character: { name: "Kev", realm: "R" }, alts: [], characters: [], dungeonRuns });
const ids = (body: { dungeonRuns?: { id: string }[] }) => (body.dungeonRuns ?? []).map((entry) => entry.id);

describe("the companion and group-carried runs", () => {
  it("holds them back from a bot that did not announce the feature (an unsigned upload)", () => {
    const runs = [run("QG-A"), run("QG-B", { viaGroup: undefined })];
    expect(ids(deviceUploadBody(full(runs) as never, { acknowledged: new Set() }))).toEqual(["QG-B"]);
    expect(ids(deviceUploadBody(full(runs) as never, { acknowledged: new Set(), groupRelay: true })).sort()).toEqual(["QG-A", "QG-B"]);
  });

  it("only the group: receipt stops a carried run, and the plain id stops only a guild run", () => {
    const runs = [run("QG-A"), run("QG-B")];
    expect(ids(deviceUploadBody(full(runs) as never, { acknowledged: new Set(["QG-A"]), groupRelay: true })).sort()).toEqual(["QG-A", "QG-B"]);
    expect(ids(deviceUploadBody(full(runs) as never, { acknowledged: new Set(["group:QG-A"]), groupRelay: true }))).toEqual(["QG-B"]);
  });

  it("a signed upload drops them unless the standings announced the feature, and after the bot's receipt", () => {
    const exported = full([run("QG-A"), run("QG-B", { viaGroup: undefined })]);
    const ack = acknowledgements({ personal: { acceptedRunRefs: ["group:QG-A"] } });
    expect(pruneAcknowledged(exported as never, ack, new Set(["ledger-delta"])).exported.dungeonRuns.map((entry: { id: string }) => entry.id)).toEqual(["QG-B"]);
    expect(pruneAcknowledged(exported as never, acknowledgements({}), new Set(["group-relay"])).exported.dungeonRuns.map((entry: { id: string }) => entry.id)).toEqual(["QG-A", "QG-B"]);
    expect(pruneAcknowledged(exported as never, ack, new Set(["group-relay"])).exported.dungeonRuns.map((entry: { id: string }) => entry.id)).toEqual(["QG-B"]);
  });

  it("an exporter that reads only dungeon.runs (every companion before the relay) never sees a carried run; the new one marks it viaGroup", () => {
    const stored = (id: string) => ({ id, protocolVersion: 1, state: "COMPLETED", instanceId: 389, name: "Ragefire Chasm", difficultyId: 1, startedAt: 100, endedAt: 2000, reporters: { Amy: true },
      players: { Amy: { class: "MAGE", level: 15 }, Bob: { class: "MAGE", level: 15 } } });
    const database = { character: { name: "Kev", realm: "R" }, dungeon: { runs: { "QG-OWN": stored("QG-OWN") }, carried: { "QG-CARRIED": stored("QG-CARRIED") } } };
    const oldReader = { ...database, dungeon: { runs: database.dungeon.runs } }; // what an exporter that never reads `carried` sees
    expect(exportDungeonRuns(oldReader as never, "R").map((entry: { id: string }) => entry.id)).toEqual(["QG-OWN"]);
    const exported = exportDungeonRuns(database as never, "R") as { id: string; viaGroup?: boolean }[];
    expect(exported.map((entry) => entry.id).sort()).toEqual(["QG-CARRIED", "QG-OWN"]);
    expect(exported.find((entry) => entry.id === "QG-CARRIED")?.viaGroup).toBe(true);
    expect(exported.find((entry) => entry.id === "QG-OWN")?.viaGroup).toBeUndefined();
  });

  it("a signed parked upload applies the same gate", () => {
    const runs = [run("QG-A"), run("QG-B", { viaGroup: undefined })];
    expect(ids(minimalParkedExport({ wowGuild: "G", dungeonRuns: runs } as never))).toEqual(["QG-B"]);
    expect(ids(minimalParkedExport({ wowGuild: "G", dungeonRuns: runs } as never, { groupRelay: true })).sort()).toEqual(["QG-A", "QG-B"]);
  });

  it("every file the addon reads the companion's state from carries the marker", () => {
    const marker = featuresLua("2026-11-14T10:00:00.000Z");
    expect(marker).toContain('["group-relay"] = true');
    expect(linkedMapLua([], "2026-11-14T10:00:00.000Z")).toContain(marker);
    expect(deviceReceiptsToLua({ refs: [], notes: {}, pending: {}, reported: [] }, "2026-11-14T10:00:00.000Z")).toContain(marker);
    expect(standaloneReceiptsToLua({ refs: [], notes: {}, pending: {} }, { mode: "device", updatedAt: "2026-11-14T10:00:00.000Z" } as never)).toContain(marker);
    expect(acceptedToLua([])).toContain('["group-relay"] = true');
  });
});
