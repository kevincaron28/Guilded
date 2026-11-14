import { afterEach, describe, expect, it } from "vitest";
import { agrees, evidenceUpgrade, ingestPublicRuns, type PublicRunStore, type RunSummary, type StoredRun } from "../src/services/public-runs.js";
import { carrySignedGroupRuns, GROUP_RECEIPT_PREFIX, ingestRelayedRuns } from "../src/services/relay-public.js";

// 9.3.1: the public lane for runs a companion carries for other players.
const NOW = new Date("2026-11-13T20:00:00Z");
const END = Math.floor(NOW.getTime() / 1000) - 3600;
const run = (id: string, over: Record<string, unknown> = {}) => ({
  id, protocolVersion: 1, state: "COMPLETED", instanceId: 389, name: "Ragefire Chasm", difficultyId: 1, viaGroup: true,
  startedAt: END - 1500, endedAt: END, reporters: 1, reporterNames: ["Amy"],
  encounters: [{ id: 1, success: true, at: END - 900 }, { id: 2, success: true, at: END - 10 }],
  players: ["Kev", "Amy", "Bob"].map((character) => ({ character, realm: "Doomhowl", class: "MAGE", role: "DAMAGER", level: 15, deaths: 0, presentSec: 1500, inGuild: false })), ...over
});

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
      if (row.status === "ACCEPTED" && evidenceUpgrade(row, summary)) Object.assign(row, summary, { summary });
      row.uploaders.push(uploader.key);
      uploads.push({ key: uploader.key, at: NOW });
      const confirm = agree && uploader.reporters.length > 0 && !uploader.reporters.some((name) => row.reporters.includes(name));
      if (confirm) (row as unknown as { confirmations: number }).confirmations++;
      row.reporters.push(...uploader.reporters);
      if (!agree) row.status = "DISPUTED";
      return { agree, duplicate: false };
    },
    async uploadsSince(key, since) { return uploads.filter((entry) => entry.key === key && entry.at >= since).length; },
    async storedRefs() { return []; },
    async discardRelayRun(runId) {
      const entry = [...runs.entries()].find(([, row]) => row.id === runId);
      if (!entry || !entry[1].uploaders.every((key) => key.startsWith("relay:"))) return false;
      runs.delete(entry[0]);
      return true;
    }
  };
  return { store, runs };
}
const carrier = (name: string) => new Set([name]);

afterEach(() => { delete process.env["RUN_INTEGRITY_CONFIG"]; });

describe("the relay lane", () => {
  it("counts a run whose reporter is a player in it, and a relayed copy is never a confirmation", async () => {
    const { store, runs } = memoryStore();
    const first = await ingestRelayedRuns(store, { carrier: "dev1", carrierKeys: carrier("zed"), runs: [run("QG-R1")], now: NOW });
    expect(first.published).toBe(1);
    expect(first.receipts).toEqual([`${GROUP_RECEIPT_PREFIX}QG-R1`]);
    // A second device's copy, and a copy naming another reporter: nothing confirms, the run stays one witness.
    await ingestRelayedRuns(store, { carrier: "dev2", carrierKeys: carrier("yan"), runs: [run("QG-R1")], now: NOW });
    await ingestRelayedRuns(store, { carrier: "dev2", carrierKeys: carrier("yan"), runs: [run("QG-R1", { reporterNames: ["Bob"] })], now: NOW });
    const row = [...runs.values()][0]! as unknown as { confirmations: number; uploaders: string[]; status: string; reporters: string[] };
    expect(row.confirmations).toBe(1);
    expect(row.reporters).toEqual([]);
    expect(new Set(row.uploaders)).toEqual(new Set(["relay:dev1", "relay:dev2"]));
    expect(row.status).toBe("ACCEPTED");
  });

  it("publishes nothing when the claimed reporter is not a player of the run, but stops the carrier resending", async () => {
    const { store, runs } = memoryStore();
    const answer = await ingestRelayedRuns(store, { carrier: "dev1", carrierKeys: carrier("zed"), runs: [run("QG-R2", { reporterNames: ["Mallory"] })], now: NOW });
    expect(runs.size).toBe(0);
    expect(answer.receipts).toEqual([`${GROUP_RECEIPT_PREFIX}QG-R2`]);
  });

  it("does not relay a run the carrier played itself (that is its own first-hand run)", async () => {
    const { store, runs } = memoryStore();
    await ingestRelayedRuns(store, { carrier: "dev1", carrierKeys: carrier("kev"), runs: [run("QG-R3")], now: NOW });
    expect(runs.size).toBe(0);
  });

  it("limits the runs a carrier relays per day from the stored uploads (it survives a restart), and receipts the rest", async () => {
    process.env["RUN_INTEGRITY_CONFIG"] = JSON.stringify({ relayedRunsPerDay: 2 });
    const { store, runs } = memoryStore();
    const many = Array.from({ length: 5 }, (_, index) => run(`QG-C${index}`, { endedAt: END - index * 7200, startedAt: END - index * 7200 - 1500, encounters: [{ id: 1, success: true, at: END - index * 7200 - 900 }, { id: 2, success: true, at: END - index * 7200 - 10 }] }));
    const answer = await ingestRelayedRuns(store, { carrier: "capped", carrierKeys: carrier("zed"), runs: many, now: NOW });
    expect(runs.size).toBe(2);
    // The ones over the limit are dropped but receipted, so they are not sent again at every sync.
    expect(answer.receipts).toHaveLength(5);
    // The count is read from the store: a fresh call (a restarted bot) still sees the two stored today.
    const again = await ingestRelayedRuns(store, { carrier: "capped", carrierKeys: carrier("zed"), runs: [run("QG-LATER", { endedAt: END - 40000, startedAt: END - 41500, encounters: [] })], now: NOW });
    expect(again.published).toBe(0);
    expect(runs.size).toBe(2);
  });

  it("a relayed copy never disputes a first-hand run", async () => {
    const { store, runs } = memoryStore();
    const first = { ...run("QG-F1"), viaGroup: undefined };
    await ingestPublicRuns(store, { uploaderKey: "member-kev", character: "Kev", source: "personal", runs: [first] }, NOW);
    await ingestRelayedRuns(store, { carrier: "dev9", carrierKeys: carrier("zed"), runs: [run("QG-F1", { endedAt: END - 1000, startedAt: END - 2500 })], now: NOW });
    expect([...runs.values()][0]!.status).toBe("ACCEPTED");
  });

  it("a first-hand report from a player in the run replaces a run only relayed copies created", async () => {
    const { store, runs } = memoryStore();
    // Someone pre-created the real run key with a wrong result, through the relay lane.
    await ingestRelayedRuns(store, { carrier: "dev9", carrierKeys: carrier("zed"), runs: [run("QG-P1", { endedAt: END - 1000, startedAt: END - 2500, encounters: [] })], now: NOW });
    // The player's own addon later says what happened.
    const real = { ...run("QG-P1"), viaGroup: undefined };
    const answer = await ingestPublicRuns(store, { uploaderKey: "member-kev", character: "Kev", source: "personal", runs: [real] }, NOW);
    const row = [...runs.values()][0]!;
    expect(answer.rejected).toEqual([]);
    expect(row.uploaders).toEqual(["member-kev"]);
    expect(row.status).toBe("ACCEPTED");
  });

  it("the signed upload's split takes viaGroup runs out of the snapshot, relays them and writes group: receipts", async () => {
    const { store, runs } = memoryStore();
    const saved: string[][] = [];
    const snapshot = { dungeonRuns: [run("QG-S1"), run("QG-S2", { viaGroup: undefined })] as unknown[], character: { name: "Zed" }, alts: [], characters: [] };
    const answer = await carrySignedGroupRuns(snapshot, { carrier: "member:m1", store, saveReceipts: async (refs) => { saved.push(refs); } });
    expect(snapshot.dungeonRuns.map((entry) => (entry as { id: string }).id)).toEqual(["QG-S2"]);
    expect(runs.size).toBe(1);
    expect(answer?.published).toBe(1);
    expect(saved).toEqual([[`${GROUP_RECEIPT_PREFIX}QG-S1`]]);
    // A failing relay or receipt write never breaks the upload.
    const failing = { ...store, uploadsSince: async () => { throw new Error("down"); } } as PublicRunStore;
    const second = { dungeonRuns: [run("QG-S3")] as unknown[], character: { name: "Zed" }, alts: [], characters: [] };
    expect(await carrySignedGroupRuns(second, { carrier: "member:m1", store: failing, saveReceipts: async () => { throw new Error("down"); } })).toBeNull();
    expect(second.dungeonRuns).toEqual([]);
  });

  it("the guild import paths drop a viaGroup run (backstop), with no receipt that would block the guild lane", async () => {
    const { importDungeonRuns } = await import("../src/services/dungeon-import.js");
    const calls: string[] = [];
    const tx = new Proxy({}, { get: (_t, name) => { calls.push(String(name)); throw new Error("must not touch the database"); } });
    const summary = await importDungeonRuns(tx as never, "g1", [run("QG-V1")], [], "officer", null, NOW);
    expect(summary.results).toEqual([]);
    expect(summary.receipts ?? []).toEqual([]);
    expect(calls).toEqual([]);
  });
});

describe("sharing what the relay placed (9.3.2)", () => {
  it("hands the runs placed on the public boards to the cross-guild hook, with only the reporter's own statement", async () => {
    const { store } = memoryStore();
    const placed: unknown[][] = [];
    await ingestRelayedRuns(store, { carrier: "dev1", carrierKeys: carrier("zed"), runs: [run("QG-S1"), run("QG-S2", { reporterNames: ["Mallory"] })], now: NOW, onPlaced: (runs) => placed.push(runs) });
    expect(placed).toHaveLength(1);
    expect(placed[0]!.map((entry) => (entry as { id: string }).id)).toEqual(["QG-S1"]);
    expect(placed[0]![0]).toMatchObject({ reporterNames: ["Amy"], reporters: 1 });
    expect(placed[0]![0]).not.toHaveProperty("viaGroup");
  });
});
