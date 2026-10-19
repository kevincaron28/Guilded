import { describe, expect, it } from "vitest";
import { agrees, checkPublicRun, ingestPublicRuns, PublicUploadError, seasonOf, summarize, type PublicRunStore, type RunSummary, type StoredRun } from "../src/services/public-runs.js";
import { dungeonRunSchema } from "../src/services/dungeon-rules.js";

const NOW = new Date("2026-11-10T20:00:00Z");
const END = Math.floor(NOW.getTime() / 1000) - 3600;

export function run(over: Record<string, unknown> = {}) {
  return {
    id: "QG-20261110-190000-Kev", protocolVersion: 1, state: "COMPLETED", instanceId: 389, name: "Ragefire Chasm", difficultyId: 1,
    startedAt: END - 1500, endedAt: END, recorder: "Kev", reporters: 2, reporterNames: ["Kev", "Amy"],
    encounters: [{ id: 1, success: true, at: END - 900 }, { id: 2, success: true, at: END - 10 }],
    players: [
      { character: "Kev", realm: "Doomhowl", class: "WARRIOR", role: "TANK", level: 16, deaths: 0, presentSec: 1500, inGuild: false },
      { character: "Amy", realm: "Doomhowl", class: "PRIEST", role: "HEALER", level: 15, deaths: 1, presentSec: 1500, inGuild: false },
      { character: "Bob", realm: "Doomhowl", class: "MAGE", role: "DAMAGER", level: 15, deaths: null, presentSec: 1500, inGuild: false }
    ],
    ...over
  };
}
const parse = (value: Record<string, unknown>) => dungeonRunSchema.parse(value);

export function memoryRunStore() {
  const runs = new Map<string, StoredRun & { summary: RunSummary; confirmations: number }>();
  const uploads: { uploaderKey: string; runRef: string; at: Date }[] = [];
  let next = 0;
  const store: PublicRunStore = {
    async findRun(runKey) { return runs.get(runKey) ?? null; },
    async createRun(summary, uploaderKey) {
      runs.set(summary.runKey, { id: `r${++next}`, status: "ACCEPTED", durationSec: summary.durationSec, endedAt: summary.endedAt, players: summary.players.map((p) => p.character), uploaders: [uploaderKey], summary, confirmations: 1 });
      uploads.push({ uploaderKey, runRef: summary.runRef, at: NOW });
    },
    async addUpload(runId, uploaderKey, summary, agree) {
      const row = [...runs.values()].find((entry) => entry.id === runId)!;
      row.uploaders.push(uploaderKey);
      if (agree) row.confirmations++; else row.status = "DISPUTED";
      uploads.push({ uploaderKey, runRef: summary.runRef, at: NOW });
    },
    async uploadsSince(uploaderKey, since) { return uploads.filter((u) => u.uploaderKey === uploaderKey && u.at >= since).length; },
    async storedRefs(uploaderKey) { return uploads.filter((u) => u.uploaderKey === uploaderKey).map((u) => u.runRef); }
  };
  return { store, runs, uploads };
}

describe("public run checks", () => {
  it("accepts a normal completed run", () => {
    expect(checkPublicRun(parse(run()), "Kev", NOW)).toEqual({ ok: true });
  });

  it("rejects impossible times, boss kills outside the run, old runs and outsiders", () => {
    expect(checkPublicRun(parse(run({ startedAt: END - 60 })), "Kev", NOW).reason).toMatch(/too short/);
    expect(checkPublicRun(parse(run({ startedAt: END - 200, encounters: [1, 2, 3, 4, 5].map((id) => ({ id, success: true })) })), "Kev", NOW).reason).toBe("impossible time for the bosses killed");
    expect(checkPublicRun(parse(run({ encounters: [{ id: 1, success: true, at: END + 600 }] })), "Kev", NOW).reason).toBe("a boss kill falls outside the run");
    expect(checkPublicRun(parse(run({ encounters: [{ id: 1, success: true, at: END - 900 }, { id: 2, success: true, at: END - 897 }] })), "Kev", NOW).reason).toBe("impossible time between two bosses");
    expect(checkPublicRun(parse(run({ startedAt: END - 40 * 86_400 - 1500, endedAt: END - 40 * 86_400, encounters: [] })), "Kev", NOW).reason).toMatch(/older than 30 days/);
    expect(checkPublicRun(parse(run()), "Stranger", NOW).reason).toBe("your character was not in this run");
    expect(checkPublicRun(parse(run({ endedAt: END + 7200 })), "Kev", NOW).reason).toBe("timestamp in the future");
    expect(checkPublicRun(parse(run({ state: "ABANDONED" })), "Kev", NOW).reason).toBe("not completed");
  });

  it("summarizes time, deaths, bracket and season", () => {
    const summary = summarize(parse(run()));
    expect(summary).toMatchObject({ runKey: "389:QG-20261110-190000-Kev", durationSec: 1500, deaths: 1, maxLevel: 16, bracket: "15-29", season: "2026-Q4" });
    expect(seasonOf(new Date("2027-01-01T00:00:00Z"))).toBe("2027-Q1");
  });

  it("decides when two uploads of one run agree", () => {
    const stored = { durationSec: 1500, endedAt: new Date(END * 1000), players: ["Kev", "Amy", "Bob"] };
    expect(agrees(stored, summarize(parse(run({ startedAt: END - 1520 }))))).toBe(true);
    expect(agrees(stored, summarize(parse(run({ startedAt: END - 1200 }))))).toBe(false);
    expect(agrees(stored, summarize(parse(run({ players: [{ character: "Zed", realm: "X", presentSec: 1, inGuild: false }], recorder: "Zed", reporterNames: ["Zed"] }))))).toBe(false);
  });
});

describe("public run uploads", () => {
  it("stores a run once, counts agreeing party members and holds disputed runs", async () => {
    const memory = memoryRunStore();
    const first = await ingestPublicRuns(memory.store, { uploaderKey: "account:kev", character: "Kev", source: "personal", runs: [run(), run({ state: "ABANDONED", id: "other" })] }, NOW);
    expect(first).toMatchObject({ accepted: ["QG-20261110-190000-Kev"], rejected: [], acceptedRunRefs: ["QG-20261110-190000-Kev"] });
    const again = await ingestPublicRuns(memory.store, { uploaderKey: "account:kev", character: "Kev", source: "personal", runs: [run()] }, NOW);
    expect(again.duplicates).toEqual(["QG-20261110-190000-Kev"]);
    const amy = await ingestPublicRuns(memory.store, { uploaderKey: "account:amy", character: "Amy", source: "personal", runs: [run({ startedAt: END - 1510 })] }, NOW);
    expect(amy.confirmed).toEqual(["QG-20261110-190000-Kev"]);
    expect([...memory.runs.values()][0]!.confirmations).toBe(2);
    const bob = await ingestPublicRuns(memory.store, { uploaderKey: "account:bob", character: "Bob", source: "personal", runs: [run({ startedAt: END - 400, encounters: [] })] }, NOW);
    expect(bob.rejected[0]!.reason).toContain("held for review");
    expect([...memory.runs.values()][0]!.status).toBe("DISPUTED");
  });

  it("rejects bad input and limits uploads", async () => {
    const memory = memoryRunStore();
    const bad = await ingestPublicRuns(memory.store, { uploaderKey: "account:kev", character: "Kev", source: "personal", runs: [{ id: "x", players: "nope" }, run({ startedAt: END - 60 })] }, NOW);
    expect(bad.rejected.map((row) => row.reason)).toEqual(["not a valid run", "too short (60s)"]);
    await expect(ingestPublicRuns(memory.store, { uploaderKey: "account:kev", character: "Kev", source: "personal", runs: Array.from({ length: 51 }, () => run()) }, NOW)).rejects.toBeInstanceOf(PublicUploadError);
    await expect(ingestPublicRuns(memory.store, { uploaderKey: "account:kev", character: "Kev", source: "personal", runs: "x" }, NOW)).rejects.toThrow("list");
    for (let index = 0; index < 200; index++) memory.uploads.push({ uploaderKey: "account:kev", runRef: `r${index}`, at: NOW });
    await expect(ingestPublicRuns(memory.store, { uploaderKey: "account:kev", character: "Kev", source: "personal", runs: [run()] }, NOW)).rejects.toThrow("Too many runs");
  });
});
