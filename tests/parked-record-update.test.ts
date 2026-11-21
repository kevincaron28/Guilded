/* eslint-disable @typescript-eslint/no-explicit-any -- the record is plain JSON, shaped by the module under test */
import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createRequire } from "node:module";
import { companionProblems, reportableProblems } from "../companion/problems.mjs";
import { mainStatus } from "../companion/main-status.mjs";
import { createRecordUpdater, noteOutcome, parkedRecordState, readRecordDetailed, readRecordStrict, recordPathFor, RECORD_MOVED, RECORD_STUCK } from "../companion/parked-runs.mjs";

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

  it("bad, lock, bad, lock, bad still moves the record aside: a lock neither counts nor starts the count again", async () => {
    const { config, path } = setup();
    const update = createRecordUpdater({ onLog: () => {}, retryMs: 1 });
    const damage = () => { rmSync(path, { recursive: true, force: true }); writeFileSync(path, "{ not json"); };
    const lock = () => { rmSync(path, { recursive: true, force: true }); mkdirSync(path); };
    damage(); await update(config, (record: any) => record);
    lock(); await update(config, (record: any) => record);
    damage(); await update(config, (record: any) => record);
    lock(); await update(config, (record: any) => record);
    damage();
    expect(badCopies(path)).toHaveLength(0);
    expect(await update(config, (record: any) => record)).not.toBeNull();
    expect(badCopies(path)).toHaveLength(1);
  });

  it("only the exact timestamped .bad names are pruned: other files in the folder are never removed", async () => {
    const { config, path } = setup();
    const name = path.slice(join(path, "..").length + 1);
    const keep = [`${name}.bad`, `${name}.notes.bad`, `${name}.x.20261115-000000000.bad.keep`, "other.20261115-000000000.bad"];
    for (const file of keep) writeFileSync(join(path, "..", file), "keep me");
    const update = createRecordUpdater({ onLog: () => {}, retryMs: 1, unreadableLimit: 1 });
    for (let index = 0; index < 5; index += 1) { writeFileSync(path, `{ damaged ${index}`); await update(config, (record: any) => record); await delay(5); }
    for (const file of keep) expect(existsSync(join(path, "..", file)), file).toBe(true);
    expect(readdirSync(join(path, "..")).filter((entry) => /^GuildedCompanion-parked\.json\.\d{8}-\d{9}\.bad$/.test(entry))).toHaveLength(3);
  });

  it("the Problems panel entry appears when the record is moved aside or stuck and clears once a fresh record works", async () => {
    const { config, path } = setup();
    const seen: (string | null)[] = [];
    let time = 1_000_000;
    const update = createRecordUpdater({ onLog: () => {}, onStatus: (status: string | null) => { seen.push(status); }, retryMs: 1, unreadableLimit: 2, clock: () => time, movedVisibleMs: 60_000 });
    writeFileSync(path, "{ not json");
    await update(config, (record: any) => record);
    expect(seen).toEqual([]);
    await update(config, (record: any) => ({ ...record, servers: { S: ["k"] } }));
    // The record was moved aside and a fresh one started: the problem shows now.
    expect(seen).toEqual(["moved"]);
    const state = { parkedRecord: { moved: true, stuck: false } };
    expect(companionProblems({ state }).map((problem: any) => problem.id)).toContain("parked-record-damaged");
    expect(mainStatus({ state, problems: companionProblems({ state }) }).needsYou?.id).toBe("parked-record-damaged");
    // A later change finds the good record, but not before the warning was visible for its time.
    await update(config, (record: any) => record);
    expect(seen).toEqual(["moved"]);
    time += 60_000;
    await update(config, (record: any) => record);
    expect(seen).toEqual(["moved", null]);
    expect(companionProblems({ state: { parkedRecord: null } }).map((problem: any) => problem.id)).not.toContain("parked-record-damaged");
  });

  it("a moved warning stays when the fresh record could not be written (no file reads as good) and across lock or skipped updates, until its time is over", async () => {
    const { config, path } = setup();
    const seen: (string | null)[] = [];
    let time = 0;
    const update = createRecordUpdater({ onLog: () => {}, onStatus: (status: string | null) => { seen.push(status); }, retryMs: 1, unreadableLimit: 1, clock: () => time, movedVisibleMs: 600_000 });
    writeFileSync(path, "{ not json");
    // The change returns null: no fresh record is written, so the file is gone.
    await update(config, () => null);
    expect(seen).toEqual(["moved"]);
    expect(existsSync(path)).toBe(false);
    for (let index = 0; index < 4; index += 1) { time += 1000; await update(config, () => null); }
    mkdirSync(path);
    time += 1000; await update(config, (record: any) => record);
    expect(seen).toEqual(["moved"]);
    rmSync(path, { recursive: true, force: true });
    time += 600_000; await update(config, (record: any) => record);
    expect(seen).toEqual(["moved", null]);
  });

  it("when the damaged record cannot be moved aside the problem is stuck, and clears at the next good read", async () => {
    const { config, path } = setup();
    const { lines, onLog } = logs();
    const seen: (string | null)[] = [];
    const update = createRecordUpdater({ onLog, onStatus: (status: string | null) => { seen.push(status); }, retryMs: 1, unreadableLimit: 1, moveRecordAside: async () => false });
    writeFileSync(path, "{ not json");
    expect(await update(config, (record: any) => record)).toBeNull();
    expect(seen).toEqual(["stuck"]);
    expect(lines).toContain(RECORD_STUCK);
    expect(readFileSync(path, "utf8")).toBe("{ not json");
    writeFileSync(path, JSON.stringify({ version: 1, runs: {}, servers: {}, outcomes: {} }));
    await update(config, (record: any) => record);
    expect(seen).toEqual(["stuck", null]);
  });

  it("the engine's wiring: updater status -> parkedRecordState -> the Problems list, with the wording by severity", async () => {
    const { config, path } = setup();
    const state: { parkedRecord: ReturnType<typeof parkedRecordState> } = { parkedRecord: null };
    const emitted: unknown[] = [];
    const update = createRecordUpdater({ onLog: () => {}, onStatus: (status: string | null) => { state.parkedRecord = parkedRecordState(status); emitted.push(state.parkedRecord); }, retryMs: 1, unreadableLimit: 1, moveRecordAside: async () => false });
    writeFileSync(path, "{ not json");
    await update(config, (record: any) => record);
    expect(companionProblems({ state }).find((problem: any) => problem.id === "parked-record-damaged")).toEqual({ id: "parked-record-damaged", data: { stuck: true } });
    // A lock does not clear it.
    rmSync(path); mkdirSync(path);
    await update(config, (record: any) => record);
    expect(companionProblems({ state }).map((problem: any) => problem.id)).toContain("parked-record-damaged");
    expect(emitted).toHaveLength(1);
    // Wording: stuck is a "bad" item, moved is a "warn" item.
    const stuck = mainStatus({ state, problems: companionProblems({ state }) }).needsYou;
    expect(stuck).toMatchObject({ id: "parked-record-damaged", tone: "bad" });
    const moved = mainStatus({ state: { parkedRecord: { moved: true, stuck: false } }, problems: [{ id: "parked-record-damaged", data: { stuck: false } }] }).needsYou;
    expect(moved).toMatchObject({ id: "parked-record-damaged", tone: "warn" });
    expect(parkedRecordState(null)).toBeNull();
  });

  it("the Problems entry carries only its safe value in a report", () => {
    const [entry] = reportableProblems([{ id: "parked-record-damaged", data: { stuck: true, path: "C:\\secret" } }]);
    expect(entry).toEqual({ id: "parked-record-damaged", stuck: true });
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
