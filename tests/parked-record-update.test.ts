/* eslint-disable @typescript-eslint/no-explicit-any -- the record is plain JSON, shaped by the module under test */
import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createRequire } from "node:module";
import { createRecordUpdater, noteOutcome, readRecordDetailed, readRecordStrict, recordPathFor, RECORD_MOVED, RECORD_STUCK } from "../companion/parked-runs.mjs";

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
    const record = await readRecordStrict(config, { retryMs: 400 });
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

  const badCopies = (path: string) => readdirSync(join(path, "..")).filter((name) => name.endsWith(".bad")).sort();

  it("after several damaged reads in a row the file is moved aside as a .bad copy, a new record is started and a problem line is shown", async () => {
    const { config, path } = setup();
    const { lines, onLog } = logs();
    writeFileSync(path, "{ not json");
    const update = createRecordUpdater({ onLog, retryMs: 1 });
    expect(await update(config, (record: any) => record)).toBeNull();
    expect(await update(config, (record: any) => record)).toBeNull();
    expect(badCopies(path)).toHaveLength(0);
    const third = await update(config, (record: any) => ({ ...record, servers: { S: ["k"] } }));
    expect(third).not.toBeNull();
    const [bad] = badCopies(path);
    expect(readFileSync(join(path, "..", bad!), "utf8")).toBe("{ not json");
    expect(JSON.parse(readFileSync(path, "utf8")).servers).toEqual({ S: ["k"] });
    expect(lines).toContain(RECORD_MOVED);
  });

  it("a record that cannot be read for another reason than damage (a lock, a permission error) is never moved aside, however often", async () => {
    const { config, path } = setup();
    const { lines, onLog } = logs();
    // A folder where the file should be: reading it fails with an error that is not a missing file and not damaged text (the same class as EBUSY, EPERM, EACCES).
    mkdirSync(path);
    expect((await readRecordDetailed(config, { retryMs: 1 }))).toEqual({ record: null, corrupt: false });
    const update = createRecordUpdater({ onLog, retryMs: 1 });
    for (let index = 0; index < 6; index += 1) expect(await update(config, (record: any) => record)).toBeNull();
    expect(badCopies(path)).toHaveLength(0);
    expect(lines).not.toContain(RECORD_MOVED);
    expect(lines).toHaveLength(6);
  });

  it("damaged text is told apart from a lock, and a good record resets the count", async () => {
    const { config, path } = setup();
    writeFileSync(path, "{ not json");
    expect(await readRecordDetailed(config, { retryMs: 1 })).toEqual({ record: null, corrupt: true });
    const { onLog } = logs();
    const update = createRecordUpdater({ onLog, retryMs: 1 });
    await update(config, (record: any) => record);
    await update(config, (record: any) => record);
    writeFileSync(path, JSON.stringify({ version: 1, runs: {}, servers: {}, outcomes: {} }));
    expect(await update(config, (record: any) => ({ ...record, servers: { A: ["1"] } }))).not.toBeNull();
    writeFileSync(path, "{ not json");
    await update(config, (record: any) => record);
    await update(config, (record: any) => record);
    expect(badCopies(path)).toHaveLength(0);
  });

  it("an earlier .bad copy is kept when a new one is made, and only the last three stay", async () => {
    const { config, path } = setup();
    const update = createRecordUpdater({ onLog: () => {}, retryMs: 1, unreadableLimit: 1 });
    for (let index = 0; index < 5; index += 1) {
      writeFileSync(path, `{ damaged ${index}`);
      await update(config, (record: any) => record);
      await delay(5);
    }
    const copies = badCopies(path);
    expect(copies).toHaveLength(3);
    expect(copies.map((name) => readFileSync(join(path, "..", name), "utf8"))).toEqual(["{ damaged 2", "{ damaged 3", "{ damaged 4"]);
  });

  it("the problem lines are in the French window's catalogue, so they show in both languages in the Activity list", () => {
    const i18n = createRequire(import.meta.url)("../companion-app/i18n.cjs") as { message: (language: string, text: string) => string };
    for (const line of [RECORD_MOVED, RECORD_STUCK]) {
      expect(i18n.message("fr", line)).not.toBe(line);
      expect(i18n.message("fr", line)).toContain("Probl\u00e8me");
      expect(i18n.message("en", line)).toBe(line);
    }
    expect(i18n.message("fr", RECORD_MOVED)).toContain("renvoy\u00e9s");
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
