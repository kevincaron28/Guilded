import { describe, expect, it } from "vitest";
import { decide, EXPIRED_REASON, LIMIT_REASON, RUN_TRUST, SINGLE_WITNESS, SINGLE_WITNESS_SINCE, countsDeviceOnlyRuns, type Statement } from "../src/services/run-trust.js";
import { PLAUSIBILITY, plausibilityFlags, type PlausibilityRun } from "../src/services/run-plausibility.js";
import { NO_PREV, canonicalText, chainHash, challengeTime, contradicts, deriveSealKey, issueChallenge, sealMac, sealOf, verifyBatch, type BatchContext, type BatchEntry } from "../src/services/run-challenge.js";
import { DEFAULT_CONFIG, challengeSecret, holdsRun, integrityConfig, parseIntegrityConfig } from "../src/services/run-integrity-config.js";
import { anomalyReport, describeAnomalies, deviceShortId, setDeviceExcluded } from "../src/services/run-anomalies.js";

// One witness is enough (docs/plans/SINGLE_WITNESS_2026-11-13.md): the protections that stay and the checks that replace the second statement.

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

const STRICT = { ...PLAUSIBILITY, minSecondsPerBoss: 30, killSlackSec: 30, recordShare: 0.5, recordSample: 5, travelSec: 60, overlapSlackSec: 120 };

describe("plausibility flags", () => {
  const run = (over: Partial<PlausibilityRun> = {}): PlausibilityRun => ({ instanceId: 90, startedAt: NOW - 3000, endedAt: NOW - 300,
    players: [{ character: "Kev", level: 30 }, { character: "Bob", level: 30 }], kills: [{ id: 1, at: NOW - 2000 }, { id: 2, at: NOW - 400 }], ...over });
  const codes = (r: PlausibilityRun, context: Partial<Parameters<typeof plausibilityFlags>[1]> = {}) => plausibilityFlags(r, { runRef: "me", limits: STRICT, ...context }).map((flag) => flag.code);

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
    expect(codes(quick, { fastest: { seconds: 1800, count: STRICT.recordSample } })).toEqual(["faster-than-record"]);
    expect(codes(quick, { fastest: { seconds: 1800, count: STRICT.recordSample - 1 } })).toEqual([]);
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

describe("the record challenge and chain (shared module)", () => {
  const secret = "server-secret-0123456789";
  const deviceKey = "device-key-abc";
  const sealKey = deriveSealKey(deviceKey);
  const base = { id: "QG-1", instanceId: 90, difficultyId: 0, startedAt: NOW - 3000, endedAt: NOW - 300, state: "COMPLETED", completedBy: "final boss",
    players: [{ character: "Kev", level: 30, deaths: 0, presentSec: 2700 }, { character: "Bob", level: 30, deaths: 1, presentSec: 2600 }],
    encounters: [{ id: 2, success: true, at: NOW - 400 }, { id: 1, success: true, at: NOW - 2000 }, { id: 9, success: false, at: NOW - 1000 }] };
  const nonce = issueChallenge(secret, "d1", NOW - 3500);
  const make = (n: number, prev: string, over: Record<string, unknown> = {}, sign = true, n0 = nonce) => {
    const run = { ...base, id: `QG-${n}`, ...over };
    const seal = { n, nonce: n0, prev };
    const canonical = canonicalText(run, seal);
    return { raw: { ...run, integrity: { seal: { ...seal, ...(sign ? { mac: sealMac(sealKey, canonical) } : {}) } } }, canonical };
  };
  const entry = (item: { raw: unknown }, ref: string, over: Partial<BatchEntry> = {}): BatchEntry => ({ raw: item.raw, ref, endedAt: NOW - 300, kind: "first-hand", earlier: false, ...over });
  const context = (over: Partial<BatchContext> = {}): BatchContext => ({ deviceId: "d1", sealKey, secret, head: null, windowSec: 14 * 86400, requireSeal: false, ...over });
  const codes = (result: { flags: Map<string, { code: string }[]> }, ref: string) => (result.flags.get(ref) ?? []).map((flag) => flag.code);

  it("issues a challenge that only its own PC and this server can have made", () => {
    expect(challengeTime(secret, "d1", nonce)).toBe(NOW - 3500);
    expect(challengeTime(secret, "d2", nonce)).toBeNull();
    expect(challengeTime("another-secret-0123456789", "d1", nonce)).toBeNull();
    expect(challengeTime(secret, "d1", "garbage")).toBeNull();
  });

  it("writes the same canonical text whatever the order of players, and a different one when a field changes", () => {
    const seal = { n: 4, nonce, prev: NO_PREV };
    expect(canonicalText(base, seal)).toBe(canonicalText({ ...base, players: [...base.players].reverse() }, seal));
    expect(canonicalText(base, seal)).not.toBe(canonicalText({ ...base, endedAt: NOW - 100 }, seal));
    expect(canonicalText(base, seal).split("\n").slice(0, 4)).toEqual(["guilded-record-2", "4", nonce, NO_PREV]);
  });

  it("derives one signing key per device key", () => {
    expect(deriveSealKey("a")).toBe(deriveSealKey("a"));
    expect(deriveSealKey("a")).not.toBe(deriveSealKey("b"));
  });

  it("accepts a linked chain of signed records and moves the head", () => {
    const first = make(1, NO_PREV), second = make(2, chainHash(first.canonical));
    const result = verifyBatch([entry(first, "a"), entry(second, "b")], context());
    expect([...result.flags.keys()]).toEqual([]);
    expect(result.head).toEqual({ n: 2, hash: chainHash(second.canonical) });
  });

  it("flags a record edited after signing, or signed with another key, and one never signed", () => {
    const item = make(1, NO_PREV);
    const edited = { raw: { ...(item.raw as object), endedAt: NOW - 100 } };
    expect(codes(verifyBatch([entry(edited, "a")], context()), "a")).toContain("seal-invalid");
    expect(codes(verifyBatch([entry(item, "a")], context({ sealKey: deriveSealKey("other") })), "a")).toContain("seal-invalid");
    expect(codes(verifyBatch([entry(make(1, NO_PREV, {}, false), "a")], context()), "a")).toEqual(["seal-unsigned"]);
  });

  it("flags a challenge the PC was never given, one from the future and one far older than the run", () => {
    expect(codes(verifyBatch([entry(make(1, NO_PREV, {}, true, issueChallenge(secret, "d9", NOW - 3500)), "a")], context()), "a")).toContain("nonce-foreign");
    expect(codes(verifyBatch([entry(make(1, NO_PREV, {}, true, issueChallenge(secret, "d1", NOW + 5000)), "a")], context()), "a")).toContain("nonce-future");
    expect(codes(verifyBatch([entry(make(1, NO_PREV), "a")], context({ windowSec: 600 })), "a")).toContain("nonce-window");
    expect(codes(verifyBatch([entry(make(1, NO_PREV), "a")], context({ secret: null })), "a")).toEqual([]);
  });

  it("does not hold a guildmate's relayed record to this PC's challenges or chain", () => {
    const relayed = make(7, "f".repeat(64), {}, true, issueChallenge(secret, "someone-else", NOW - 3500));
    expect(codes(verifyBatch([entry(relayed, "a", { kind: "relay" })], context()), "a")).toEqual([]);
  });

  it("flags a broken link, a forked number and a number already used", () => {
    const first = make(1, NO_PREV);
    expect(codes(verifyBatch([entry(first, "a"), entry(make(2, "0".repeat(63) + "1"), "b")], context()), "b")).toEqual(["chain-break"]);
    const twin = make(1, NO_PREV, { id: "QG-twin" });
    const fork = verifyBatch([entry(first, "a"), entry(twin, "b")], context());
    expect(codes(fork, "a")).toContain("chain-fork");
    expect(codes(fork, "b")).toContain("chain-fork");
    const head = { n: 5, hash: "a".repeat(64) };
    expect(codes(verifyBatch([entry(make(3, NO_PREV), "a")], context({ head })), "a")).toEqual(["chain-fork"]);
    expect(codes(verifyBatch([entry(make(6, "b".repeat(64)), "a")], context({ head })), "a")).toEqual(["chain-break"]);
    expect(codes(verifyBatch([entry(make(6, head.hash), "a")], context({ head })), "a")).toEqual([]);
    expect(codes(verifyBatch([entry(make(3, NO_PREV), "a", { earlier: true })], context({ head })), "a")).toEqual([]);
  });

  it("counts a missing seal only when the server requires one", () => {
    const plain = { raw: base };
    expect(codes(verifyBatch([entry(plain, "a")], context()), "a")).toEqual([]);
    expect(codes(verifyBatch([entry(plain, "a")], context({ requireSeal: true })), "a")).toEqual(["seal-missing"]);
    expect(sealOf(null)).toBeNull();
    expect(sealOf({ integrity: { seal: { n: 0, nonce, prev: NO_PREV } } })).toBeNull();
  });
});

describe("two copies of one run that disagree", () => {
  const a = statement({ deviceId: "d1", voucher: "kev" });
  it("agrees when both copies match, and flags a near-match that is not the same run", () => {
    expect(contradicts(a, statement({ deviceId: "d2", voucher: "bob" }))).toBe(false);
    expect(contradicts(a, statement({ deviceId: "d2", voucher: "bob", bosses: [1, 2, 3] }))).toBe(true);
    expect(contradicts(a, statement({ deviceId: "d2", voucher: "bob", endedAt: NOW - 300 + 60, startedAt: NOW - 3000 + 60 }))).toBe(true);
  });
  it("ignores other dungeons, strangers and a clear right after another", () => {
    expect(contradicts(a, statement({ deviceId: "d2", instanceId: 91, bosses: [5] }))).toBe(false);
    expect(contradicts(a, statement({ deviceId: "d2", players: ["xed", "yan", "zed"], bosses: [1] }))).toBe(false);
    expect(contradicts(a, statement({ deviceId: "d2", startedAt: NOW - 280, endedAt: NOW + 100, bosses: [3] }))).toBe(false);
  });
});

describe("server configuration and holding a run", () => {
  it("keeps the defaults for missing or broken configuration and clamps what is given", () => {
    expect(parseIntegrityConfig(undefined)).toBe(DEFAULT_CONFIG);
    expect(parseIntegrityConfig("{nope")).toBe(DEFAULT_CONFIG);
    const config = parseIntegrityConfig(JSON.stringify({ holdScore: 2, weights: { "seal-invalid": 5, bad: "x" }, limits: { minSecondsPerBoss: 45, levelCap: "x" }, requireSeal: true }));
    expect(config).toMatchObject({ holdScore: 2, weights: { "seal-invalid": 5 }, requireSeal: true, limits: { minSecondsPerBoss: 45, levelCap: PLAUSIBILITY.levelCap } });
    expect(parseIntegrityConfig(JSON.stringify({ holdScore: -5 })).holdScore).toBe(1);
  });

  it("reads the live configuration and secret from the environment only", () => {
    expect(integrityConfig({ RUN_INTEGRITY_CONFIG: JSON.stringify({ holdScore: 9 }) } as never).holdScore).toBe(9);
    expect(challengeSecret({} as never)).toBeNull();
    expect(challengeSecret({ RUN_CHALLENGE_SECRET: "short" } as never)).toBeNull();
    expect(challengeSecret({ RUN_CHALLENGE_SECRET: "a-long-enough-secret" } as never)).toBe("a-long-enough-secret");
  });

  it("holds a run whose weights add up, or any flagged run from a PC with strikes; one soft flag only reports", () => {
    const config = parseIntegrityConfig(JSON.stringify({ holdScore: 3, deviceStrikes: 2, weights: { hard: 3 } }));
    expect(holdsRun([], config, 99)).toBe(false);
    expect(holdsRun(["soft"], config, 0)).toBe(false);
    expect(holdsRun(["soft", "soft2", "soft3"], config, 0)).toBe(true);
    expect(holdsRun(["hard"], config, 0)).toBe(true);
    expect(holdsRun(["soft"], config, 2)).toBe(true);
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

  it("lists a flagged run with its flags, its PC code and its witness count, and says they count", async () => {
    const { db } = database();
    const report = await anomalyReport(db, "g1");
    expect(report).toMatchObject([{ runRef: "QG-1", device: deviceShortId("abcdef1234567890"), flags: [{ code: "level-above-cap" }], witnesses: 1 }]);
    const text = describeAnomalies(report);
    expect(text).toContain("Flagged runs");
    expect(text).toContain("Kev above level 60");
    expect(describeAnomalies([])).toMatch(/No dungeon run was flagged/);
  });

  it("excludes and restores a PC by the code, only when exactly one matches", async () => {
    const { db, updated } = database();
    expect(await setDeviceExcluded(db, "g1", deviceShortId("abcdef1234567890"), true, "officer")).toBe(true);
    expect(updated[0]).toMatchObject({ where: { id: "abcdef1234567890" }, data: { excludedReason: "officer" } });
    expect(await setDeviceExcluded(db, "g1", deviceShortId("abcdef1234567890"), false, "")).toBe(true);
    expect(updated[1]).toMatchObject({ data: { excludedAt: null, excludedReason: null } });
    expect(await setDeviceExcluded(db, "g1", "nomatch1", true, "")).toBe(false);
    expect(await setDeviceExcluded(db, "g1", "ab", true, "")).toBe(false);
    const ambiguous = database(["aaaa1234", "bbbb1234"]);
    expect(await setDeviceExcluded(ambiguous.db, "g1", "1234", true, "")).toBe(false);
  });
});
