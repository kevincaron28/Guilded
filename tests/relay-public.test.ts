import { afterEach, describe, expect, it, vi } from "vitest";
import { agrees, evidenceUpgrade, ingestPublicRuns, type PublicRunStore, type RunSummary, type StoredRun } from "../src/services/public-runs.js";
import { carrySignedGroupRuns, GROUP_RECEIPT_PREFIX, ingestRelayedRuns, runIds, STRANGER_NOTE, strangerReceipts } from "../src/services/relay-public.js";

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
    const answer = await carrySignedGroupRuns(snapshot, { carrier: "member:m1", store, saveReceipts: async (rows) => { saved.push(rows.map((row) => row.runRef)); } });
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

  // 14 November 2026: snapshot.characters is every guildmate heard (peer digests). Treating them as the carrier's own made a run an addon-only
  // guildmate's addon relayed look like the carrier's own run: it was receipted as "dealt with" and never reached the public boards.
  it("a run relayed for an addon-only guildmate is placed, even though the carrier's snapshot lists that guildmate in the roster", async () => {
    const roster = [{ name: "Amy" }, { name: "Bob" }, { name: "Kev" }];
    // What the old rule did: the roster counted as the carrier's own characters.
    const before = memoryStore();
    const old = await ingestRelayedRuns(before.store, { carrier: "member:m1", carrierKeys: new Set(["zed", ...roster.map((entry) => entry.name.toLowerCase())]), runs: [run("QG-R1")], now: NOW });
    expect(old.published).toBe(0);
    expect(before.runs.size).toBe(0);
    // The rule now: only the exported character, the alts and the uploader's own database characters.
    const { store, runs } = memoryStore();
    const saved: string[][] = [];
    const snapshot = { dungeonRuns: [run("QG-R1")] as unknown[], character: { name: "Zed" }, alts: [], characters: roster };
    const lines = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const answer = await carrySignedGroupRuns(snapshot, { carrier: "member:m1", ownKeys: new Set(["zed"]), store, saveReceipts: async (rows) => { saved.push(rows.map((row) => row.runRef)); } });
    expect(answer?.published).toBe(1);
    expect(runs.size).toBe(1);
    expect(saved).toEqual([[`${GROUP_RECEIPT_PREFIX}QG-R1`]]);
    // A run the carrier played itself is still its own, and says so in the log.
    const own = await carrySignedGroupRuns({ dungeonRuns: [run("QG-R2")] as unknown[], character: { name: "Kev" }, alts: [], characters: roster }, { carrier: "member:m1", ownKeys: new Set(["kev"]), store, saveReceipts: async () => undefined });
    expect(own?.published).toBe(0);
    expect(lines.mock.calls.flat().join(" ")).toMatch(/QG-R2 via member:m1: not placed \(carrier played it itself\)/);
    lines.mockRestore();
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

// 16 November 2026 (live): four runs another player's addon recorded, carried by the owner's addon in its own run list. No player of the
// guild in them, so the guild lane handed them to this lane, which answered only "group:<id>". The addon takes a "group:" receipt for its
// carried list only, so the four stayed "have not reached Discord" after every /reload and were sent again at every upload.
describe("runs of no guild player handed over by the guild lane", () => {
  const T = Math.floor(NOW.getTime() / 1000) - 6 * 3600;
  const party = (names: string[]) => names.map((character, index) => ({ character, realm: "Forever", class: "PALADIN", role: index ? "DAMAGER" : "TANK", level: 23, deaths: 0, presentSec: 1400, inGuild: false }));
  const carriedRun = (id: string, over: Record<string, unknown> & { state: string }) => ({ id, protocolVersion: 1, difficultyId: 0, gameEdition: "forever", recorder: "Caliban Dawnbreaker",
    reporters: 1, reporterNames: ["Caliban Dawnbreaker"], ...over });
  const four = () => [
    carriedRun("QG-20261116-032503-Caliban Dawnbreaker", { state: "COMPLETED", instanceId: 36, name: "Deadmines", completedBy: "final boss", startedAt: T, endedAt: T + 1479,
      encounters: [{ id: 2741, success: true, at: T + 160 }, { id: 2747, success: true, at: T + 1479 }], players: party(["Caliban Dawnbreaker", "Hueso Flacido", "Madcat Pierrot", "Mcnasty Hemcore", "Wasoo Pakeado"]) }),
    carriedRun("QG-20261116-122231-Caliban Dawnbreaker", { state: "ABANDONED", instanceId: 48, name: "Blackfathom Deeps", endReason: "left the dungeon", startedAt: T + 4000, endedAt: T + 4972,
      encounters: [], players: party(["Caliban Dawnbreaker"]) }),
    carriedRun("QG-20261116-011224-Caliban Dawnbreaker", { state: "COMPLETED", instanceId: 33, name: "Shadowfang Keep", completedBy: "final boss", startedAt: T - 9000, endedAt: T - 6865,
      encounters: [{ id: 2748, success: true, at: T - 8800 }, { id: 2755, success: true, at: T - 6865 }], players: party(["Caliban Dawnbreaker", "Dreamcream Allonya", "Dyme Desarian", "Ryouie Holylight", "Slippery Popsicle"]) }),
    carriedRun("QG-20261116-022440-Caliban Dawnbreaker", { state: "ABANDONED", instanceId: 36, name: "Deadmines", endReason: "group disbanded", startedAt: T - 4000, endedAt: T - 2925,
      encounters: [{ id: 2741, success: true, at: T - 3800 }], players: party(["Caliban Dawnbreaker", "Feral Depravity", "Nimaa Undertoe", "Shamyfury Shaminator"]) })
  ];

  it("gives each of them a plain receipt with a note besides the group: one, so the addon marks them synced, and never puts them in the guild", async () => {
    const { splitStrangerRuns } = await import("../src/services/guild-participants.js");
    const { store } = memoryStore();
    const ownRun = { ...run("QG-OWN"), viaGroup: undefined, players: party(["Kev Owner", "Caliban Dawnbreaker"]) };
    const sorted = splitStrangerRuns([...four(), ownRun], { gate: true, names: ["kev owner", "someone else"] });
    expect(sorted.strangers).toHaveLength(4);
    const snapshot = { dungeonRuns: [...sorted.guild, ...sorted.strangers], character: { name: "Kev Owner" }, alts: [], characters: [] };
    const saved: { runRef: string; reason: string | null }[][] = [];
    const lines = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const answer = await carrySignedGroupRuns(snapshot, { carrier: "member:m1", ownKeys: new Set(["kev owner"]), strangerIds: new Set(runIds(sorted.strangers)), store,
      saveReceipts: async (rows) => { saved.push(rows); } });
    const journal = lines.mock.calls.flat().join("\n");
    lines.mockRestore();
    // The guild lane keeps only the guild's own run.
    expect(snapshot.dungeonRuns.map((entry) => (entry as { id: string }).id)).toEqual(["QG-OWN"]);
    const ids = four().map((entry) => entry.id);
    expect(answer?.receipts.sort()).toEqual(ids.map((id) => `${GROUP_RECEIPT_PREFIX}${id}`).sort());
    expect(saved).toHaveLength(1);
    const rows = saved[0]!;
    // Plain ids, spaces kept exactly as the addon names the run, with the note it shows next to them.
    for (const id of ids) {
      expect(rows).toContainEqual({ runRef: id, reason: STRANGER_NOTE });
      expect(rows).toContainEqual({ runRef: `${GROUP_RECEIPT_PREFIX}${id}`, reason: null });
    }
    expect(STRANGER_NOTE.length).toBeLessThanOrEqual(80);
    // The journal always says what the lane did, even when every run went through quietly.
    expect(journal).toMatch(/Relayed runs via member:m1: received 4, placed \d+, copies \d+, receipted 4/);
  });

  it("a stranger run the public lane leaves for later gets no plain receipt either (sent again, never lost)", async () => {
    const failing = { ...memoryStore().store, createRun: async () => { throw new Error("budget"); }, addUpload: async () => { throw new Error("budget"); } } as PublicRunStore;
    const runs = four().filter((entry) => entry.state === "COMPLETED").map((entry) => ({ ...entry, viaGroup: true }));
    const saved: { runRef: string; reason: string | null }[][] = [];
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const quiet = vi.spyOn(console, "info").mockImplementation(() => undefined);
    await carrySignedGroupRuns({ dungeonRuns: runs, character: { name: "Kev Owner" }, alts: [], characters: [] },
      { carrier: "member:m1", ownKeys: new Set(["kev owner"]), strangerIds: new Set(runIds(runs)), store: failing, saveReceipts: async (rows) => { saved.push(rows); } });
    errors.mockRestore(); quiet.mockRestore();
    expect(saved.flat().filter((row) => !row.runRef.startsWith(GROUP_RECEIPT_PREFIX))).toEqual([]);
  });

  it("strangerReceipts only answers runs the lane dealt with", () => {
    expect(strangerReceipts(["a b", "c"], [`${GROUP_RECEIPT_PREFIX}a b`, `${GROUP_RECEIPT_PREFIX}x`])).toEqual(["a b"]);
  });

  it("a run with no usable id is said in the journal, not skipped silently", async () => {
    const { store } = memoryStore();
    const lines = vi.spyOn(console, "info").mockImplementation(() => undefined);
    await ingestRelayedRuns(store, { carrier: "dev1", carrierKeys: carrier("zed"), runs: [run("QG-R9", { id: 42 })], now: NOW });
    const journal = lines.mock.calls.flat().join("\n");
    lines.mockRestore();
    expect(journal).toMatch(/Relayed run via dev1: skipped \(no usable id\)/);
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
