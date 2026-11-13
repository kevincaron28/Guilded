import { beforeEach, describe, expect, it, vi } from "vitest";

// 9.3: dungeon runs of an addon import are stored in their own short transaction BEFORE the rest of a long import, so a slow
// import (the P2028 transaction timeout of 12 Nov 2026 in the dungeon calendar lock) no longer loses them.
const imported = vi.hoisted(() => ({ calls: [] as { runs: unknown[]; inTransaction: number }[], transaction: 0, throwEarly: false, results: [] as { runRef: string }[], order: [] as string[] }));
vi.mock("../src/services/dungeon-import.js", async (original) => ({
  ...(await original<typeof import("../src/services/dungeon-import.js")>()),
  importDungeonRuns: vi.fn(async (_tx: unknown, _guild: string, runs: unknown[]) => {
    imported.order.push("runs");
    imported.calls.push({ runs, inTransaction: imported.transaction });
    return { results: imported.calls.length === 1 ? imported.results : [], duplicates: 0, malformed: 0, receipts: [] };
  })
}));
vi.mock("../src/services/dungeon-held-credit.js", () => ({
  creditHeldRunPlayers: vi.fn(async () => { imported.order.push("credit"); return { players: 0, runs: 0 }; }),
  HELD_CREDIT_MAX_AGE_MS: 1
}));
import { createAddonImportService, forgetAppliedSections } from "../src/services/addon-import.js";

beforeEach(() => { forgetAppliedSections(); imported.calls.length = 0; imported.transaction = 0; imported.throwEarly = false; imported.results = []; imported.order = []; });

function fakeDatabase(options: { failMain?: boolean } = {}) {
  const imports = new Map<string, { id: string; status: string; payload: unknown; createdBy: string; pairedMemberId: string | null }>();
  const known: Record<string, unknown> = {
    $executeRaw: async () => 0,
    guildSettings: { findUnique: async () => null },
    addonImport: {
      findFirst: async ({ where }: { where: { id: string } }) => imports.get(where.id) ?? null,
      update: async ({ where, data }: { where: { id: string }; data: { status?: string } }) => {
        if (options.failMain && data.status === "APPLIED") throw new Error("transaction timeout");
        return Object.assign(imports.get(where.id)!, data);
      }
    },
    character: { findMany: async () => [], findUnique: async () => null, updateMany: async () => ({ count: 0 }) }
  };
  const fallback = () => ({
    findMany: async () => [], findFirst: async () => null, findUnique: async () => null,
    create: async ({ data }: { data: unknown }) => data, upsert: async ({ create }: { create: unknown }) => create,
    update: async ({ data }: { data: unknown }) => data, updateMany: async () => ({ count: 0 }), deleteMany: async () => ({ count: 0 }),
    createMany: async () => ({ count: 0 }), count: async () => 0, groupBy: async () => []
  });
  const tx = new Proxy(known, { get: (target, key: string) => key in target ? target[key] : fallback() });
  const database = {
    $transaction: async (work: (client: unknown) => Promise<unknown>) => {
      imported.transaction++;
      if (imported.throwEarly && imported.transaction === 1) throw new Error("early step failed");
      return work(tx);
    }
  };
  const add = (id: string, runs: unknown[]) => imports.set(id, { id, status: "PREVIEWED", createdBy: "officer", pairedMemberId: null,
    payload: { source: "Guilded", exportedAt: "2026-10-01T00:00:00Z", dungeonRuns: runs } });
  return { service: createAddonImportService(database as never), add, stored: (id: string) => imports.get(id) };
}

describe("addon import: dungeon runs in their own transaction first", () => {
  it("imports the runs once, in the first transaction, and the main transaction reuses the result", async () => {
    const db = fakeDatabase();
    db.add("i1", [{ id: "QG-1" }]);
    const result = await db.service.apply("g", "i1", "officer");
    expect(imported.calls).toHaveLength(1);
    expect(imported.calls[0]?.inTransaction).toBe(1);
    expect(result.dungeons.duplicates).toBe(0);
  });

  it("keeps the runs stored when the rest of the import fails, and does not import them twice on the retry", async () => {
    const db = fakeDatabase({ failMain: true });
    db.add("i1", [{ id: "QG-1" }]);
    await expect(db.service.apply("g", "i1", "officer")).rejects.toThrow("transaction timeout");
    expect(imported.calls).toHaveLength(1);
    expect(imported.calls[0]?.inTransaction).toBe(1);
  });

  it("keeps what the announcements need when the main transaction fails, and hands it to the retry", async () => {
    imported.results = [{ runRef: "QG-1" }];
    const db = fakeDatabase({ failMain: true });
    db.add("i1", [{ id: "QG-1" }]);
    await expect(db.service.apply("g", "i1", "officer")).rejects.toThrow("transaction timeout");
    const stored = (db.stored("i1")?.payload ?? {}) as { earlyDungeonResults?: { runRef: string }[] };
    expect(stored.earlyDungeonResults?.map((row) => row.runRef)).toEqual(["QG-1"]);
    // The retry finds every run known (nothing new), yet the first attempt's results come back for the announcements.
    const retried = await db.service.apply("g", "i1", "officer").catch(() => null);
    expect(retried).toBeNull(); // the main transaction still fails in this fake
    const again = (db.stored("i1")?.payload ?? {}) as { earlyDungeonResults?: { runRef: string }[] };
    expect(again.earlyDungeonResults?.map((row) => row.runRef)).toEqual(["QG-1"]);
  });

  it("repairs members of players this upload links afterwards: held credit runs in the main transaction, after the early storing", async () => {
    const db = fakeDatabase();
    db.add("i1", [{ id: "QG-1" }]);
    await db.service.apply("g", "i1", "officer");
    expect(imported.order).toEqual(["runs", "credit"]);
  });

  it("falls back to the main transaction when the early step fails, so the runs are still imported", async () => {
    imported.throwEarly = true;
    const db = fakeDatabase();
    db.add("i1", [{ id: "QG-1" }]);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await db.service.apply("g", "i1", "officer");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("import-dungeons-early-failed"));
    expect(imported.calls).toHaveLength(1);
    expect(imported.calls[0]?.inTransaction).toBe(2);
    warn.mockRestore();
  });

  it("does nothing early for an upload without dungeon runs", async () => {
    const db = fakeDatabase();
    db.add("i1", []);
    await db.service.apply("g", "i1", "officer");
    expect(imported.calls.every((call) => call.runs.length === 0)).toBe(true);
  });
});
