/* eslint-disable @typescript-eslint/no-explicit-any -- an in-memory stand-in for the few Prisma calls the lane makes */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ ingestRelayedRuns: vi.fn<(...args: any[]) => Promise<{ receipts: string[]; published: number }>>(async (_store, input) => ({ receipts: input.runs.map((run: any) => `group:${run.id}`), published: 1 })) }));
vi.mock("../src/services/relay-public.js", async (original) => ({ ...(await original<typeof import("../src/services/relay-public.js")>()), ingestRelayedRuns: mocks.ingestRelayedRuns }));

import { applyCarriedRecords, CARRY_RECEIPT_PREFIX } from "../src/services/carried-records.js";
import { unpackCarriedRun, HELD_DAYS } from "../src/services/carried-runs.js";

const NOW = new Date("2026-12-10T12:00:00Z");
const start = Math.floor(new Date("2026-12-10T10:00:00Z").getTime() / 1000);
const data = (over: Record<string, unknown> = {}) => ({ id: "QG-20261210-100000-Aye", i: 389, d: 1, st: start, en: start + 1500, cb: "final boss", nm: "Ragefire Chasm",
  p1: "Aye;WARRIOR;TANK;20;1400;0", p2: "Zed;MAGE;DAMAGER;20;1380;1", ev: `2735:${start + 1500}`, ...over });
const record = (author = "Aye", key = "QG-1-aaaaaa", over: Record<string, unknown> = {}) => ({ kind: "run", key, author, data: data(over) });

interface Row { id: number; kind: string; key: string; author: string; authorKey: string; carrier: string; status: string; runKey?: string | null; payload?: unknown; createdAt: Date }
function fakeDb() {
  const rows: Row[] = [];
  let counter = 0;
  const matches = (row: Row, where: any): boolean => Object.entries(where ?? {}).every(([field, wanted]) => {
    if (field === "id" && (wanted as any)?.in) return (wanted as any).in.includes(row.id);
    if (field === "createdAt" && (wanted as any)?.lt) return row.createdAt < (wanted as any).lt;
    if (field === "status" && (wanted as any)?.not !== undefined) return row.status !== (wanted as any).not;
    if (field === "createdAt" && (wanted as any)?.gte) return row.createdAt >= (wanted as any).gte;
    return (row as any)[field] === wanted;
  });
  const db: any = {
    carriedRecord: {
      count: async ({ where }: any) => rows.filter((row) => matches(row, where)).length,
      findUnique: async ({ where }: any) => rows.find((row) => row.kind === where.kind_authorKey_key.kind && row.authorKey === where.kind_authorKey_key.authorKey && row.key === where.kind_authorKey_key.key) ?? null,
      findMany: async ({ where, distinct, select }: any) => {
        let out = rows.filter((row) => matches(row, where));
        if (distinct) out = out.filter((row, index) => out.findIndex((other) => (other as any)[distinct[0]] === (row as any)[distinct[0]]) === index);
        return out.map((row) => (select ? Object.fromEntries(Object.keys(select).map((key) => [key, (row as any)[key]])) : row));
      },
      create: async ({ data: created }: any) => {
        if (rows.some((row) => row.kind === created.kind && row.authorKey === created.authorKey && row.key === created.key)) throw Object.assign(new Error("unique"), { code: "P2002" });
        rows.push({ id: ++counter, createdAt: NOW, ...created }); return created;
      },
      deleteMany: async ({ where }: any) => { const hit = rows.filter((row) => matches(row, where)); for (const row of hit) rows.splice(rows.indexOf(row), 1); return { count: hit.length }; },
      updateMany: async ({ where, data: changes }: any) => { const hit = rows.filter((row) => matches(row, where)); for (const row of hit) { Object.assign(row, changes); if ("payload" in changes) row.payload = null; } return { count: hit.length }; }
    }
  };
  return { db, rows };
}
const storeWith = (uploaders: string[] | null) => ({ findRun: vi.fn(async () => (uploaders ? { id: "s1", uploaders } : null)) }) as any;
const apply = (db: any, records: unknown[], carrier: string, extra: Record<string, unknown> = {}) => applyCarriedRecords(db, { carrier, carrierKeys: new Set(["carrier one"]), now: NOW, records, ...extra });

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

describe("carried dungeon runs are held", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("stores a run as held with no public effect, and answers so the addon stops carrying it", async () => {
    const { db, rows } = fakeDb();
    const out = await apply(db, [record()], "device:1", { release: { store: storeWith(null) } });
    expect(out.receipts).toEqual([`${CARRY_RECEIPT_PREFIX}run:QG-1-aaaaaa`]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "held", runKey: "389:QG-20261210-100000-Aye", authorKey: "aye" });
    expect(mocks.ingestRelayedRuns).not.toHaveBeenCalled();
  });

  it("never releases on unsigned carried reports alone, however many", async () => {
    const { db, rows } = fakeDb();
    const store = storeWith(null);
    await apply(db, [record("Aye")], "device:1", { release: { store } });
    await apply(db, [record("Zed", "QG-2-bbbbbb")], "device:2", { release: { store } });
    await apply(db, [record("Aye", "QG-3-cccccc")], "device:3", { release: { store } });
    expect(rows.every((row) => row.status === "held")).toBe(true);
    expect(mocks.ingestRelayedRuns).not.toHaveBeenCalled();
  });

  it("one signed member alone does not release it, nor two signed members for the same player", async () => {
    const { db, rows } = fakeDb();
    const store = storeWith(null);
    await apply(db, [record("Aye")], "member:m1", { release: { store } });
    expect(rows[0]!.status).toBe("held");
    await apply(db, [record("Aye", "QG-9-dddddd")], "member:m2", { release: { store } });
    expect(rows.every((row) => row.status === "held")).toBe(true);
    expect(mocks.ingestRelayedRuns).not.toHaveBeenCalled();
  });

  it("two different players' statements carried by two different signed-in members release it, through the relay lane", async () => {
    const { db, rows } = fakeDb();
    const store = storeWith(null);
    const placed = vi.fn();
    await apply(db, [record("Aye")], "member:m1", { release: { store, onPlaced: placed } });
    await apply(db, [record("Zed", "QG-2-bbbbbb")], "member:m2", { release: { store, onPlaced: placed } });
    expect(mocks.ingestRelayedRuns).toHaveBeenCalledTimes(1);
    const call = mocks.ingestRelayedRuns.mock.calls[0]![1];
    expect(call.runs[0]).toMatchObject({ id: "QG-20261210-100000-Aye", reporterNames: ["Aye", "Zed"], recorder: "Aye" });
    expect(call.carrierKeys.size).toBe(0);
    expect(rows.every((row) => row.status === "released" && !row.payload)).toBe(true);
  });

  it("an independent report of the same run releases the held rows without publishing anything itself", async () => {
    const { db, rows } = fakeDb();
    await apply(db, [record("Aye")], "device:1", { release: { store: storeWith(["account:1"]) } });
    expect(rows[0]).toMatchObject({ status: "released" });
    expect(mocks.ingestRelayedRuns).not.toHaveBeenCalled();
    // A run only relayed copies made is not an independent report.
    const second = fakeDb();
    await apply(second.db, [record("Aye")], "device:1", { release: { store: storeWith(["relay:member:m1"]) } });
    expect(second.rows[0]!.status).toBe("held");
  });

  it("a later independent report is noticed at the next carried upload (sweep)", async () => {
    const { db, rows } = fakeDb();
    await apply(db, [record("Aye")], "device:1", { release: { store: storeWith(null) } });
    expect(rows[0]!.status).toBe("held");
    await apply(db, [{ kind: "run", key: "QG-x-eeeeee", author: "Aye", data: "bad" }], "device:9", { now: new Date(NOW.getTime() + 11 * 60_000), release: { store: storeWith(["account:1"]) } });
    expect(rows[0]!.status).toBe("released");
  });

  it("drops a held run nobody released after the holding time", async () => {
    const { db, rows } = fakeDb();
    await apply(db, [record("Aye")], "device:1", { release: { store: storeWith(null) } });
    rows[0]!.createdAt = new Date(NOW.getTime() - (HELD_DAYS + 1) * 86_400_000);
    await apply(db, [{ kind: "run", key: "QG-x-ffffff", author: "Aye", data: "bad" }], "device:9", { now: new Date(NOW.getTime() + 11 * 60_000), release: { store: storeWith(null) } });
    expect(rows[0]!.status).toBe("expired");
    expect(rows[0]!.payload ?? null).toBeNull();
    rows[0]!.createdAt = new Date(NOW.getTime() - 31 * 86_400_000);
    await apply(db, [{ kind: "run", key: "QG-x-iiiiii", author: "Aye", data: "bad" }], "device:9", { now: new Date(NOW.getTime() + 30 * 60_000), release: { store: storeWith(null) } });
    expect(rows.some((row) => row.status === "expired")).toBe(false);
  });

  it("a forged second author by another account, with a different payload, does not release the honest carry", async () => {
    const { db, rows } = fakeDb();
    const store = storeWith(null);
    await apply(db, [record("Aye")], "member:m1", { release: { store } });
    // The forger names an invented author and invents the run around that author; it is not a player of the honest statement.
    await apply(db, [record("Mallory", "QG-7-iiiiii", { p1: "Mallory;MAGE;DAMAGER;60;1500;0", p2: "Aye;WARRIOR;TANK;60;1500;0", en: start + 90_000 })], "member:m2", { release: { store } });
    // Even naming a real player, a statement that disagrees on the run does not pair.
    await apply(db, [record("Zed", "QG-8-jjjjjj", { en: start + 9000 })], "member:m3", { release: { store } });
    expect(rows.every((row) => row.status === "held")).toBe(true);
    expect(mocks.ingestRelayedRuns).not.toHaveBeenCalled();
  });

  it("statements that name the same run but differ on its players do not pair", async () => {
    const { db } = fakeDb();
    const store = storeWith(null);
    await apply(db, [record("Aye")], "member:m1", { release: { store } });
    await apply(db, [record("Zed", "QG-2-bbbbbb", { p3: "Extra;PRIEST;HEALER;20;1300;0" })], "member:m2", { release: { store } });
    expect(mocks.ingestRelayedRuns).not.toHaveBeenCalled();
  });

  it("one carrier holding two authors is one voice; agreeing carries by two members publish the earlier statement", async () => {
    const { db, rows } = fakeDb();
    const store = storeWith(null);
    await apply(db, [record("Aye"), record("Zed", "QG-2-bbbbbb")], "member:m1", { release: { store } });
    expect(mocks.ingestRelayedRuns).not.toHaveBeenCalled();
    await apply(db, [record("Zed", "QG-3-cccccc", { en: start + 1530 })], "member:m2", { release: { store } });
    expect(mocks.ingestRelayedRuns).toHaveBeenCalledTimes(1);
    expect(mocks.ingestRelayedRuns.mock.calls[0]![1].runs[0]).toMatchObject({ endedAt: start + 1500, recorder: "Aye" });
    expect(rows.every((row) => row.status === "released")).toBe(true);
  });

  it("a forged record squatting a key does not make the genuine record of that key, from another carrier, look known", async () => {
    const { db, rows } = fakeDb();
    const store = storeWith(null);
    await apply(db, [record("Aye", "QG-1-aaaaaa", { p2: "Mallory;MAGE;DAMAGER;20;1380;1" })], "member:forger", { release: { store } });
    await apply(db, [record("Aye", "QG-1-aaaaaa")], "member:honest", { release: { store } });
    expect(rows).toHaveLength(2);
  });

  it("evaluates held runs at most every ten minutes", async () => {
    const { db } = fakeDb();
    const spy = vi.spyOn(db.carriedRecord, "findMany");
    const store = storeWith(null);
    await apply(db, [{ kind: "run", key: "QG-x-aaaaaa", author: "Aye", data: "bad" }], "device:1", { release: { store } });
    const first = spy.mock.calls.length;
    await apply(db, [{ kind: "run", key: "QG-x-bbbbbb", author: "Aye", data: "bad" }], "device:1", { release: { store } });
    expect(spy.mock.calls.length).toBe(first);
  });

  it("refuses a run the author was not in, a run the carrier played, and a malformed one; each is answered, none held", async () => {
    const { db, rows } = fakeDb();
    const out = await apply(db, [record("Mallory"), record("Aye", "QG-4-gggggg", { p1: "Carrier One;MAGE;DPS;20;900;0", p2: "Aye;WARRIOR;TANK;20;900;0" }), { kind: "run", key: "QG-5-hhhhhh", author: "Aye", data: { id: "x" } }], "device:1", { release: { store: storeWith(null) } });
    expect(out.receipts).toHaveLength(3);
    expect(rows.map((row) => row.status).sort()).toEqual(["own", "rejected", "rejected"]);
    expect(rows.some((row) => row.status === "held")).toBe(false);
  });

  it("without a store to check against, runs stay held", async () => {
    const { db, rows } = fakeDb();
    await apply(db, [record("Aye")], "member:m1");
    await apply(db, [record("Zed", "QG-2-bbbbbb")], "member:m2");
    expect(rows.every((row) => row.status === "held")).toBe(true);
    expect(mocks.ingestRelayedRuns).not.toHaveBeenCalled();
  });
});
