import { describe, expect, it } from "vitest";
import { importDungeonRuns, receiptReason, saveRunReceipts } from "../src/services/dungeon-import.js";
import { standingsConsistentReads } from "../src/companion-api.js";
import { standingsToLua } from "../companion/standings-format.mjs";
import * as ratingService from "../src/services/dungeon-rating.js";

// 9.0.8 (owner report, 9 November 2026: "8 runs stay waiting"): the bot acknowledges every dungeon
// run an upload brought, not only the rows it stored under that run's own id. A guildmate's copy of a
// stored run, and refused runs, used to wait in the addon forever.

interface Receipt { guildId: string; runRef: string; outcome: string; state?: string | null; reason: string | null; runId: string | null; createdAt: Date; seenAt: Date }

function fakeTx() {
  const runs: { id: string; runRef: string; instanceId: number; difficultyId: number; state: string; valid: boolean; invalidReason: string | null;
    startedAt: Date | null; endedAt: Date | null; durationSec: number | null; players: { character: string; memberId: string | null }[]; competitionData?: unknown }[] = [];
  const receipts: Receipt[] = [];
  const queries: string[] = [];
  const season = { id: "season-1", startsAt: new Date(0), ratingRules: ratingService.createDungeonRatingRules({}, 3, { "36": { min: 15, max: 25, difficultyId: 1 } }) };
  const tx = {
    officialSeason: { findFirst: async () => null },
    guildSettings: { findUnique: async () => null },
    dungeonSeason: { findFirst: async () => null, create: async () => season },
    dungeonRun: {
      findUnique: async ({ where }: { where: { guildId_runRef: { runRef: string } } }) => (queries.push("run.findUnique"), runs.find((row) => row.runRef === where.guildId_runRef.runRef) ?? null),
      findMany: async ({ where }: { where: { instanceId?: number; valid?: boolean; state?: string; startedAt?: { gte: Date; lte: Date } } }) => runs.filter((row) =>
        (where.instanceId === undefined || row.instanceId === where.instanceId) && (where.valid === undefined || row.valid === where.valid)
        && (where.state === undefined || row.state === where.state)
        && (!where.startedAt || (row.startedAt !== null && row.startedAt >= where.startedAt.gte && row.startedAt <= where.startedAt.lte))),
      create: async ({ data }: { data: Record<string, unknown> & { players: { create: { character: string; memberId: string | null }[] } } }) => {
        const row = { ...data, id: `run-${runs.length + 1}`, players: data.players.create } as unknown as typeof runs[number];
        runs.push(row);
        return row;
      },
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = runs.find((r) => r.id === where.id)!;
        Object.assign(row, Object.fromEntries(Object.entries(data).filter(([key]) => key !== "players")));
        return row;
      }
    },
    dungeonAchievement: { findMany: async () => [], create: async ({ data }: { data: unknown }) => data },
    dungeonPointTransaction: { findMany: async () => [], create: async ({ data }: { data: unknown }) => data },
    dungeonRunReceipt: {
      findMany: async ({ where }: { where: { guildId: string; runRef: { in: string[] }; outcome?: string } }) => {
        queries.push("receipt.findMany");
        return receipts.filter((row) => row.guildId === where.guildId && where.runRef.in.includes(row.runRef) && (!where.outcome || row.outcome === where.outcome));
      },
      createMany: async ({ data }: { data: Receipt[] }) => { queries.push("receipt.createMany"); receipts.push(...data.map((row) => ({ ...row }))); return { count: data.length }; },
      updateMany: async ({ where, data }: { where: { guildId: string; runRef: { in: string[] } }; data: Partial<Receipt> }) => {
        queries.push("receipt.updateMany");
        for (const row of receipts) if (row.guildId === where.guildId && where.runRef.in.includes(row.runRef)) Object.assign(row, data);
        return { count: 0 };
      },
      update: async ({ where, data }: { where: { guildId_runRef: { guildId: string; runRef: string } }; data: Partial<Receipt> }) => {
        queries.push("receipt.update");
        const found = receipts.find((row) => row.guildId === where.guildId_runRef.guildId && row.runRef === where.guildId_runRef.runRef)!;
        return Object.assign(found, data);
      }
    }
  };
  return { tx: tx as unknown as Parameters<typeof importDungeonRuns>[0], runs, receipts, queries };
}

const characters = ["Hulke Hogan", "Banished Zakarum", "Maxle Druide", "Xao Void", "Slaiker Ravencourt"].map((name) => ({ name, realm: "Forever", memberId: `m-${name.split(" ")[0]!.toLowerCase()}` }));
const now = new Date("2026-09-25T23:00:00Z");
const start = Math.floor(new Date("2026-09-25T18:00:00Z").getTime() / 1000);
const run = (id: string, overrides: Record<string, unknown> = {}) => ({
  id, protocolVersion: 1, state: "COMPLETED", instanceId: 36, name: "Deadmines", difficultyId: 1, startedAt: start, endedAt: start + 1500, reporters: 1, completedBy: "final boss",
  players: characters.map((c) => ({ character: c.name, realm: "Forever", deaths: 0, presentSec: 1500, inGuild: true, level: 20, minLevel: 20 })),
  ...overrides
});
const byRef = (receipts: Receipt[]) => Object.fromEntries(receipts.map((row) => [row.runRef, row]));

describe("dungeon run receipts", () => {
  it("acknowledges a guildmate's copy of a stored run under the copy's own id", async () => {
    // The owner's case: Banished Zakarum's two ids for one Gnomeregan clear (02:45:33 and 02:48:18).
    const { tx, runs, receipts } = fakeTx();
    const summary = await importDungeonRuns(tx, "g1", [run("QG-024533-Banished"), run("QG-024818-Banished", { startedAt: start + 165 })], characters, "officer", null, now);
    expect(runs.map((row) => row.runRef)).toEqual(["QG-024533-Banished"]);
    expect(summary.duplicates).toBe(1);
    const got = byRef(receipts);
    expect(got["QG-024533-Banished"]).toMatchObject({ outcome: "stored", reason: null, runId: "run-1" });
    expect(got["QG-024818-Banished"]).toMatchObject({ outcome: "copy", reason: "Counted with a guildmate's copy of this run", runId: "run-1" });
  });

  it("acknowledges refused and malformed runs, with the reason, and an abandoned run as not completed", async () => {
    const { tx, receipts } = fakeTx();
    await importDungeonRuns(tx, "g1", [
      run("left", { state: "ABANDONED", completedBy: undefined, endReason: "left the dungeon", instanceId: 389, name: "Ragefire Chasm" }),
      run("too-fast", { endedAt: start + 60 }),
      { id: "broken" }, { nothing: "here" }
    ], characters, "officer", null, now);
    const got = byRef(receipts);
    expect(got["left"]).toMatchObject({ outcome: "stored", reason: "Not completed" });
    expect(got["too-fast"]).toMatchObject({ outcome: "stored" });
    expect(got["too-fast"]!.reason).toBeTruthy();
    expect(got["broken"]).toMatchObject({ outcome: "refused", reason: "Run data could not be read" });
    expect(receipts).toHaveLength(3); // a run with no id cannot be acknowledged
  });

  it("refreshes the date of a run seen again and keeps its first outcome; a recovered run takes its new one", async () => {
    const { tx, receipts } = fakeTx();
    await importDungeonRuns(tx, "g1", [run("rec", { state: "ABANDONED", completedBy: undefined, endReason: "left the dungeon", endedAt: start + 3000 })], characters, "officer", null, now);
    expect(byRef(receipts)["rec"]).toMatchObject({ reason: "Not completed" });
    const later = new Date(now.getTime() + 60_000);
    await importDungeonRuns(tx, "g1", [run("rec", { state: "ABANDONED", completedBy: undefined, endReason: "left the dungeon", endedAt: start + 3000 })], characters, "officer", null, later);
    expect(byRef(receipts)["rec"]).toMatchObject({ reason: "Not completed", seenAt: later });
    const recovered = new Date(now.getTime() + 120_000);
    await importDungeonRuns(tx, "g1", [run("rec")], characters, "officer", null, recovered);
    expect(byRef(receipts)["rec"]).toMatchObject({ outcome: "stored", reason: null, seenAt: recovered });
  });

  it("answers runs it already has from batched reads, without the per-run work, on the next upload", async () => {
    const { tx, runs, receipts, queries } = fakeTx();
    const upload = () => [run("QG-024533-Banished"), run("QG-024818-Banished", { startedAt: start + 165 }), run("left", { state: "ABANDONED", completedBy: undefined, endReason: "left the dungeon", endedAt: start + 3000, instanceId: 389, name: "Ragefire Chasm" })];
    await importDungeonRuns(tx, "g1", upload(), characters, "officer", null, now);
    expect(runs).toHaveLength(2);
    queries.length = 0;
    const later = new Date(now.getTime() + 60_000);
    const again = await importDungeonRuns(tx, "g1", upload(), characters, "officer", null, later);
    expect(again.duplicates).toBe(3);
    expect(again.results).toEqual([]);
    expect(queries).not.toContain("run.findUnique"); // nothing went through the per-run path
    expect(queries.filter((q) => q.startsWith("receipt."))).toEqual(["receipt.findMany", "receipt.findMany", "receipt.updateMany"]);
    expect(receipts.every((row) => row.seenAt === later)).toBe(true);
    expect(byRef(receipts)["QG-024818-Banished"]).toMatchObject({ outcome: "copy", state: "COMPLETED" });
    // A copy that comes back COMPLETED after an addon recovery, and a recovered stored run, still go the long way.
    queries.length = 0;
    await importDungeonRuns(tx, "g1", [run("left", { instanceId: 389, name: "Ragefire Chasm" })], characters, "officer", null, later);
    expect(queries).toContain("run.findUnique");
    expect(runs.find((row) => row.runRef === "left")).toMatchObject({ state: "COMPLETED" });
  });

  it("keeps reasons short and free of WoW escape codes, and does nothing without the table", async () => {
    expect(receiptReason("Bad |cffff0000run|r\nhere")).toBe("Bad cffff0000run r here");
    expect(receiptReason("x".repeat(200))).toHaveLength(80);
    expect(receiptReason("")).toBeNull();
    await expect(saveRunReceipts({}, "g1", [{ runRef: "a", outcome: "stored", reason: null, runId: null }])).resolves.toBeUndefined();
  });
});

describe("the standings snapshot", () => {
  // Every other table answers empty (as in standings-transaction.test.ts); the run tables answer these rows.
  const database = (receipts: { runRef: string; reason: string | null }[], stored: string[]) => {
    const empty = new Proxy({}, { get: (_, method) => async () => (String(method).startsWith("find") && String(method) !== "findMany" ? null : String(method).startsWith("aggregate") ? {} : []) });
    const tables: Record<string, unknown> = {
      dungeonRunReceipt: { findMany: async () => receipts },
      dungeonRun: { findMany: async () => stored.map((runRef) => ({ runRef })) }
    };
    return new Proxy({}, { get: (_, model) => typeof model !== "string" ? undefined : model.startsWith("$") ? async () => [] : tables[model] ?? empty });
  };

  it("lists received refs first, then stored ones, once each, and the reasons", async () => {
    const db = database([{ runRef: "copy-1", reason: "Counted with a guildmate's copy of this run" }, { runRef: "stored-1", reason: null }], ["stored-1", "stored-2"]);
    const reads = await standingsConsistentReads(db as never, "g1", "m1");
    expect(reads.acceptedRunRefs).toEqual(["copy-1", "stored-1", "stored-2"]);
    expect(reads.runNotes).toEqual({ "copy-1": "Counted with a guildmate's copy of this run" });
  }, 60_000);

  it("writes the notes into Standings.lua next to the accepted refs", () => {
    const text = standingsToLua({ standings: [], acceptedRunRefs: ["copy-1"], runNotes: { "copy-1": "Counted with a guildmate's copy of this run", bad: 5 }, updatedAt: "2026-11-09T00:00:00Z" });
    expect(text).toContain('GuildedDungeonAccepted = {\n  "copy-1",\n}');
    expect(text).toContain('GuildedDungeonNotes = {\n  ["copy-1"] = "Counted with a guildmate\'s copy of this run",\n}');
    expect(text).not.toContain('["bad"]');
    expect(standingsToLua({ standings: [], updatedAt: "x" })).toContain("GuildedDungeonNotes = {\n}");
  });
});
