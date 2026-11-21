import { describe, expect, it } from "vitest";
import { deviceUploadBody } from "../companion/device-sync.mjs";
import { acknowledgements, pruneAcknowledged } from "../companion/delta.mjs";
import { exportDungeonRuns } from "../companion/lua-export-content.mjs";
import { minimalParkedExport } from "../companion/parked-runs.mjs";
import { createFileLock, createHeartbeat, featuresLua, refreshMarkers, withFreshMarker, withoutFeatureStamp } from "../companion/group-relay.mjs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    const at = (text: string) => text.replace(/ at = \d+/, " at = 0");
    const marker = at(featuresLua("2026-11-14T10:00:00.000Z"));
    expect(marker).toContain('["group-relay"] = true');
    expect(at(linkedMapLua([], "2026-11-14T10:00:00.000Z"))).toContain(marker);
    expect(at(deviceReceiptsToLua({ refs: [], notes: {}, pending: {}, reported: [] }, "2026-11-14T10:00:00.000Z"))).toContain(marker);
    expect(at(standaloneReceiptsToLua({ refs: [], notes: {}, pending: {} }, { mode: "device", updatedAt: "2026-11-14T10:00:00.000Z" } as never))).toContain(marker);
    expect(acceptedToLua([])).toContain('["group-relay"] = true');
  });
});

describe("the alive marker (9.3.3)", () => {
  it("is the time of writing, says it is a heartbeat, and never the standings stamp", () => {
    expect(featuresLua("2020-01-01T00:00:00Z", 1_800_000_000_000)).toBe('GuildedCompanionFeatures = { ["group-relay"] = true, ["carry-records"] = true, hb = 1, at = 1800000000 }');
  });
  it("a refreshed marker does not make a file look changed", () => {
    const text = `GuildedLinked = {
}
${featuresLua(null, 1_000_000)}
`;
    const fresh = withFreshMarker(text, 9_000_000_000)!;
    expect(fresh).not.toBe(text);
    expect(withoutFeatureStamp(fresh)).toBe(withoutFeatureStamp(text));
    expect(withFreshMarker("no marker here")).toBeNull();
  });
  it("rewrites an old marker even when nothing else changed, leaves a fresh one and files without one", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hb-"));
    try {
      const old = join(dir, "old.lua"), young = join(dir, "young.lua"), other = join(dir, "other.lua");
      const now = 10_000_000_000;
      await writeFile(old, `X = 1
${featuresLua(null, now - 3 * 3_600_000)}
`);
      await writeFile(young, `X = 1
${featuresLua(null, now - 60_000)}
`);
      await writeFile(other, "X = 1");
      expect(await refreshMarkers([old, young, other, join(dir, "missing.lua")], { now })).toEqual([old]);
      expect(await readFile(old, "utf8")).toBe(`X = 1
${featuresLua(null, now)}
`);
      expect(await readFile(other, "utf8")).toBe("X = 1");
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});


describe("the heartbeat schedule and the file lock (9.3.3)", () => {
  it("reads the files only when a heartbeat is due, and looks again soon after a pass that wrote nothing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hb-"));
    try {
      const file = join(dir, "s.lua");
      const now = 10_000_000_000;
      await writeFile(file, `X = 1
${featuresLua(null, now - 3 * 3_600_000)}
`);
      const beat = createHeartbeat();
      expect(beat.due(now)).toBe(true);
      expect(await beat.run([file], now)).toEqual([file]);
      expect(beat.due(now + 60_000)).toBe(false);
      // Not due: not even read (a missing file would be noticed only when due).
      await rm(file);
      expect(await beat.run([file], now + 60_000)).toEqual([]);
      // A standings write counts as a marker write.
      beat.wrote(now + 3_000_000);
      expect(beat.due(now + 3_000_000 + 60_000)).toBe(false);
      // A pass over files that are fresh already writes nothing and looks again in ten minutes.
      const fresh = createHeartbeat();
      await writeFile(file, `X = 1
${featuresLua(null, now)}
`);
      expect(await fresh.run([file], now)).toEqual([]);
      expect(fresh.due(now + 5 * 60_000)).toBe(false);
      expect(fresh.due(now + 11 * 60_000)).toBe(true);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it("runs file jobs one at a time, in order, even when one fails", async () => {
    const lock = createFileLock();
    const order: string[] = [];
    const slow = lock(async () => { order.push("a-start"); await new Promise((r) => setTimeout(r, 20)); order.push("a-end"); });
    const failing = lock(async () => { order.push("b"); throw new Error("x"); });
    const last = lock(async () => { order.push("c"); return 7; });
    await slow;
    await expect(failing).rejects.toThrow("x");
    expect(await last).toBe(7);
    expect(order).toEqual(["a-start", "a-end", "b", "c"]);
  });
});

describe("exported player realm (9.4)", () => {
  it("never exports an empty realm for a run player (Forever has no realms)", () => {
    const database = { character: { name: "Kev", realm: "", gameEdition: "forever" }, dungeon: { runs: { a: { id: "QG-E", state: "COMPLETED", instanceId: 36, startedAt: 1000, endedAt: 2800, players: { Kev: { presentSec: 1700, inGuild: true } } } } } };
    const exported = exportDungeonRuns(database as never, "") as { players: { realm: string }[] }[];
    expect(exported[0]?.players.map((player) => player.realm)).toEqual(["-"]);
  });
});
