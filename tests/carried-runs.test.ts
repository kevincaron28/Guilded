/* eslint-disable @typescript-eslint/no-explicit-any -- an in-memory stand-in for the few Prisma calls the lane makes */
import { afterEach, describe, expect, it } from "vitest";
import { agrees, type PublicRunStore, type RunSummary, type StoredRun } from "../src/services/public-runs.js";
import { applyCarriedRecords, CARRY_RECEIPT_PREFIX } from "../src/services/carried-records.js";
import { unpackCarriedRun } from "../src/services/carried-runs.js";

// 9.3.3 (owner decision 14 November 2026): one carried statement of a run is ranked like any single unsigned reporter's run. A later statement
// of the same run only confirms it; floods are bounded by server-side limits.

const NOW = new Date(Math.floor(Date.now() / 60_000) * 60_000);
const start = Math.floor(NOW.getTime() / 1000) - 7200;
const data = (over: Record<string, unknown> = {}) => ({ id: "QG-20261210-100000-Aye", i: 389, d: 1, st: start, en: start + 1500, cb: "final boss", nm: "Ragefire Chasm",
  p1: "Aye;WARRIOR;TANK;20;1400;0", p2: "Zed;MAGE;DAMAGER;20;1380;1", ev: `2735:${start + 1500}`, ...over });
const record = (author = "Aye", key = "QG-1-aaaaaa", over: Record<string, unknown> = {}) => ({ kind: "run", key, author, data: data(over) });

afterEach(() => { delete process.env["RUN_INTEGRITY_CONFIG"]; });

function memoryStore() {
  const runs = new Map<string, StoredRun & { summary: RunSummary }>();
  const uploads: { key: string; at: Date }[] = [];
  let next = 0;
  const store: PublicRunStore = {
    async findRun(runKey) { return runs.get(runKey) ?? null; },
    async createRun(summary, uploader) { uploads.push({ key: uploader.key, at: NOW }); runs.set(summary.runKey, { ...summary, id: `r${++next}`, status: "ACCEPTED", uploaders: [uploader.key], reporters: [...uploader.reporters], summary, confirmations: 1 } as never); },
    async addUpload(runId, uploader, summary) {
      const row = [...runs.values()].find((entry) => entry.id === runId)!;
      const agree = agrees(row, summary);
      row.uploaders.push(uploader.key);
      uploads.push({ key: uploader.key, at: NOW });
      row.reporters.push(...uploader.reporters);
      if (!agree) row.status = "DISPUTED";
      return { agree, duplicate: false };
    },
    async uploadsSince(key, since) { return uploads.filter((entry) => entry.key === key && entry.at >= since).length; },
    async storedRefs() { return []; },
    async discardRelayRun() { return false; }
  };
  return { store, runs };
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

describe("unpacking a carried run", () => {
  it("rebuilds a finished Forever run from the flat record, and refuses what is not one", () => {
    const unpacked = unpackCarriedRun(data())!;
    expect(unpacked.runKey).toBe("389:QG-20261210-100000-Aye");
    expect(unpacked.players).toEqual(["Aye", "Zed"]);
    expect(unpacked.run).toMatchObject({ state: "COMPLETED", instanceId: 389, completedBy: "final boss" });
    expect(unpackCarriedRun(data({ p1: "Aye;WARRIOR;TANK;x;1400;0" }))).toBeNull();
    expect(unpackCarriedRun(data({ p1: undefined, p2: undefined }))).toBeNull();
    expect(unpackCarriedRun(data({ ev: "abc" }))).toBeNull();
    expect(unpackCarriedRun({ ...data(), i: -1 })).toBeNull();
    expect(unpackCarriedRun("nope")).toBeNull();
  });
});

describe("carried dungeon runs", () => {
  it("a single statement is placed on the public boards and the carrier is told", async () => {
    const { db, rows } = fakeDb();
    const { store, runs } = memoryStore();
    const placed: unknown[][] = [];
    const out = await apply(db, store, [record()], "device:1", { relay: { store, onPlaced: (list: unknown[]) => placed.push(list) } });
    expect(out.receipts).toEqual([receipt("QG-1-aaaaaa")]);
    expect(runs.size).toBe(1);
    expect(runs.get("389:QG-20261210-100000-Aye")).toMatchObject({ status: "ACCEPTED" });
    expect(placed).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "applied", runKey: "389:QG-20261210-100000-Aye", authorKey: "aye" });
  });

  it("a second agreeing statement of the same run is no new run, and is receipted", async () => {
    const { db } = fakeDb();
    const { store, runs } = memoryStore();
    await apply(db, store, [record("Aye")], "device:1");
    const second = await apply(db, store, [record("Zed", "QG-2-bbbbbb")], "member:m2");
    expect(runs.size).toBe(1);
    expect(second.receipts).toEqual([receipt("QG-2-bbbbbb")]);
  });

  it("a second, disagreeing statement does not change the placed run and is not receipted (logged for review)", async () => {
    const { db, rows } = fakeDb();
    const { store, runs } = memoryStore();
    await apply(db, store, [record("Aye")], "device:1");
    const before = JSON.stringify([...runs.values()].map((row) => row.summary));
    const second = await apply(db, store, [record("Zed", "QG-2-bbbbbb", { en: start + 2400, d: 2 })], "member:m2");
    expect(second.receipts).toEqual([]);
    expect(JSON.stringify([...runs.values()].map((row) => row.summary))).toBe(before);
    expect([...runs.values()][0]!.status).toBe("ACCEPTED");
    expect(rows.find((row) => row.carrier === "member:m2")).toMatchObject({ status: "rejected" });
  });

  it("refuses a statement whose author is not in the run, and a malformed one; neither is placed or receipted", async () => {
    const { db, rows } = fakeDb();
    const { store, runs } = memoryStore();
    const out = await apply(db, store, [record("Mallory"), { kind: "run", key: "QG-5-hhhhhh", author: "Aye", data: { id: "x" } }], "device:1");
    expect(out.receipts).toEqual([]);
    expect(runs.size).toBe(0);
    expect(rows.map((row) => row.status)).toEqual(["rejected", "rejected"]);
  });

  it("a run the carrier played in is its own upload's business; the roster of other players is never the carrier's own", async () => {
    const own = fakeDb();
    const ownStore = memoryStore();
    const ownOut = await apply(own.db, ownStore.store, [record("Aye")], "device:1", {}, ["zed"]);
    expect(ownOut.receipts).toEqual([receipt("QG-1-aaaaaa")]);
    expect(ownStore.runs.size).toBe(0);
    expect(own.rows[0]).toMatchObject({ status: "own" });
    // A carrier whose own characters are not in the run places it, however many guildmates are in it.
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

  it("a run over the carrier's daily relay limit is refused, not receipted", async () => {
    process.env["RUN_INTEGRITY_CONFIG"] = JSON.stringify({ relayedRunsPerDay: 1 });
    const { db } = fakeDb();
    const { store, runs } = memoryStore();
    const out = await apply(db, store, [record("Aye", "QG-1-aaaaaa"), record("Aye", "QG-2-bbbbbb", { id: "QG-other-Aye", st: start - 9000, en: start - 7500, ev: `2735:${start - 7500}` })], "device:1");
    expect(runs.size).toBe(1);
    expect(out.receipts).toEqual([receipt("QG-1-aaaaaa")]);
  });
});

describe("floods", () => {
  it("unsigned devices are capped low for one run, and the cap does not use up the room of signed members", async () => {
    const { db } = fakeDb();
    const { store, runs } = memoryStore();
    const answers: string[][] = [];
    for (let index = 0; index < 7; index += 1) answers.push((await apply(db, store, [record("Aye", `QG-d${index}-dddddd`)], `device:${index}`)).receipts);
    expect(answers.slice(0, 5).every((receipts) => receipts.length === 1)).toBe(true);
    expect(answers.slice(5).every((receipts) => receipts.length === 0)).toBe(true);
    const signed = await apply(db, store, [record("Zed", "QG-s-ssssss")], "member:m1");
    expect(signed.receipts).toEqual([receipt("QG-s-ssssss")]);
    expect(runs.size).toBe(1);
  });

  it("one carrier hands in only so many distinct runs per day (server configuration)", async () => {
    process.env["RUN_INTEGRITY_CONFIG"] = JSON.stringify({ carriedRunKeysPerDayDevice: 3 });
    const { db } = fakeDb();
    const { store, runs } = memoryStore();
    for (let index = 0; index < 6; index += 1) {
      const at = start - index * 7200;
      await apply(db, store, [record("Aye", `QG-r${index}-rrrrrr`, { id: `QG-run-${index}-Aye`, st: at, en: at + 1500, ev: `2735:${at + 1500}` })], "device:1");
    }
    expect(runs.size).toBe(3);
  });

  it("the same record sent again by one carrier is one row, and another carrier's copy is filed apart", async () => {
    const { db, rows } = fakeDb();
    const { store } = memoryStore();
    await apply(db, store, [record("Aye")], "device:1");
    const again = await apply(db, store, [record("Aye")], "device:1");
    expect(again.receipts).toEqual([receipt("QG-1-aaaaaa")]);
    await apply(db, store, [record("Aye")], "member:m1");
    expect(rows.map((row) => row.carrier).sort()).toEqual(["device:1", "member:m1"]);
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
