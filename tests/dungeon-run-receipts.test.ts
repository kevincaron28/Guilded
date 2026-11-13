import { describe, expect, it, vi } from "vitest";
import { importDungeonRuns, receiptReason, saveRunReceipts } from "../src/services/dungeon-import.js";
import { dungeonRunSchema } from "../src/services/dungeon-rules.js";
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
    expect(got["broken"]).toMatchObject({ outcome: "retry", reason: "Run data could not be read" });
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

// 9.3 run-loss work: a refusal a later bot version can fix is not an acknowledgement, a guildmate's COMPLETED copy upgrades a stored
// unfinished run, each player's guild is stored, and every upload leaves one journal line.
describe("9.3 run loss", () => {
  it("answers a run it could not read as 'retry', never as an acknowledgement, and takes the real outcome when the run is readable", async () => {
    const { tx, receipts } = fakeTx();
    await importDungeonRuns(tx, "g1", [{ id: "fixme", players: "broken" }], characters, "officer", null, now);
    expect(byRef(receipts)["fixme"]).toMatchObject({ outcome: "retry", reason: "Run data could not be read" });
    const later = new Date(now.getTime() + 60_000);
    await importDungeonRuns(tx, "g1", [run("fixme")], characters, "officer", null, later);
    expect(byRef(receipts)["fixme"]).toMatchObject({ outcome: "stored", reason: null });
    expect(receipts).toHaveLength(1);
  });

  it("leaves 'retry' receipts out of the standings and device answers", async () => {
    const seen: { where: Record<string, unknown> }[] = [];
    const empty = new Proxy({}, { get: (_, method) => async () => (String(method).startsWith("find") && String(method) !== "findMany" ? null : String(method).startsWith("aggregate") ? {} : []) });
    const tables: Record<string, unknown> = {
      dungeonRunReceipt: { findMany: async (args: { where: Record<string, unknown> }) => { seen.push(args); return []; } },
      dungeonRun: { findMany: async () => [] }
    };
    const db = new Proxy({}, { get: (_, model) => typeof model !== "string" ? undefined : model.startsWith("$") ? async () => [] : tables[model] ?? empty });
    await standingsConsistentReads(db as never, "g1", "m1");
    expect(seen[0]?.where).toMatchObject({ outcome: { not: "retry" } });
  }, 60_000);

  it("the signed standings answer carries pendingRunNotes for retry receipts, never as accepted", async () => {
    const tables: Record<string, unknown> = {
      dungeonRunReceipt: { findMany: async (args: { where: { outcome: unknown } }) => typeof args.where.outcome === "string"
        ? [{ runRef: "wait-1", reason: "Waiting for the guildmate's own copy" }] : [{ runRef: "done-1", reason: null }] },
      dungeonRun: { findMany: async () => [] }
    };
    const empty = new Proxy({}, { get: (_, method) => async () => (String(method).startsWith("find") && String(method) !== "findMany" ? null : String(method).startsWith("aggregate") ? {} : []) });
    const db = new Proxy({}, { get: (_, model) => typeof model !== "string" ? undefined : model.startsWith("$") ? async () => [] : tables[model] ?? empty });
    const answer = await standingsConsistentReads(db as never, "g1", "m1");
    expect(answer.pendingRunNotes).toEqual({ "wait-1": "Waiting for the guildmate's own copy" });
    expect(answer.acceptedRunRefs).toEqual(["done-1"]);
  }, 60_000);

  it("the shape the companion exports for a peer-recovered run (peerConfirmed, kills without a source: see tests/lua/dungeon-run-loss-9-3.test.ts in #842) passes the schema with every encounter kept", () => {
    const exported = { id: "RUN1", protocolVersion: 1, state: "COMPLETED", completedBy: "final boss", instanceId: 36, name: "Deadmines", difficultyId: 1, startedAt: start, endedAt: start + 1500,
      peerConfirmed: true, diagnostic: "i=36;k=1", reporters: 1,
      encounters: [{ id: 5, name: "Boss", success: true, at: start + 100, source: "native" }, { id: 9, name: "Final", success: true, at: start + 1400 }],
      players: [{ character: "Tester", realm: "Forever", class: "MAGE", guild: "Québec Gold", deaths: 0, presentSec: 1500, inGuild: true }] };
    const parsed = dungeonRunSchema.parse(exported);
    expect(parsed.peerConfirmed).toBe(true);
    expect(parsed.encounters).toHaveLength(2);
    expect(parsed.players[0]?.guild).toBe("Québec Gold");
  });

  it("stores the guild each player was in, and nothing for players without one", async () => {
    const { tx, runs } = fakeTx();
    const players = characters.map((c, index) => ({ character: c.name, realm: "Forever", deaths: 0, presentSec: 1500, inGuild: index < 2, level: 20, minLevel: 20, ...(index === 0 ? { guild: "Québec Gold" } : index === 1 ? { guild: "Other Guild" } : {}) }));
    await importDungeonRuns(tx, "g1", [run("with-guilds", { players })], characters, "officer", null, now);
    const stored = (runs[0] as unknown as { players: { character: string; guild?: string | null }[] }).players;
    expect(stored.find((p) => p.character === "Hulke Hogan")?.guild).toBe("Québec Gold");
    expect(stored.find((p) => p.character === "Banished Zakarum")?.guild).toBe("Other Guild");
    expect(stored.find((p) => p.character === "Xao Void")?.guild).toBeNull();
  });

  it("upgrades a stored ABANDONED run when a guildmate's copy under another id arrives COMPLETED, instead of storing it twice", async () => {
    const { tx, runs, receipts } = fakeTx();
    await importDungeonRuns(tx, "g1", [run("mine", { state: "ABANDONED", completedBy: undefined, endReason: "left the dungeon", endedAt: start + 3000 })], characters, "officer", null, now);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.state).toBe("ABANDONED");
    const later = new Date(now.getTime() + 60_000);
    await importDungeonRuns(tx, "g1", [run("friend-copy", { startedAt: start + 20 })], characters, "officer", null, later);
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ state: "COMPLETED", valid: true });
    expect(byRef(receipts)["friend-copy"]).toMatchObject({ outcome: "stored", runId: "run-1" });
    // The same copy sent again is now just a copy of the upgraded run.
    const again = await importDungeonRuns(tx, "g1", [run("friend-copy", { startedAt: start + 20 })], characters, "officer", null, new Date(later.getTime() + 60_000));
    expect(runs).toHaveLength(1);
    expect(again.duplicates).toBe(1);
  });

  const abandoned = (id: string, extra: Record<string, unknown> = {}) => run(id, { state: "ABANDONED", completedBy: undefined, endReason: "left the dungeon", ...extra });

  it("keeps what the addon sends: guild, diagnostic, peer marker and the peer encounter source pass the schema and the diagnostic is stored", async () => {
    const parsed = dungeonRunSchema.parse(run("keep-all", { diagnostic: "i=36;k=1", peerConfirmed: true, encounters: [{ id: 5, success: true, at: start + 100, source: "peer" }],
      players: [{ character: "Hulke Hogan", realm: "Forever", deaths: 0, presentSec: 1500, inGuild: true, guild: "Québec Gold" }] }));
    expect(parsed).toMatchObject({ diagnostic: "i=36;k=1", peerConfirmed: true });
    expect(parsed.encounters?.[0]?.source).toBe("peer");
    expect(parsed.players[0]?.guild).toBe("Québec Gold");
    const { tx, runs } = fakeTx();
    await importDungeonRuns(tx, "g1", [abandoned("kept-note", { diagnostic: "i=36;d=1;k=2;f=unknown;last=7/Boss" })], characters, "officer", null, now);
    expect((runs[0]?.competitionData as { diagnostic?: string }).diagnostic).toBe("i=36;d=1;k=2;f=unknown;last=7/Boss");
  });

  it("upgrades the stored ABANDONED version of a run the addon recovered locally (same id, completed later)", async () => {
    const { tx, runs, receipts } = fakeTx();
    await importDungeonRuns(tx, "g1", [abandoned("mine-local", { diagnostic: "i=36;k=1" })], characters, "officer", null, now);
    expect(runs.map((row) => row.state)).toEqual(["ABANDONED"]);
    await importDungeonRuns(tx, "g1", [run("mine-local", { encounters: [{ id: 9, success: true, at: start + 1400, source: "native" }] })], characters, "officer", null, new Date(now.getTime() + 60_000));
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ state: "COMPLETED", valid: true });
    expect(byRef(receipts)["mine-local"]).toMatchObject({ outcome: "stored", reason: null });
  });

  it("holds a peer-recovered run until the guildmate's own copy is stored COMPLETED, then counts it once", async () => {
    const { tx, runs, receipts } = fakeTx();
    await importDungeonRuns(tx, "g1", [abandoned("mine-peer")], characters, "officer", null, now);
    const peerRecovered = run("mine-peer", { peerConfirmed: true, startedAt: start + 10, encounters: [{ id: 9, success: true, at: start + 1400, source: "peer" }] });
    // No agreeing copy yet: not ranked, not acknowledged, the stored copy is untouched.
    await importDungeonRuns(tx, "g1", [peerRecovered], characters, "officer", null, new Date(now.getTime() + 60_000));
    expect(runs.map((row) => row.state)).toEqual(["ABANDONED"]);
    expect(byRef(receipts)["mine-peer"]).toMatchObject({ outcome: "retry", reason: "Waiting for the guildmate's own copy" });
    // A claim from an ABANDONED guildmate copy does not agree either.
    await importDungeonRuns(tx, "g1", [abandoned("friend-gave-up", { startedAt: start + 20 })], characters, "officer", null, new Date(now.getTime() + 90_000));
    await importDungeonRuns(tx, "g1", [peerRecovered], characters, "officer", null, new Date(now.getTime() + 100_000));
    expect(byRef(receipts)["mine-peer"]?.outcome).toBe("retry");
    // The guildmate's own COMPLETED copy arrives: it completes the stored unfinished run (one run, never two), and ours is then acknowledged.
    await importDungeonRuns(tx, "g1", [run("friend-own", { startedAt: start + 30 })], characters, "officer", null, new Date(now.getTime() + 120_000));
    expect(runs.filter((row) => row.state === "COMPLETED")).toHaveLength(1);
    await importDungeonRuns(tx, "g1", [peerRecovered], characters, "officer", null, new Date(now.getTime() + 180_000));
    expect(runs.filter((row) => row.state === "COMPLETED")).toHaveLength(1);
    expect(byRef(receipts)["mine-peer"]?.outcome).not.toBe("retry");
  });

  it("folds a peer-recovered run into the guildmate's stored COMPLETED copy as a corroborating copy, without a second ranking", async () => {
    const { tx, runs, receipts } = fakeTx();
    await importDungeonRuns(tx, "g1", [run("friend-own")], characters, "officer", null, now);
    await importDungeonRuns(tx, "g1", [run("mine-peer-2", { peerConfirmed: true, startedAt: start + 10, encounters: [{ id: 9, success: true, at: start + 1400, source: "peer" }] })],
      characters, "officer", null, new Date(now.getTime() + 60_000));
    expect(runs).toHaveLength(1);
    expect(byRef(receipts)["mine-peer-2"]).toMatchObject({ outcome: "copy", reason: "Counted with a guildmate's copy of this run", runId: "run-1" });
  });

  it("never lets a peer-confirmed run rank on its own, even when nothing else is stored", async () => {
    const { tx, runs, receipts } = fakeTx();
    await importDungeonRuns(tx, "g1", [run("only-peer", { peerConfirmed: true })], characters, "officer", null, now);
    expect(runs).toHaveLength(0);
    expect(byRef(receipts)["only-peer"]?.outcome).toBe("retry");
  });

  it("leaves a different, unrelated unfinished run alone", async () => {
    const { tx, runs } = fakeTx();
    await importDungeonRuns(tx, "g1", [run("old", { state: "ABANDONED", completedBy: undefined, endReason: "left the dungeon", startedAt: start - 86_400, endedAt: start - 86_400 + 900 })], characters, "officer", null, now);
    await importDungeonRuns(tx, "g1", [run("new")], characters, "officer", null, now);
    expect(runs.map((row) => row.state).sort()).toEqual(["ABANDONED", "COMPLETED"]);
  });

  it("writes one journal line per upload with the counts, and the unfinished-run note", async () => {
    const { tx } = fakeTx();
    const lines: string[] = [];
    const info = vi.spyOn(console, "info").mockImplementation((line: unknown) => { lines.push(String(line)); });
    await importDungeonRuns(tx, "guild-abcdef123456", [
      run("run-a"), run("run-b", { startedAt: start + 165 }),
      run("run-c", { state: "ABANDONED", completedBy: undefined, endReason: "left the dungeon", instanceId: 2970, name: "The Drowned City", diagnostic: "i=2970;k=1;f=unknown;last=777/Last Boss" }),
      { id: "broken", players: "x" }
    ], characters, "officer", "import-9876543210", now);
    info.mockRestore();
    const line = lines.find((text) => text.startsWith("dungeon-runs "));
    expect(line).toBe("dungeon-runs guild=123456 import=76543210 received=4 stored=2 known=0 copies=1 malformed=1 refused=retry:Run_data_could_not_be_readx1");
    expect(lines.some((text) => text.includes("dungeon-run-unfinished instance=2970") && text.includes("last=777/Last Boss"))).toBe(true);
    expect(line).not.toContain("guild-abcdef");
  });
});
