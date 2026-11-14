/* eslint-disable @typescript-eslint/no-explicit-any -- an in-memory stand-in for the few Prisma calls the lane makes */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  recordGlobalDuels: vi.fn<(...args: unknown[]) => Promise<object>>(async () => ({ recorded: 1, confirmed: 0 })),
  importDuelResults: vi.fn<(...args: unknown[]) => Promise<object>>(async () => ({ recorded: 1 })),
  importMilestones: vi.fn<(...args: unknown[]) => Promise<object>>(async () => ({ recorded: 1, rejected: 0 }))
}));
vi.mock("../src/services/duel-global.js", async (original) => ({ ...(await original<typeof import("../src/services/duel-global.js")>()), recordGlobalDuels: mocks.recordGlobalDuels }));
vi.mock("../src/services/duels.js", async (original) => ({ ...(await original<typeof import("../src/services/duels.js")>()), importDuelResults: mocks.importDuelResults, importMilestones: mocks.importMilestones }));

import { applyCarriedRecords, CARRY_RECEIPT_PREFIX } from "../src/services/carried-records.js";

const NOW = new Date("2026-12-10T12:00:00Z");
const at = Math.floor(new Date("2026-12-09T10:00:00Z").getTime() / 1000);
const ext = (over: Record<string, unknown> = {}) => ({ winner: "Aldric Stone", loser: "Brenna Vale", at, reason: "knockout", side: "winner", ...over });

function fakeDb(characters: any[] = []) {
  const stored: { kind: string; key: string; carrier: string; createdAt: Date }[] = [];
  const db: any = {
    carriedRecord: {
      count: async ({ where }: any) => stored.filter((row) => row.carrier === where.carrier && row.createdAt >= where.createdAt.gte).length,
      findUnique: async ({ where }: any) => stored.find((row) => row.kind === where.kind_key.kind && row.key === where.kind_key.key) ?? null,
      create: async ({ data }: any) => { stored.push({ ...data, createdAt: NOW }); return data; }
    },
    character: { findMany: async ({ where }: any) => characters.filter((row) => !where.name?.equals || row.name.toLowerCase() === where.name.equals.toLowerCase() || where.OR) },
    $transaction: async (run: (tx: unknown) => Promise<unknown>) => run(db)
  };
  return { db, stored };
}
const carrierOf = (name: string) => new Set([name.toLowerCase()]);

describe("carried records", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("applies an outside duel as the reporting side's own statement and answers by key", async () => {
    const { db, stored } = fakeDb();
    const out = await applyCarriedRecords(db, { carrier: "device:1", carrierKeys: carrierOf("Carrier One"), now: NOW, records: [{ kind: "externalDuel", key: "x1-aaaa", author: "Aldric Stone", data: ext() }] });
    expect(out.receipts).toEqual([`${CARRY_RECEIPT_PREFIX}externalDuel:x1-aaaa`]);
    expect(out.applied).toBe(1);
    expect(mocks.recordGlobalDuels).toHaveBeenCalledTimes(1);
    expect((mocks.recordGlobalDuels.mock.calls[0]![1] as any).reporterKey).toBe("install:carried-aldric stone");
    expect(stored).toHaveLength(1);
  });

  it("refuses a record whose author is not the side it says reported it", async () => {
    const { db } = fakeDb();
    const out = await applyCarriedRecords(db, { carrier: "device:1", carrierKeys: carrierOf("Carrier One"), now: NOW, records: [{ kind: "externalDuel", key: "x2-aaaa", author: "Mallory Fox", data: ext() }] });
    expect(mocks.recordGlobalDuels).not.toHaveBeenCalled();
    expect(out.applied).toBe(0);
  });

  it("does not apply the same record twice", async () => {
    const { db } = fakeDb();
    const record = { kind: "externalDuel", key: "x3-aaaa", author: "Aldric Stone", data: ext() };
    await applyCarriedRecords(db, { carrier: "device:1", carrierKeys: carrierOf("Carrier One"), now: NOW, records: [record] });
    const again = await applyCarriedRecords(db, { carrier: "device:2", carrierKeys: carrierOf("Other"), now: NOW, records: [record] });
    expect(mocks.recordGlobalDuels).toHaveBeenCalledTimes(1);
    expect(again.receipts).toEqual([`${CARRY_RECEIPT_PREFIX}externalDuel:x3-aaaa`]);
  });

  it("leaves a kind it does not know unanswered, so a newer addon keeps the record", async () => {
    const { db } = fakeDb();
    const out = await applyCarriedRecords(db, { carrier: "device:1", carrierKeys: carrierOf("Carrier One"), now: NOW, records: [{ kind: "mystery", key: "m1-aaaa", author: "Aldric Stone", data: {} }, "junk", null] });
    expect(out.receipts).toEqual([]);
  });

  it("answers a record about the carrier's own character without applying it", async () => {
    const { db } = fakeDb();
    const out = await applyCarriedRecords(db, { carrier: "device:1", carrierKeys: carrierOf("Aldric Stone"), now: NOW, records: [{ kind: "externalDuel", key: "x4-aaaa", author: "Aldric Stone", data: ext() }] });
    expect(mocks.recordGlobalDuels).not.toHaveBeenCalled();
    expect(out.receipts).toHaveLength(1);
  });

  it("applies a guild duel and a milestone only for a registered guild's own character", async () => {
    const mine = { id: "c1", guildId: "g1", name: "Aldric Stone", realm: "Kronos", memberId: "m1", level: 40 };
    const { db } = fakeDb([mine]);
    const out = await applyCarriedRecords(db, { carrier: "device:1", carrierKeys: carrierOf("Carrier One"), now: NOW, records: [
      { kind: "duel", key: "d1-aaaa", author: "Aldric Stone", data: { winner: "Aldric Stone", loser: "Brenna Vale", at, reason: "knockout" } },
      { kind: "milestone", key: "ms-aaaa", author: "Aldric Stone", data: { character: "Aldric Stone", realm: "", kind: "level", ref: "lvl:40", value: 40, at } }
    ] });
    expect(mocks.importDuelResults).toHaveBeenCalledTimes(1);
    expect(mocks.importMilestones).toHaveBeenCalledTimes(1);
    expect(out.applied).toBe(2);
    const none = await applyCarriedRecords(fakeDb().db, { carrier: "device:1", carrierKeys: carrierOf("Carrier One"), now: NOW, records: [{ kind: "milestone", key: "ms-bbbb", author: "Nobody Known", data: { character: "Nobody Known", realm: "", kind: "level", ref: "lvl:40", value: 40, at } }] });
    expect(none.applied).toBe(0);
    expect(mocks.importMilestones).toHaveBeenCalledTimes(1);
  });

  it("stops applying past a carrier's daily allowance but still answers", async () => {
    vi.stubEnv("RUN_INTEGRITY_CONFIG", JSON.stringify({ carriedRecordsPerDay: 1 }));
    try {
      const { db } = fakeDb();
      const out = await applyCarriedRecords(db, { carrier: "device:1", carrierKeys: carrierOf("Carrier One"), now: NOW, records: [
        { kind: "externalDuel", key: "c1-aaaa", author: "Aldric Stone", data: ext() },
        { kind: "externalDuel", key: "c2-aaaa", author: "Aldric Stone", data: ext({ at: at + 600 }) }
      ] });
      expect(mocks.recordGlobalDuels).toHaveBeenCalledTimes(1);
      expect(out.receipts).toHaveLength(2);
    } finally { vi.unstubAllEnvs(); }
  });
});
