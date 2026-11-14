import { afterEach, describe, expect, it } from "vitest";
import { agrees, evidenceUpgrade, ingestPublicRuns, type PublicRunStore, type RunSummary, type StoredRun } from "../src/services/public-runs.js";
import { GROUP_RECEIPT_PREFIX, ingestRelayedRuns } from "../src/services/relay-public.js";

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
  let next = 0;
  const store: PublicRunStore = {
    async findRun(runKey) { return runs.get(runKey) ?? null; },
    async createRun(summary, uploader) { runs.set(summary.runKey, { ...summary, id: `r${++next}`, status: "ACCEPTED", uploaders: [uploader.key], reporters: [...uploader.reporters], summary }); },
    async addUpload(runId, uploader, summary) {
      const row = [...runs.values()].find((entry) => entry.id === runId)!;
      const agree = agrees(row, summary);
      if (row.status === "ACCEPTED" && evidenceUpgrade(row, summary)) Object.assign(row, summary, { summary });
      row.uploaders.push(uploader.key);
      if (!agree) row.status = "DISPUTED";
      return { agree, duplicate: false };
    },
    async uploadsSince() { return 0; },
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
  it("counts a run whose reporter is a player in it, as one source per reporter", async () => {
    const { store, runs } = memoryStore();
    const first = await ingestRelayedRuns(store, { carrier: "dev1", carrierKeys: carrier("zed"), runs: [run("QG-R1")], now: NOW });
    expect(first.published).toBe(1);
    expect(first.receipts).toEqual([`${GROUP_RECEIPT_PREFIX}QG-R1`]);
    // A second carrier's copy of the same reporter's run is the same source: nothing is added.
    await ingestRelayedRuns(store, { carrier: "dev2", carrierKeys: carrier("yan"), runs: [run("QG-R1")], now: NOW });
    const row = [...runs.values()][0]!;
    expect(row.uploaders.filter((key) => key === "relay:amy").length).toBeLessThanOrEqual(1);
    expect(new Set(row.uploaders)).toEqual(new Set(["relay:amy"]));
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

  it("limits the runs a carrier relays per day, read from the server configuration", async () => {
    process.env["RUN_INTEGRITY_CONFIG"] = JSON.stringify({ relayedRunsPerDay: 2 });
    const { store, runs } = memoryStore();
    const many = Array.from({ length: 5 }, (_, index) => run(`QG-C${index}`, { endedAt: END - index * 7200, startedAt: END - index * 7200 - 1500, encounters: [{ id: 1, success: true, at: END - index * 7200 - 900 }, { id: 2, success: true, at: END - index * 7200 - 10 }] }));
    const answer = await ingestRelayedRuns(store, { carrier: "capped", carrierKeys: carrier("zed"), runs: many, now: NOW });
    expect(runs.size).toBe(2);
    // The ones over the limit are not receipted, so the addon offers them again.
    expect(answer.receipts).toHaveLength(2);
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
});
