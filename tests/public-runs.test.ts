import { describe, expect, it } from "vitest";
import { agrees, evidenceUpgrade, checkPublicRun, ingestPublicRuns, PublicUploadError, seasonOf, summarize, type PublicRunStore, type RunSummary, type StoredRun } from "../src/services/public-runs.js";
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
    async createRun(summary, uploader) {
      runs.set(summary.runKey, { ...summary, id: `r${++next}`, status: "ACCEPTED",
        uploaders: [uploader.key], reporters: [...uploader.reporters], summary, confirmations: 1 });
      uploads.push({ uploaderKey: uploader.key, runRef: summary.runRef, at: NOW });
    },
    async addUpload(runId, uploader, summary) {
      const row = [...runs.values()].find((entry) => entry.id === runId)!;
      const agree = agrees(row, summary);
      const confirm = agree && uploader.reporters.length > 0 && !uploader.reporters.some(name => row.reporters.includes(name));
      if (row.status === "ACCEPTED" && evidenceUpgrade(row, summary)) Object.assign(row, summary, { summary });
      row.uploaders.push(uploader.key);
      row.reporters.push(...uploader.reporters.filter((name) => !row.reporters.includes(name)));
      if (!agree) row.status = "DISPUTED"; else if (confirm) row.confirmations++;
      uploads.push({ uploaderKey: uploader.key, runRef: summary.runRef, at: NOW });
      return { agree, duplicate: false };
    },
    async uploadsSince(uploaderKey, since) { return uploads.filter((u) => u.uploaderKey === uploaderKey && u.at >= since).length; },
    async storedRefs(uploaderKey) { return uploads.filter((u) => u.uploaderKey === uploaderKey).map((u) => u.runRef); }
  };
  return { store, runs, uploads };
}

describe("public run checks", () => {
  it("does not let another client enter or confirm a Forever competition", async () => {
    const memory = memoryRunStore();
    const first = await ingestPublicRuns(memory.store, { uploaderKey: "forever", character: "Kev", source: "personal", runs: [run({ interface: 16001 })] }, NOW);
    expect(first.accepted).toHaveLength(1);
    const other = await ingestPublicRuns(memory.store, { uploaderKey: "retail", character: "Kev-doomhowl", gameEdition: "retail", source: "personal", runs: [run({ interface: 120105, recorder: "Kev-doomhowl", reporterNames: ["Kev-doomhowl", "Amy-doomhowl"] })] }, NOW);
    expect(other.rejected).toEqual([]);
    expect(other.accepted).toHaveLength(1);
    expect(other.confirmed).toEqual([]);
    expect(memory.runs.size).toBe(2);
    expect(memory.uploads).toHaveLength(2);
  });
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

  it("keeps the evidence a ranked run needs: completion, boss kills, start levels and presence", () => {
    const summary = summarize(parse(run({ completedBy: "final boss", encounters: [{ id: 1, success: false, at: END - 950 }, { id: 2, name: "Bazzalan", success: true, at: END - 10, startedAt: END - 60 }],
      players: [{ character: "Kev", realm: "Doomhowl", level: 17, minLevel: 16, presentSec: 1400, inGuild: false }] })));
    expect(summary).toMatchObject({ evidenceVersion: 1, completedBy: "final boss", encounters: [{ id: 2, name: "Bazzalan", success: true, at: END - 10, startedAt: END - 60 }] });
    expect(summary.players[0]).toMatchObject({ level: 17, minLevel: 16, presentSec: 1400 });
    // Older addons say why the run ended instead.
    expect(summarize(parse(run({ endReason: "manual" }))).completedBy).toBe("manual");
  });

  it("decides when two uploads of one run agree", () => {
    const stored = summarize(parse(run()));
    expect(agrees(stored, summarize(parse(run({ startedAt: END - 1520 }))))).toBe(true);
    expect(agrees(stored, summarize(parse(run({ startedAt: END - 1200 }))))).toBe(false);
    expect(agrees(stored, summarize(parse(run({ players: [{ character: "Zed", realm: "X", presentSec: 1, inGuild: false }], recorder: "Zed", reporterNames: ["Zed"] }))))).toBe(false);
  });

  it("rejects contradictory scoring facts even when clocks and party overlap agree", () => {
    const stored = summarize(parse(run({ completedBy: "final boss" })));
    for (const update of [{ difficultyId: 9 }, { instanceId: 189 }, { routeKey: "189:library" },
      { players: stored.players.map(p => ({ ...p, level: 99 })) },
      { players: stored.players.map(p => ({ ...p, realm: "Other" })) },
      { players: stored.players.map(p => ({ ...p, presentSec: 1100 })) },
      { players: stored.players.map(p => ({ ...p, role: "DAMAGER" })) },
      { encounters: [{ id: 999, success: true as const }] }]) {
      expect(agrees(stored, { ...stored, ...update })).toBe(false);
    }
  });

  it("only promotes a coherent stronger observation without changing clocks or party eligibility", async () => {
    const memory = memoryRunStore();
    const initial = run({ completedBy: "manual", encounters: [{ id: 1, success: true, at: END - 900 }] });
    await ingestPublicRuns(memory.store, { uploaderKey: "guild:g", character: null, source: "guild", runs: [initial] }, NOW);
    const full = run({ completedBy: "final boss" });
    await ingestPublicRuns(memory.store, { uploaderKey: "account:kev", character: "Kev", source: "personal", runs: [full] }, NOW);
    const row = [...memory.runs.values()][0]!;
    expect(row).toMatchObject({ completedBy: "final boss", confirmations: 1, evidenceVersion: 1 });
    expect(row.encounters).toHaveLength(2);
    const original = summarize(parse(initial));
    expect(evidenceUpgrade(original, summarize(parse(full)))).toBe(true);
    expect(evidenceUpgrade(original, summarize(parse({ ...full, startedAt: END - 1510 })))).toBe(false);
    expect(evidenceUpgrade(row, original)).toBe(false);
    row.status = "DISPUTED";
    row.completedBy = "manual";
    await ingestPublicRuns(memory.store, { uploaderKey: "account:bob", character: "Bob", source: "personal", runs: [full] }, NOW);
    expect(row).toMatchObject({ status: "DISPUTED", completedBy: "manual" });
  });
});

describe("public run uploads", () => {
  it("rechecks a simultaneous first insert instead of failing the upload", async () => {
    const memory = memoryRunStore();
    const create = memory.store.createRun;
    memory.store.createRun = async (summary, _uploader, source) => {
      await create(summary, { key: "account:amy", reporters: ["amy"] }, source);
      throw Object.assign(new Error("Unique constraint"), { code: "P2002" });
    };
    const result = await ingestPublicRuns(memory.store, { uploaderKey: "account:kev", character: "Kev", source: "personal", runs: [run()] }, NOW);
    expect(result.confirmed).toEqual([run().id]);
    expect([...memory.runs.values()][0]!.confirmations).toBe(2);
  });

  it("enriches missing eligibility fields but never drops recorded boss clocks", () => {
    const full = summarize(parse(run({ completedBy: "final boss" })));
    const partial = { ...full, players: full.players.map(p => ({ ...p, level: null, minLevel: null })) };
    expect(evidenceUpgrade(partial, full)).toBe(true);
    expect(evidenceUpgrade(partial, { ...full, encounters: full.encounters.map(e => ({ id: e.id, success: true })) })).toBe(false);
    expect(evidenceUpgrade(full, full)).toBe(false);
  });

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

  it("counts one report once when it arrives through the guild and the member's own companion", async () => {
    const memory = memoryRunStore();
    // The guild's copy carries Kev's and Amy's reports (reporter names and recorder).
    await ingestPublicRuns(memory.store, { uploaderKey: "guild:g1", character: null, source: "guild", runs: [run()] }, NOW);
    expect([...memory.runs.values()][0]!.reporters).toEqual(["kev", "amy"]);
    const kev = await ingestPublicRuns(memory.store, { uploaderKey: "account:kev", character: "Kev", source: "personal", runs: [run()] }, NOW);
    expect(kev.confirmed).toEqual(["QG-20261110-190000-Kev"]);
    expect([...memory.runs.values()][0]!.confirmations).toBe(1);
    // Bob's own report is a second, independent one.
    await ingestPublicRuns(memory.store, { uploaderKey: "account:bob", character: "Bob", source: "personal", runs: [run()] }, NOW);
    expect([...memory.runs.values()][0]!.confirmations).toBe(2);
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
