/* eslint-disable @typescript-eslint/no-explicit-any -- an in-memory stand-in for the few Prisma calls the lane makes */
import { afterEach, describe, expect, it, vi } from "vitest";
import { agrees, type PublicRunStore, type RunSummary, type StoredRun } from "../src/services/public-runs.js";
import { applyCarriedRecords, CARRY_RECEIPT_PREFIX } from "../src/services/carried-records.js";
import { parseRunId, unpackCarriedRun } from "../src/services/carried-runs.js";

// 9.3.3 (owner decision 14 November 2026): one carried statement of a run is ranked like any single unsigned reporter's run, but only for the
// player whose id the run carries; a placed run is never changed by a later statement; floods are bounded by server-side limits.

const NOW = new Date(Math.floor(Date.now() / 60_000) * 60_000);
const start = Math.floor(NOW.getTime() / 1000) - 7200;
const stamp = (at: number) => new Date(at * 1000).toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "").replace("T", "-");
const idFor = (name: string, at = start) => `QG-${stamp(at)}-${name}`;
const RUNKEY = `389:${idFor("Aye")}`;
const data = (over: Record<string, unknown> = {}) => ({ id: idFor("Aye"), i: 389, d: 1, st: start, en: start + 1500, cb: "final boss", nm: "Ragefire Chasm",
  p1: "Aye;WARRIOR;TANK;20;1400;0", p2: "Zed;MAGE;DAMAGER;20;1380;1", ev: `2735:${start + 1500}`, ...over });
const record = (author = "Aye", key = "QG-1-aaaaaa", over: Record<string, unknown> = {}) => ({ kind: "run", key, author, data: data({ id: idFor(author.split("-")[0]!), ...over }) });

afterEach(() => { delete process.env["RUN_INTEGRITY_CONFIG"]; });

// A store that behaves like the public one for what these tests need: a run is created once, a later upload of the same run id goes through
// addUpload (counted: a carried statement must never reach it), and a run only relayed copies made can be discarded.
function memoryStore() {
  const runs = new Map<string, StoredRun & { summary: RunSummary }>();
  const uploads: { key: string; at: Date }[] = [];
  const calls = { addUpload: 0, discard: 0, restore: 0 };
  const failNext = { create: false };
  let next = 0;
  const store: PublicRunStore = {
    async findRun(runKey) { return runs.get(runKey) ?? null; },
    async findRunsNear(_edition, instanceId, startedAt, windowSec) {
      return [...runs.values()].filter((row) => row.instanceId === instanceId && Math.abs(row.startedAt.getTime() - startedAt.getTime()) <= windowSec * 1000);
    },
    async createRun(summary, uploader) { if (failNext.create) { failNext.create = false; throw new Error("store down"); } uploads.push({ key: uploader.key, at: NOW }); runs.set(summary.runKey, { ...summary, id: `r${++next}`, status: "ACCEPTED", uploaders: [uploader.key], reporters: [...uploader.reporters], summary, confirmations: 1 } as never); },
    async addUpload(runId, uploader, summary) {
      calls.addUpload++;
      const row = [...runs.values()].find((entry) => entry.id === runId)!;
      const agree = agrees(row, summary);
      row.uploaders.push(uploader.key);
      uploads.push({ key: uploader.key, at: NOW });
      if (!agree) row.status = "DISPUTED";
      return { agree, duplicate: false };
    },
    async uploadsSince(key, since) { return uploads.filter((entry) => entry.key === key && entry.at >= since).length; },
    async storedRefs() { return []; },
    async relayRunBackup(runId) { const entry = [...runs.entries()].find(([, row]) => row.id === runId); return entry ? { key: entry[0], row: { ...entry[1] } } : null; },
    async restoreRelayRun(backup) { const saved = backup as { key: string; row: StoredRun & { summary: RunSummary } }; if (!runs.has(saved.key)) { calls.restore++; runs.set(saved.key, saved.row); } },
    async discardRelayRun(runId) {
      const entry = [...runs.entries()].find(([, row]) => row.id === runId);
      if (!entry || !entry[1].uploaders.every((key) => key.startsWith("relay:"))) return false;
      calls.discard++;
      runs.delete(entry[0]);
      return true;
    }
  };
  return { store, runs, calls, failNext };
}

interface Row { id: number; kind: string; key: string; author: string; authorKey: string; carrier: string; status: string; runKey?: string | null; createdAt: Date }
function fakeDb() {
  const rows: Row[] = [];
  let counter = 0;
  const matches = (row: Row, where: any): boolean => Object.entries(where ?? {}).every(([field, wanted]) => {
    if (field === "createdAt" && (wanted as any)?.lt) return row.createdAt < (wanted as any).lt;
    if (field === "createdAt" && (wanted as any)?.gte) return row.createdAt >= (wanted as any).gte;
    if (field === "carrier" && typeof wanted === "object") return row.carrier.startsWith((wanted as any).startsWith);
    return (row as any)[field] === wanted;
  });
  const db: any = {
    carriedRecord: {
      count: async ({ where }: any) => rows.filter((row) => matches(row, where)).length,
      findUnique: async ({ where }: any) => rows.find((row) => row.kind === where.kind_authorKey_key.kind && row.authorKey === where.kind_authorKey_key.authorKey && row.key === where.kind_authorKey_key.key) ?? null,
      findMany: async ({ where, distinct }: any) => {
        let out = rows.filter((row) => matches(row, where));
        if (distinct) out = out.filter((row, index) => out.findIndex((other) => (other as any)[distinct[0]] === (row as any)[distinct[0]]) === index);
        return out;
      },
      create: async ({ data: created }: any) => {
        if (rows.some((row) => row.kind === created.kind && row.authorKey === created.authorKey && row.key === created.key)) throw Object.assign(new Error("unique"), { code: "P2002" });
        rows.push({ id: ++counter, createdAt: NOW, ...created }); return created;
      },
      updateMany: async ({ where, data: changes }: any) => { const hit = rows.filter((row) => matches(row, where)); for (const row of hit) Object.assign(row, changes); return { count: hit.length }; },
      deleteMany: async ({ where }: any) => { const hit = rows.filter((row) => matches(row, where)); for (const row of hit) rows.splice(rows.indexOf(row), 1); return { count: hit.length }; }
    }
  };
  return { db, rows };
}
const apply = (db: any, store: PublicRunStore, records: unknown[], carrier: string, extra: Record<string, unknown> = {}, keys: string[] = ["carrier one"]) =>
  applyCarriedRecords(db, { carrier, carrierKeys: new Set(keys), now: NOW, records, relay: { store }, ...extra });
const receipt = (key: string) => `${CARRY_RECEIPT_PREFIX}run:${key}`;
const placed = (runs: Map<string, StoredRun & { summary: RunSummary }>, key = RUNKEY) => runs.get(key)!;

describe("unpacking a carried run and its id", () => {
  it("rebuilds a finished Forever run from the flat record, and refuses what is not one", () => {
    const unpacked = unpackCarriedRun(data())!;
    expect(unpacked.runKey).toBe(RUNKEY);
    expect(unpacked.players).toEqual(["Aye", "Zed"]);
    expect(unpacked.run).toMatchObject({ state: "COMPLETED", instanceId: 389, completedBy: "final boss" });
    expect(unpackCarriedRun(data({ p1: "Aye;WARRIOR;TANK;x;1400;0" }))).toBeNull();
    expect(unpackCarriedRun(data({ p1: undefined, p2: undefined }))).toBeNull();
    expect(unpackCarriedRun(data({ ev: "abc" }))).toBeNull();
    expect(unpackCarriedRun({ ...data(), i: -1 })).toBeNull();
    expect(unpackCarriedRun("nope")).toBeNull();
  });

  it("reads the recorder and the time out of an addon run id", () => {
    expect(parseRunId("QG-20261210-100000-Aye")).toEqual({ at: Date.UTC(2026, 11, 10, 10, 0, 0) / 1000, recorder: "aye" });
    expect(parseRunId("QG-20261210-100000-Aye-Realm")?.recorder).toBe("aye");
    expect(parseRunId("something else")).toBeNull();
  });
});

describe("carried dungeon runs", () => {
  it("a single statement is placed on the public boards and the carrier is told", async () => {
    const { db, rows } = fakeDb();
    const { store, runs } = memoryStore();
    const shared: unknown[][] = [];
    const out = await apply(db, store, [record()], "device:1", { relay: { store, onPlaced: (list: unknown[]) => shared.push(list) } });
    expect(out.receipts).toEqual([receipt("QG-1-aaaaaa")]);
    expect(placed(runs)).toMatchObject({ status: "ACCEPTED" });
    expect(shared).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "applied", runKey: RUNKEY, authorKey: "aye" });
  });

  it("an id naming someone who is not in the run is refused for good, with a receipt", async () => {
    const { db, rows } = fakeDb();
    const { store, runs } = memoryStore();
    // Mallory is in the party but claims the id of a player (Nobody) who is not.
    const forged = { kind: "run", key: "QG-9-mmmmmm", author: "Mallory", data: data({ id: idFor("Nobody"), p3: "Mallory;ROGUE;DAMAGER;20;1300;0" }) };
    const first = await apply(db, store, [forged], "member:mallory");
    expect(first.receipts).toEqual([receipt("QG-9-mmmmmm")]);
    expect(runs.size).toBe(0);
    expect(rows[0]).toMatchObject({ status: "rejected" });
    const honest = await apply(db, store, [record("Aye")], "device:1");
    expect(honest.receipts).toEqual([receipt("QG-1-aaaaaa")]);
    expect(placed(runs).summary.durationSec).toBe(1500);
  });

  it("(G7) a statement under another player's id is placed as a relayed copy when that player is in the run, and the id owner's own statement still replaces it", async () => {
    const { db } = fakeDb();
    const { store, runs, calls } = memoryStore();
    const copyOfAye = { kind: "run", key: "QG-9-mmmmmm", author: "Zed", data: data({ id: idFor("Aye"), en: start + 1600 }) };
    const first = await apply(db, store, [copyOfAye], "device:zed");
    expect(first.receipts).toEqual([receipt("QG-9-mmmmmm")]);
    expect(placed(runs).uploaders).toEqual(["relay:device:zed"]);
    const honest = await apply(db, store, [record("Aye")], "device:1");
    expect(honest.receipts).toEqual([receipt("QG-1-aaaaaa")]);
    expect(calls.discard).toBe(1);
    expect(placed(runs).summary.durationSec).toBe(1500);
  });

  it("a statement whose id time is far from the run's start, or whose author is not in the run, is refused with a receipt and places nothing", async () => {
    const { db, rows } = fakeDb();
    const { store, runs } = memoryStore();
    const out = await apply(db, store, [
      { kind: "run", key: "QG-T-tttttt", author: "Aye", data: data({ id: idFor("Aye", start - 6 * 3600) }) },
      record("Mallory"),
      { kind: "run", key: "QG-5-hhhhhh", author: "Aye", data: { id: "x" } }], "device:1");
    expect(out.receipts).toEqual([receipt("QG-T-tttttt"), receipt("QG-1-aaaaaa"), receipt("QG-5-hhhhhh")]);
    expect(runs.size).toBe(0);
    expect(rows.map((row) => row.status)).toEqual(["rejected", "rejected", "rejected"]);
  });

  it("the same carrier sending the run again under another record key is a receipted duplicate, not a revision", async () => {
    const { db, rows } = fakeDb();
    const { store, runs, calls } = memoryStore();
    await apply(db, store, [record("Aye", "QG-1-aaaaaa")], "device:1");
    const again = await apply(db, store, [record("Aye", "QG-2-bbbbbb", { en: start + 1400 })], "device:1");
    expect(again.receipts).toEqual([receipt("QG-2-bbbbbb")]);
    expect(rows).toHaveLength(1);
    expect(placed(runs).summary.durationSec).toBe(1500);
    expect(calls.addUpload).toBe(0);
  });

  it("an agreeing or disagreeing later statement from another carrier leaves the placed run untouched, and is receipted", async () => {
    const { db } = fakeDb();
    const { store, runs, calls } = memoryStore();
    await apply(db, store, [record("Aye")], "device:1");
    const before = JSON.stringify(placed(runs).summary);
    const agreeing = await apply(db, store, [record("Aye", "QG-2-bbbbbb")], "member:m2");
    const different = await apply(db, store, [record("Aye", "QG-3-cccccc", { en: start + 2400, d: 2, p2: "Zed;MAGE;DAMAGER;20;900;5" })], "member:m3");
    expect(agreeing.receipts).toEqual([receipt("QG-2-bbbbbb")]);
    expect(different.receipts).toEqual([receipt("QG-3-cccccc")]);
    expect(JSON.stringify(placed(runs).summary)).toBe(before);
    expect(placed(runs).status).toBe("ACCEPTED");
    expect(placed(runs).uploaders).toHaveLength(1);
    expect(calls.addUpload).toBe(0);
  });

  it("a run placed only by other players' relayed copies gives way once to its own recorder's statement when that disagrees", async () => {
    const { db } = fakeDb();
    const { store, runs, calls } = memoryStore();
    // Someone else's relayed copy of Aye's run, with a result that differs from what Aye recorded.
    await store.createRun({ ...({} as RunSummary), ...unpackedSummary({ en: start + 2000 }) }, { key: "relay:device:x", reporters: [] }, "personal");
    expect(placed(runs).summary.durationSec).toBe(2000);
    await apply(db, store, [record("Aye", "QG-1-aaaaaa")], "member:aye");
    expect(calls.discard).toBe(1);
    expect(placed(runs).summary.durationSec).toBe(1500);
    // Once: a later disagreeing statement does not replace it again.
    await apply(db, store, [record("Aye", "QG-2-bbbbbb", { en: start + 2500 })], "member:other");
    expect(calls.discard).toBe(1);
    expect(placed(runs).summary.durationSec).toBe(1500);
  });

  it("a recorder's statement that would be held or over the carrier's limit never deletes the run it was going to replace", async () => {
    process.env["RUN_INTEGRITY_CONFIG"] = JSON.stringify({ relayedRunsPerDay: 1 });
    const { db } = fakeDb();
    const { store, runs, calls } = memoryStore();
    await store.createRun({ ...({} as RunSummary), ...unpackedSummary({ en: start + 2000 }) }, { key: "relay:device:x", reporters: [] }, "personal");
    // The carrier's day is used up (the relayed copy above counts), so the statement cannot be placed after a discard.
    const out = await apply(db, store, [record("Aye", "QG-1-aaaaaa")], "device:x");
    expect(calls.discard).toBe(0);
    expect(placed(runs).summary.durationSec).toBe(2000);
    expect(out.receipts).toEqual([]);
  });

  const zedId = idFor("Zed", start + 20);
  /** A copy of the run another player's addon relayed under that player's own id, with a different result. */
  const relayedCopy = (over: Record<string, unknown> = { en: start + 2000 }) => ({ ...unpackedSummary(over), runKey: `389:${zedId}`, runRef: zedId });

  it("a run placed first under another id (relayed copies) gives way to the honest recorder's differing statement, logged", async () => {
    const { db } = fakeDb();
    const { store, runs, calls } = memoryStore();
    await store.createRun(relayedCopy() as RunSummary, { key: "relay:device:x", reporters: [] }, "personal");
    const out = await apply(db, store, [record("Aye")], "member:aye");
    expect(out.receipts).toEqual([receipt("QG-1-aaaaaa")]);
    expect(calls.discard).toBe(1);
    expect(runs.size).toBe(1);
    expect(placed(runs).summary.durationSec).toBe(1500);
  });

  it("a replaced run is noted for the owner in a row that outlives the run rows, and is never replaced a second time", async () => {
    const { db, rows } = fakeDb();
    const { store, runs, calls } = memoryStore();
    await store.createRun(relayedCopy() as RunSummary, { key: "relay:device:x", reporters: [] }, "personal");
    await apply(db, store, [record("Aye")], "member:aye");
    const note = rows.find((row) => row.kind === "replaced-run");
    expect(note).toMatchObject({ status: "replaced", runKey: RUNKEY });
    expect(note!.author).toContain("2000s");
    // The run rows are cleaned after the holding time; the note stays, and the replacement does not open again for an old run.
    for (const row of rows.filter((entry) => entry.kind === "run")) rows.splice(rows.indexOf(row), 1);
    await apply(db, store, [record("Aye", "QG-5-eeeeee", { en: start + 2500, ev: `2735:${start + 2500}` })], "member:other");
    expect(calls.discard).toBe(1);
    expect(placed(runs).summary.durationSec).toBe(1500);
  });

  it("known limit: a forged run placed first under the forger's own name stays, and the honest recorder's statement is filed as differs", async () => {
    const { db, rows } = fakeDb();
    const { store, runs } = memoryStore();
    const forgerId = idFor("Mallory", start + 20);
    const party = { p3: "Mallory;ROGUE;DAMAGER;20;1300;0" };
    await apply(db, store, [{ kind: "run", key: "QG-9-mmmmmm", author: "Mallory", data: data({ id: forgerId, en: start + 3000, ev: `2735:${start + 3000}`, ...party }) }], "member:mallory");
    expect(runs.size).toBe(1);
    const honest = await apply(db, store, [record("Aye", "QG-1-aaaaaa", party)], "member:aye");
    expect(honest.receipts).toEqual([receipt("QG-1-aaaaaa")]);
    expect(runs.size).toBe(1);
    expect(placed(runs, `389:${forgerId}`).summary.durationSec).toBe(3000);
    expect(rows.find((row) => row.carrier === "member:aye")).toMatchObject({ status: "differs" });
  });

  it("a failed lookup before putting the original back is not read as nothing there: nothing is restored", async () => {
    const { db } = fakeDb();
    const { store, runs, calls, failNext } = memoryStore();
    await store.createRun(relayedCopy() as RunSummary, { key: "relay:device:x", reporters: [] }, "personal");
    failNext.create = true;
    const find = store.findRun.bind(store);
    store.findRun = async (key) => { if (calls.discard > 0) throw new Error("database busy"); return find(key); };
    await apply(db, store, [record("Aye")], "member:aye");
    expect(calls.discard).toBe(1);
    expect(calls.restore).toBe(0);
    expect(runs.size).toBe(0);
  });

  it("an error after the replacement was created does not put the original back beside it", async () => {
    const { db } = fakeDb();
    const { store, runs, calls } = memoryStore();
    await store.createRun(relayedCopy() as RunSummary, { key: "relay:device:x", reporters: [] }, "personal");
    await apply(db, store, [record("Aye")], "member:aye", { relay: { store, onPlaced: () => { throw new Error("announcement failed"); } } });
    expect(calls.restore).toBe(0);
    expect(runs.size).toBe(1);
    expect(placed(runs).summary.durationSec).toBe(1500);
  });

  it("a differing statement from someone else never changes a placed run: it is receipted and recorded as differs", async () => {
    const { db, rows } = fakeDb();
    const { store, runs } = memoryStore();
    await apply(db, store, [record("Aye")], "member:aye");
    const out = await apply(db, store, [record("Zed", "QG-2-zzzzzz", { id: zedId, en: start + 2600, ev: `2735:${start + 2600}` })], "member:zed");
    expect(out.receipts).toEqual([receipt("QG-2-zzzzzz")]);
    expect(runs.size).toBe(1);
    expect(placed(runs).summary.durationSec).toBe(1500);
    expect(rows.find((row) => row.carrier === "member:zed")).toMatchObject({ status: "differs" });
  });

  it("a replacement held by a plausibility check keeps the original run, and the statement is closed after a few days of retries", async () => {
    const { db, rows } = fakeDb();
    const { store, runs, calls } = memoryStore();
    await store.createRun(relayedCopy() as RunSummary, { key: "relay:device:x", reporters: [] }, "personal");
    // A boss killed in four seconds is not a plausible clear.
    const fast = record("Aye", "QG-1-aaaaaa", { en: start + 4, ev: `2735:${start + 4}` });
    const first = await apply(db, store, [fast], "member:aye");
    expect(first.receipts).toEqual([]);
    expect(calls.discard).toBe(0);
    expect(placed(runs, `389:${zedId}`).summary.durationSec).toBe(2000);
    expect(rows.find((row) => row.carrier === "member:aye")).toMatchObject({ status: "held" });
    // Later: still refused, until the retry time is over; then it is receipted as permanently refused.
    const later = await apply(db, store, [fast], "member:aye", { now: new Date(NOW.getTime() + 3 * 86_400_000) });
    expect(later.receipts).toEqual([receipt("QG-1-aaaaaa")]);
    expect(placed(runs, `389:${zedId}`).summary.durationSec).toBe(2000);
    // Closed for good: sent again, it is receipted at once and stays closed.
    const again = await apply(db, store, [fast], "member:aye", { now: new Date(NOW.getTime() + 4 * 86_400_000) });
    expect(again.receipts).toEqual([receipt("QG-1-aaaaaa")]);
    expect(rows.find((row) => row.carrier === "member:aye")).toMatchObject({ status: "refused" });
  });

  it("if placing the replacement fails after the original was removed, the original is put back", async () => {
    const { db } = fakeDb();
    const { store, runs, calls, failNext } = memoryStore();
    await store.createRun(relayedCopy() as RunSummary, { key: "relay:device:x", reporters: [] }, "personal");
    failNext.create = true;
    const out = await apply(db, store, [record("Aye")], "member:aye");
    expect(out.receipts).toEqual([]);
    expect(calls.discard).toBe(1);
    expect(calls.restore).toBe(1);
    expect(runs.size).toBe(1);
    expect(placed(runs, `389:${zedId}`).summary.durationSec).toBe(2000);
  });

  it("two recorders' statements of one real run make one run, the second is a receipted confirmation", async () => {
    const { db, rows } = fakeDb();
    const { store, runs } = memoryStore();
    await apply(db, store, [record("Aye")], "member:aye");
    const second = await apply(db, store, [record("Zed", "QG-2-zzzzzz", { id: idFor("Zed", start + 20) })], "member:zed");
    expect(runs.size).toBe(1);
    expect(second.receipts).toEqual([receipt("QG-2-zzzzzz")]);
    expect(rows.filter((row) => row.status === "applied")).toHaveLength(1);
    expect(rows.filter((row) => row.status === "copy")).toHaveLength(1);
  });

  it("the same party running the same dungeon an hour later is a second run", async () => {
    const { db } = fakeDb();
    const { store, runs } = memoryStore();
    await apply(db, store, [record("Aye")], "member:aye");
    const later = start + 3600;
    await apply(db, store, [{ kind: "run", key: "QG-3-cccccc", author: "Zed", data: data({ id: idFor("Zed", later), st: later, en: later + 1500, ev: `2735:${later + 1500}` }) }], "member:zed");
    expect(runs.size).toBe(2);
  });

  it("a run the carrier played in is its own upload's business; the roster of other players is never the carrier's own", async () => {
    const own = fakeDb();
    const ownStore = memoryStore();
    const ownOut = await apply(own.db, ownStore.store, [record("Aye")], "device:1", {}, ["zed"]);
    expect(ownOut.receipts).toEqual([receipt("QG-1-aaaaaa")]);
    expect(ownStore.runs.size).toBe(0);
    expect(own.rows[0]).toMatchObject({ status: "own" });
    const other = fakeDb();
    const otherStore = memoryStore();
    await apply(other.db, otherStore.store, [record("Aye")], "member:m1", {}, ["somebody else"]);
    expect(otherStore.runs.size).toBe(1);
  });

  it("without a public store nothing is placed", async () => {
    const { db } = fakeDb();
    const out = await applyCarriedRecords(db, { carrier: "device:1", carrierKeys: new Set(["x"]), now: NOW, records: [record()] });
    expect(out.receipts).toEqual([]);
  });

  it("a run over the carrier's daily relay limit is not placed and not receipted", async () => {
    process.env["RUN_INTEGRITY_CONFIG"] = JSON.stringify({ relayedRunsPerDay: 1 });
    const { db } = fakeDb();
    const { store, runs } = memoryStore();
    const later = start - 9000;
    const out = await apply(db, store, [record("Aye", "QG-1-aaaaaa"), { kind: "run", key: "QG-2-bbbbbb", author: "Aye", data: data({ id: idFor("Aye", later), st: later, en: later + 1500, ev: `2735:${later + 1500}` }) }], "device:1");
    expect(runs.size).toBe(1);
    expect(out.receipts).toEqual([receipt("QG-1-aaaaaa")]);
  });
});

/** The summary of the run the default record describes, with some fields changed (what a relayed copy would have made). */
function unpackedSummary(over: Record<string, unknown>): RunSummary {
  const unpacked = unpackCarriedRun(data(over))!;
  const run = unpacked.run as any;
  return {
    gameEdition: "forever", runKey: unpacked.runKey, runRef: run.id, instanceId: run.instanceId, dungeonName: run.name, difficultyId: run.difficultyId,
    startedAt: new Date(run.startedAt * 1000), endedAt: new Date(run.endedAt * 1000), durationSec: run.endedAt - run.startedAt, deaths: 1, maxLevel: 20, bracket: null, season: null,
    routeKey: "r", evidenceVersion: 1, evidenceReceivedAt: NOW, completedBy: "final boss", encounters: run.encounters,
    players: run.players.map((player: any) => ({ character: player.character, realm: "", className: player.class, role: "DAMAGER", level: player.level, minLevel: null, presentSec: player.presentSec, deaths: player.deaths }))
  } as unknown as RunSummary;
}

describe("floods", () => {
  it("unsigned devices are capped low for one run, answers stay receipted, and signed members keep their room", async () => {
    const { db, rows } = fakeDb();
    const { store, runs } = memoryStore();
    const answers: string[][] = [];
    for (let index = 0; index < 8; index += 1) answers.push((await apply(db, store, [record("Aye", `QG-d${index}-dddddd`)], `device:${index}`)).receipts);
    expect(answers.every((receipts) => receipts.length === 1)).toBe(true);
    expect(rows.filter((row) => row.carrier.startsWith("device:"))).toHaveLength(5);
    const signed = await apply(db, store, [record("Aye", "QG-s-ssssss")], "member:m1");
    expect(signed.receipts).toEqual([receipt("QG-s-ssssss")]);
    expect(rows.filter((row) => row.carrier.startsWith("member:"))).toHaveLength(1);
    expect(runs.size).toBe(1);
  });

  it("one carrier hands in only so many distinct runs per day (server configuration)", async () => {
    process.env["RUN_INTEGRITY_CONFIG"] = JSON.stringify({ carriedRunKeysPerDayDevice: 3 });
    const { db } = fakeDb();
    const { store, runs } = memoryStore();
    for (let index = 0; index < 6; index += 1) {
      const at = start - index * 7200;
      await apply(db, store, [{ kind: "run", key: `QG-r${index}-rrrrrr`, author: "Aye", data: data({ id: idFor("Aye", at), st: at, en: at + 1500, ev: `2735:${at + 1500}` }) }], "device:1");
    }
    expect(runs.size).toBe(3);
  });

  it("(G2) every recorder's copy of one real run costs the carrier no key: one run is one key against the day's limit", async () => {
    process.env["RUN_INTEGRITY_CONFIG"] = JSON.stringify({ carriedRunKeysPerDayDevice: 2, carriedRunRowsPerCarrierRun: 5, carriedRunRowsPerRunDevice: 10 });
    const { db, rows } = fakeDb();
    const { store, runs } = memoryStore();
    // Four statements of the same run (each recorder's id, each statement a copy of the first): without the rule they would use four keys.
    const first = await apply(db, store, [record("Aye")], "device:g2");
    const copies = await apply(db, store, [1, 2, 3].map((n) => record("Zed", `QG-z${n}-zzzzzz`, { id: idFor("Zed", start + 20 * n) })), "device:g2");
    expect(first.receipts).toHaveLength(1);
    expect(copies.receipts).toHaveLength(3);
    expect(runs.size).toBe(1);
    expect(rows.filter((row) => row.status === "copy")).toHaveLength(3);
    // Two more real runs fit under the limit of two distinct runs...
    const at = start - 7200;
    const second = await apply(db, store, [{ kind: "run", key: "QG-r2-rrrrrr", author: "Aye", data: data({ id: idFor("Aye", at), st: at, en: at + 1500, ev: `2735:${at + 1500}` }) }], "device:g2");
    expect(second.receipts).toHaveLength(1);
    expect(runs.size).toBe(2);
    // ...and the third is the one that bites (once logged, held for tomorrow: not receipted).
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      const later = start - 14400;
      const third = { kind: "run", key: "QG-r3-rrrrrr", author: "Aye", data: data({ id: idFor("Aye", later), st: later, en: later + 1500, ev: `2735:${later + 1500}` }) };
      expect((await apply(db, store, [third], "device:g2")).receipts).toEqual([]);
      const logged = info.mock.calls.map((call) => String(call[0])).filter((line) => /reached its limit of 2 distinct runs/.test(line));
      expect(logged).toHaveLength(1);
      await apply(db, store, [{ ...third, key: "QG-r3-again" }], "device:g2");
      expect(info.mock.calls.map((call) => String(call[0])).filter((line) => /reached its limit/.test(line))).toHaveLength(1);
    } finally { info.mockRestore(); }
    expect(runs.size).toBe(2);
  });

  it("finished rows are deleted after the holding time", async () => {
    const { db, rows } = fakeDb();
    const { store } = memoryStore();
    await apply(db, store, [record("Aye")], "device:1");
    rows[0]!.createdAt = new Date(NOW.getTime() - 31 * 86_400_000);
    await apply(db, store, [], "device:2", { now: new Date(NOW.getTime() + 11 * 60_000) });
    expect(rows).toHaveLength(0);
  });
});
