import { describe, expect, it } from "vitest";
import { decide, EXPIRED_REASON, LIMIT_REASON, RUN_TRUST, SINGLE_WITNESS, SINGLE_WITNESS_SINCE, countsDeviceOnlyRuns, type Statement } from "../src/services/run-trust.js";
import { PLAUSIBILITY, plausibilityFlags, type PlausibilityRun } from "../src/services/run-plausibility.js";
import { canonicalText, sealMac, sealOf, sealReplay, verifySeal } from "../src/services/run-seal.js";
import { anomalyReport, describeAnomalies, deviceShortId, setDeviceExcluded } from "../src/services/run-anomalies.js";

// One witness is enough (docs/plans/SINGLE_WITNESS_2026-11-13.md). Nothing here makes a run cheat-proof; these are the mistake
// protections that stay and the flags that replace the second statement.

const NOW = 1_800_000_000;
const statement = (over: Partial<Statement> = {}): Statement => ({ deviceId: "d1", voucher: "kev", kind: "first-hand", instanceId: 90, difficultyId: 0,
  startedAt: NOW - 3000, endedAt: NOW - 300, players: ["amy", "bob", "kev"], bosses: [1, 2], ...over });

describe("the single-witness switch", () => {
  it("is on, and Season 2 no longer turns device-only runs off", () => {
    expect(SINGLE_WITNESS).toBe(true);
    expect(SINGLE_WITNESS_SINCE).toBe("2026-11-13");
    expect(countsDeviceOnlyRuns([1])).toBe(true);
    expect(countsDeviceOnlyRuns([1, 2])).toBe(true);
  });

  it("stores a run one device vouches for alone, with nobody known in the party, in Season 2 too", () => {
    expect(decide(statement(), [], { anchored: false, storedToday: 0, nowSec: NOW, allowDeviceOnly: countsDeviceOnlyRuns([1, 2]) })).toEqual({ store: "device" });
  });

  it("keeps the mistake protections: the daily limit waits until tomorrow, an old run no longer counts", () => {
    const context = { anchored: false, allowDeviceOnly: true, nowSec: NOW };
    expect(decide(statement(), [], { ...context, storedToday: RUN_TRUST.singleStatementRunsPerDevicePerDay })).toEqual({ wait: LIMIT_REASON });
    expect(LIMIT_REASON).toMatch(/tomorrow/);
    const old = decide(statement({ endedAt: NOW - RUN_TRUST.maxAgeSec - 10 }), [], { ...context, storedToday: 0 });
    expect(old).toEqual({ expire: EXPIRED_REASON });
    expect(EXPIRED_REASON).not.toMatch(/second player/);
  });

  it("still marks a run witnessed when an independent statement exists (information, not a condition)", () => {
    const other = statement({ deviceId: "d2", voucher: "bob" });
    expect(decide(statement(), [other], { anchored: false, storedToday: 0, nowSec: NOW, allowDeviceOnly: true })).toMatchObject({ store: "witnessed" });
  });
});

describe("plausibility flags", () => {
  const run = (over: Partial<PlausibilityRun> = {}): PlausibilityRun => ({ instanceId: 90, startedAt: NOW - 3000, endedAt: NOW - 300,
    players: [{ character: "Kev", level: 30 }, { character: "Bob", level: 30 }], kills: [{ id: 1, at: NOW - 2000 }, { id: 2, at: NOW - 400 }], ...over });
  const codes = (r: PlausibilityRun, context: Partial<Parameters<typeof plausibilityFlags>[1]> = {}) => plausibilityFlags(r, { runRef: "me", ...context }).map((flag) => flag.code);

  it("raises nothing for an ordinary run", () => {
    expect(codes(run())).toEqual([]);
  });

  it("flags a boss kill outside the run and kills out of time order", () => {
    expect(codes(run({ kills: [{ id: 1, at: NOW - 9000 }] }))).toEqual(["kill-outside-run"]);
    expect(codes(run({ kills: [{ id: 1, at: NOW - 400 }, { id: 2, at: NOW - 2000 }] }))).toEqual(["kills-out-of-order"]);
    expect(codes(run({ kills: [{ id: 1, at: null }, { id: 2, at: null }] }))).toEqual([]);
  });

  it("flags too little time per boss, and a clear far faster than the fastest known one", () => {
    expect(codes(run({ startedAt: NOW - 400, endedAt: NOW - 330, kills: [{ id: 1, at: NOW - 390 }, { id: 2, at: NOW - 350 }, { id: 3, at: NOW - 335 }] }))).toContain("too-fast-per-boss");
    const quick = run({ startedAt: NOW - 1000, endedAt: NOW - 300, kills: [] });
    expect(codes(quick, { fastest: { seconds: 1800, count: PLAUSIBILITY.recordSample } })).toEqual(["faster-than-record"]);
    expect(codes(quick, { fastest: { seconds: 1800, count: PLAUSIBILITY.recordSample - 1 } })).toEqual([]);
    expect(codes(quick, { fastest: { seconds: 1200, count: 20 } })).toEqual([]);
  });

  it("flags a level above the cap", () => {
    expect(codes(run({ players: [{ character: "Kev", level: PLAUSIBILITY.levelCap + 1 }] }))).toEqual(["level-above-cap"]);
    expect(codes(run({ players: [{ character: "Kev", level: PLAUSIBILITY.levelCap }, { character: "Bob", level: null }] }))).toEqual([]);
  });

  it("flags a character in two runs at once, and a start sooner than travel time after another dungeon", () => {
    const base = { startedAt: NOW - 3000, endedAt: NOW - 300 };
    expect(codes(run(), { neighbours: [{ runRef: "other", instanceId: 91, ...base, characters: ["Kev"] }] })).toEqual(["character-in-two-runs"]);
    expect(codes(run(), { neighbours: [{ runRef: "other", instanceId: 91, startedAt: NOW - 6000, endedAt: NOW - 3000 - 20, characters: ["Kev"] }] })).toEqual(["back-to-back"]);
    expect(codes(run(), { neighbours: [{ runRef: "other", instanceId: 91, startedAt: NOW - 6000, endedAt: NOW - 3000 - 600, characters: ["Kev"] }] })).toEqual([]);
    // Strangers, the run itself and the same clear under another id are not conflicts.
    expect(codes(run(), { neighbours: [{ runRef: "other", instanceId: 91, ...base, characters: ["Zed"] }] })).toEqual([]);
    expect(codes(run(), { neighbours: [{ runRef: "me", instanceId: 91, ...base, characters: ["Kev"] }] })).toEqual([]);
    expect(codes(run(), { neighbours: [{ runRef: "copy", instanceId: 90, ...base, characters: ["Kev"] }] })).toEqual([]);
  });

  it("flags one PC sending two overlapping runs", () => {
    expect(codes(run(), { deviceRuns: [{ runRef: "other", instanceId: 91, startedAt: NOW - 3000, endedAt: NOW - 300, characters: [] }] })).toEqual(["device-overlap"]);
    expect(codes(run(), { deviceRuns: [{ runRef: "other", instanceId: 91, startedAt: NOW - 400, endedAt: NOW - 200, characters: [] }] })).toEqual([]);
  });
});

describe("the run seal (a speed bump, never proof)", () => {
  const secret = "per-install-secret";
  const install = "0123456789abcdef";
  const base = { id: "QG-1", instanceId: 90, difficultyId: 0, startedAt: NOW - 3000, endedAt: NOW - 300, state: "COMPLETED", completedBy: "final boss",
    players: [{ character: "Kev", level: 30, deaths: 0, presentSec: 2700 }, { character: "Bob", level: 30, deaths: 1, presentSec: 2600 }],
    encounters: [{ id: 2, success: true, at: NOW - 400 }, { id: 1, success: true, at: NOW - 2000 }, { id: 9, success: false, at: NOW - 1000 }] };
  const sealed = (over: Record<string, unknown> = {}, seq = 1) => ({ ...base, ...over, integrity: { version: 2, seal: { install, seq, mac: sealMac(secret, { ...base, ...over }, install, seq) } } });

  it("writes a fixed canonical text, the same whatever the order of players", () => {
    const reversed = { ...base, players: [...base.players].reverse() };
    expect(canonicalText(base, install, 4)).toBe(canonicalText(reversed, install, 4));
    expect(canonicalText(base, install, 4).split("\n").slice(0, 4)).toEqual(["guilded-run-seal-1", install, "4", "QG-1"]);
  });

  it("is valid for an untouched run, invalid for an edited one, absent when there is none", () => {
    expect(verifySeal(sealed(), secret)).toBe("valid");
    expect(verifySeal({ ...sealed(), endedAt: NOW - 100 }, secret)).toBe("invalid");
    expect(verifySeal({ ...sealed(), players: [...base.players, { character: "Zed", level: 30, deaths: 0, presentSec: 2700 }] }, secret)).toBe("invalid");
    expect(verifySeal(sealed(), "another secret")).toBe("invalid");
    expect(verifySeal(base, secret)).toBe("absent");
    expect(verifySeal({ ...base, integrity: { version: 2, seal: { install: "zz", seq: 1, mac: "x" } } }, secret)).toBe("invalid");
  });

  it("reads only a well-formed seal", () => {
    expect(sealOf(sealed())).toMatchObject({ install, seq: 1 });
    expect(sealOf({ ...base, integrity: { seal: { install, seq: 0, mac: "a".repeat(64) } } })).toBeNull();
    expect(sealOf(null)).toBeNull();
  });

  it("spots a replayed or copied install: one sequence number on two runs", () => {
    const seen = new Map([["A", 1], ["B", 2]]);
    expect(sealReplay({ install, seq: 2, mac: "" }, "B", seen)).toBe(false);
    expect(sealReplay({ install, seq: 3, mac: "" }, "C", seen)).toBe(false);
    expect(sealReplay({ install, seq: 2, mac: "" }, "C", seen)).toBe(true);
  });
});

describe("the anomaly report and device exclusion", () => {
  const rows = [{ id: "r1", runRef: "QG-1", dungeonName: "Gnomeregan", endedAt: new Date("2026-11-13T12:00:00Z"), witnessCount: 1, anomalies: [{ code: "level-above-cap", detail: "Kev above level 60" }], players: [{ character: "Kev" }] }];
  const database = (devices: string[] = ["abcdef1234567890", "ffff00001111aaaa"]) => {
    const updated: Record<string, unknown>[] = [];
    return { updated, db: {
      dungeonRun: { findMany: async () => rows },
      dungeonRunWitness: { findMany: async (args: { where: { runId?: unknown } }) => args.where.runId ? [{ runId: "r1", deviceId: devices[0] }] : devices.map((deviceId) => ({ deviceId })) },
      companionDevice: { update: async (args: Record<string, unknown>) => { updated.push(args); return {}; } }
    } as never };
  };

  it("lists a flagged run with its flags, its PC code and its witness count, and says nothing is held", async () => {
    const { db } = database();
    const report = await anomalyReport(db, "g1");
    expect(report).toMatchObject([{ runRef: "QG-1", device: deviceShortId("abcdef1234567890"), flags: [{ code: "level-above-cap" }], witnesses: 1 }]);
    const text = describeAnomalies(report);
    expect(text).toContain("still count");
    expect(text).toContain("Kev above level 60");
    expect(describeAnomalies([])).toMatch(/No dungeon run was flagged/);
  });

  it("excludes and restores a PC by the code, only when exactly one matches", async () => {
    const { db, updated } = database();
    expect(await setDeviceExcluded(db, "g1", deviceShortId("abcdef1234567890"), true, "forged runs")).toBe(true);
    expect(updated[0]).toMatchObject({ where: { id: "abcdef1234567890" }, data: { excludedReason: "forged runs" } });
    expect(await setDeviceExcluded(db, "g1", deviceShortId("abcdef1234567890"), false, "")).toBe(true);
    expect(updated[1]).toMatchObject({ data: { excludedAt: null, excludedReason: null } });
    expect(await setDeviceExcluded(db, "g1", "nomatch1", true, "")).toBe(false);
    expect(await setDeviceExcluded(db, "g1", "ab", true, "")).toBe(false);
    const ambiguous = database(["aaaa1234", "bbbb1234"]);
    expect(await setDeviceExcluded(ambiguous.db, "g1", "1234", true, "")).toBe(false);
  });
});
