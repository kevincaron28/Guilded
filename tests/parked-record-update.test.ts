/* eslint-disable @typescript-eslint/no-explicit-any -- the record is plain JSON, shaped by the module under test */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createRecordUpdater, noteOutcome, readRecordStrict, recordPathFor } from "../companion/parked-runs.mjs";

// 9.3.3: the parked-runs record is changed one change at a time, each applied to the record read just before it, and a record that could not be
// read is never written over.

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function setup() {
  const dir = mkdtempSync(join(tmpdir(), "guilded-parked-record-")); dirs.push(dir);
  const config = { watchFile: join(dir, "Guilded.lua") };
  return { config, path: recordPathFor(config)! };
}
const logs = () => { const lines: string[] = []; return { lines, onLog: (_level: string, message: string) => { lines.push(message); } }; };

describe("reading the record for a change", () => {
  it("a missing file is an empty record", async () => {
    const { config } = setup();
    expect(await readRecordStrict(config, { retryMs: 1 })).toMatchObject({ runs: {}, servers: {}, outcomes: {} });
  });

  it("an unreadable or corrupt file is null, not an empty record", async () => {
    const { config, path } = setup();
    writeFileSync(path, "{ not json");
    expect(await readRecordStrict(config, { retryMs: 1 })).toBeNull();
    writeFileSync(path, "42");
    expect(await readRecordStrict(config, { retryMs: 1 })).toBeNull();
  });

  it("a read that fails once and then works (another program let go of the file) is read on the second try", async () => {
    const { config, path } = setup();
    writeFileSync(path, "{ not json");
    setTimeout(() => writeFileSync(path, JSON.stringify({ version: 1, runs: { A: { guild: "g", ended: 1 } }, servers: {}, outcomes: {} })), 20);
    const record = await readRecordStrict(config, { retryMs: 80 });
    expect(Object.keys(record!.runs)).toEqual(["A"]);
  });
});

describe("changing the record", () => {
  it("two overlapping changes both land, in order, each on the record the other left", async () => {
    const { config, path } = setup();
    const { onLog } = logs();
    const update = createRecordUpdater({ onLog, retryMs: 1 });
    // The first change is slow (a parked upload applying what it collected); the second (the standings check) is queued behind it.
    const first = update(config, async (record: any) => { await delay(60); return noteOutcome(record, "Parked A-Realm", ["r1"], "unconfirmed"); });
    const second = update(config, (record: any) => ({ ...record, runs: { ...record.runs, R2: { guild: "Parked B-Realm", ended: 5 } } }));
    await Promise.all([first, second]);
    const saved = JSON.parse(readFileSync(path, "utf8"));
    expect(Object.keys(saved.outcomes)).toHaveLength(1);
    expect(Object.keys(saved.runs)).toEqual(["R2"]);
  });

  it("a record that cannot be read is left exactly as it is, the change is skipped and one line is logged", async () => {
    const { config, path } = setup();
    const { lines, onLog } = logs();
    writeFileSync(path, "{ not json");
    const update = createRecordUpdater({ onLog, retryMs: 1 });
    let applied = false;
    const result = await update(config, (record: any) => { applied = true; return record; });
    expect(result).toBeNull();
    expect(applied).toBe(false);
    expect(readFileSync(path, "utf8")).toBe("{ not json");
    expect(lines).toHaveLength(1);
    // The queue goes on: a later change on a readable record still lands.
    writeFileSync(path, JSON.stringify({ version: 1, runs: {}, servers: {}, outcomes: {} }));
    expect(await update(config, (record: any) => ({ ...record, servers: { S: ["k"] } }))).not.toBeNull();
    expect(JSON.parse(readFileSync(path, "utf8")).servers).toEqual({ S: ["k"] });
  });

  it("after several unreadable reads in a row the file is moved aside as .bad, a new record is started and a problem line is shown", async () => {
    const { config, path } = setup();
    const { lines, onLog } = logs();
    writeFileSync(path, "{ not json");
    const update = createRecordUpdater({ onLog, retryMs: 1 });
    expect(await update(config, (record: any) => record)).toBeNull();
    expect(await update(config, (record: any) => record)).toBeNull();
    expect(existsSync(path + ".bad")).toBe(false);
    const third = await update(config, (record: any) => ({ ...record, servers: { S: ["k"] } }));
    expect(third).not.toBeNull();
    expect(readFileSync(path + ".bad", "utf8")).toBe("{ not json");
    expect(JSON.parse(readFileSync(path, "utf8")).servers).toEqual({ S: ["k"] });
    expect(lines.some((line) => line.startsWith("Problem:") && line.includes(".bad"))).toBe(true);
  });

  it("a missing file starts an empty record and writes it", async () => {
    const { config, path } = setup();
    const update = createRecordUpdater({ retryMs: 1 });
    expect(existsSync(path)).toBe(false);
    await update(config, (record: any) => noteOutcome(record, "Parked A-Realm", ["r1"], "ok"));
    expect(Object.keys(JSON.parse(readFileSync(path, "utf8")).outcomes)).toHaveLength(1);
  });

  it("a change that returns null leaves the file alone, and a failed write is logged", async () => {
    const { config, path } = setup();
    const { lines, onLog } = logs();
    const update = createRecordUpdater({ onLog, retryMs: 1 });
    expect(await update(config, () => null)).toBeNull();
    expect(existsSync(path)).toBe(false);
    // The folder of the record does not exist, so the write cannot succeed.
    const broken = { watchFile: join(config.watchFile, "no-such-folder", "x.lua") };
    expect(await update(broken, (record: any) => record)).toBeNull();
    expect(lines.some((line) => line.includes("could not be saved"))).toBe(true);
  });
});
