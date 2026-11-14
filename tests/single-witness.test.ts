import { describe, expect, it, vi } from "vitest";
import { decide, EXPIRED_REASON, LIMIT_REASON, RUN_TRUST, SINGLE_WITNESS, SINGLE_WITNESS_SINCE, countsDeviceOnlyRuns, type Statement } from "../src/services/run-trust.js";
import { plausibilityFlags, type PlausibilityRun } from "../src/services/run-plausibility.js";
import { NO_PREV, canonicalText, chainHash, challengeTime, contradicts, deriveSealKey, issueChallenge, sealMac, sealOf, verifyBatch, type BatchContext, type BatchEntry } from "../src/services/run-challenge.js";
import { DEFAULT_CONFIG, challengeSecret, holdsRun, integrityConfig, parseIntegrityConfig } from "../src/services/run-integrity-config.js";
import { anomalyReport, describeAnomalies, describeHeld, deviceShortId, setDeviceExcluded } from "../src/services/run-anomalies.js";

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

const STRICT = { levelCap: 40, minSecondsPerBoss: 25, killSlackSec: 15, recordShare: 0.4, recordSample: 4, travelSec: 75, overlapSlackSec: 90, reachSec: 9000, sharedPlayers: 2, endSpreadSec: 600 };

describe("plausibility checks", () => {
  const run = (over: Partial<PlausibilityRun> = {}): PlausibilityRun => ({ instanceId: 90, startedAt: NOW - 3000, endedAt: NOW - 300,
    players: [{ character: "Kev", level: 30 }, { character: "Bob", level: 30 }], kills: [{ id: 1, at: NOW - 2000 }, { id: 2, at: NOW - 400 }], ...over });
  const codes = (r: PlausibilityRun, context: Partial<Parameters<typeof plausibilityFlags>[1]> = {}) => plausibilityFlags(r, { runRef: "me", limits: STRICT, ...context }).map((flag) => flag.code);

  it("case 0", () => {
    expect(codes(run())).toEqual([]);
  });

  it("case 1", () => {
    expect(codes(run({ kills: [{ id: 1, at: NOW - 9000 }] }))).toEqual(["timing"]);
    expect(codes(run({ kills: [{ id: 1, at: NOW - 400 }, { id: 2, at: NOW - 2000 }] }))).toEqual(["sequence"]);
    expect(codes(run({ kills: [{ id: 1, at: null }, { id: 2, at: null }] }))).toEqual([]);
  });

  it("case 2", () => {
    expect(codes(run({ startedAt: NOW - 400, endedAt: NOW - 330, kills: [{ id: 1, at: NOW - 390 }, { id: 2, at: NOW - 350 }, { id: 3, at: NOW - 335 }] }))).toContain("timing");
    const quick = run({ startedAt: NOW - 1000, endedAt: NOW - 300, kills: [] });
    expect(codes(quick, { fastest: { seconds: 1800, count: STRICT.recordSample } })).toEqual(["timing"]);
    expect(codes(quick, { fastest: { seconds: 1800, count: STRICT.recordSample - 1 } })).toEqual([]);
    expect(codes(quick, { fastest: { seconds: 1200, count: 20 } })).toEqual([]);
  });

  it("case 3", () => {
    expect(codes(run({ players: [{ character: "Kev", level: STRICT.levelCap + 1 }] }))).toEqual(["profile"]);
    expect(codes(run({ players: [{ character: "Kev", level: STRICT.levelCap }, { character: "Bob", level: null }] }))).toEqual([]);
  });

  it("case 4", () => {
    const base = { startedAt: NOW - 3000, endedAt: NOW - 300 };
    expect(codes(run(), { neighbours: [{ runRef: "other", instanceId: 91, ...base, characters: ["Kev"] }] })).toEqual(["identity"]);
    expect(codes(run(), { neighbours: [{ runRef: "other", instanceId: 91, startedAt: NOW - 6000, endedAt: NOW - 3000 - 20, characters: ["Kev"] }] })).toEqual(["identity"]);
    expect(codes(run(), { neighbours: [{ runRef: "other", instanceId: 91, startedAt: NOW - 6000, endedAt: NOW - 3000 - 600, characters: ["Kev"] }] })).toEqual([]);
    expect(codes(run(), { neighbours: [{ runRef: "other", instanceId: 91, ...base, characters: ["Zed"] }] })).toEqual([]);
    expect(codes(run(), { neighbours: [{ runRef: "me", instanceId: 91, ...base, characters: ["Kev"] }] })).toEqual([]);
    expect(codes(run(), { neighbours: [{ runRef: "copy", instanceId: 90, ...base, characters: ["Kev"] }] })).toEqual([]);
  });

  it("case 5", () => {
    const base = { startedAt: NOW - 3000, endedAt: NOW - 300 };
    expect(codes(run({ players: [{ character: "Kev Caron", level: 30 }] }), { neighbours: [{ runRef: "other", instanceId: 91, ...base, characters: ["Kev Smith"] }] })).toEqual([]);
    expect(codes(run({ players: [{ character: "Kev Caron", level: 30 }] }), { neighbours: [{ runRef: "other", instanceId: 91, ...base, characters: ["KEV CARON"] }] })).toEqual(["identity"]);
    const reloaded = run({ startedAt: NOW - 400, endedAt: NOW - 330, kills: [{ id: 1, at: NOW - 2000 }, { id: 2, at: NOW - 1000 }, { id: 3, at: NOW - 335 }] });
    expect(codes(reloaded)).toHaveLength(1);
  });

  it("case 6", () => {
    expect(codes(run(), { deviceRuns: [{ runRef: "other", instanceId: 91, startedAt: NOW - 3000, endedAt: NOW - 300, characters: [] }] })).toEqual(["device"]);
    expect(codes(run(), { deviceRuns: [{ runRef: "other", instanceId: 91, startedAt: NOW - 400, endedAt: NOW - 350, characters: [] }] })).toEqual([]);
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
  const make = (n: number, prev: string, over: Record<string, unknown> = {}, sign = true, n0 = nonce, key = sealKey) => {
    const run = { ...base, id: `QG-${n}`, ...over };
    const seal = { n, nonce: n0, prev };
    const canonical = canonicalText(run, seal);
    return { raw: { ...run, integrity: { seal: { ...seal, ...(sign ? { mac: sealMac(key, canonical) } : {}) } } }, canonical };
  };
  const entry = (item: { raw: unknown }, ref: string, over: Partial<BatchEntry> = {}): BatchEntry => ({ raw: item.raw, ref, endedAt: NOW - 300, kind: "first-hand", earlier: false, ...over });
  const context = (over: Partial<BatchContext> = {}): BatchContext => ({ deviceId: "d1", sealKey, secret, windowSec: 14 * 86400, clockSlackSec: 3600, deviceSince: null, requireSeal: false, ...over });
  const codes = (result: Map<string, { code: string }[]>, ref: string) => (result.get(ref) ?? []).map((flag) => flag.code);

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

  it("accepts a linked chain of signed records", () => {
    const first = make(1, NO_PREV), second = make(2, chainHash(first.canonical));
    expect([...verifyBatch([entry(first, "a"), entry(second, "b")], context()).keys()]).toEqual([]);
  });

  it("checks signatures", () => {
    const item = make(1, NO_PREV);
    const edited = { raw: { ...(item.raw as object), endedAt: NOW - 100 } };
    expect(codes(verifyBatch([entry(edited, "a")], context()), "a")).toContain("signature");
    expect(codes(verifyBatch([entry(item, "a")], context({ sealKey: deriveSealKey("other") })), "a")).toContain("signature");
    expect(codes(verifyBatch([entry(make(1, NO_PREV, {}, false), "a")], context()), "a")).toEqual(["signature"]);
  });

  it("checks challenges", () => {
    expect(codes(verifyBatch([entry(make(1, NO_PREV, {}, true, issueChallenge(secret, "d9", NOW - 3500)), "a")], context()), "a")).toContain("challenge");
    expect(codes(verifyBatch([entry(make(1, NO_PREV, {}, true, issueChallenge(secret, "d1", NOW + 5000)), "a")], context()), "a")).toContain("challenge");
    expect(codes(verifyBatch([entry(make(1, NO_PREV, {}, true, issueChallenge(secret, "d1", NOW + 600)), "a")], context()), "a")).toEqual([]);
    expect(codes(verifyBatch([entry(make(1, NO_PREV), "a")], context({ windowSec: 600 })), "a")).toContain("challenge");
    expect(codes(verifyBatch([entry(make(1, NO_PREV), "a")], context({ secret: null })), "a")).toEqual([]);
  });

  it("handles earlier runs and relayed records", () => {
    const old = make(1, NO_PREV, {}, true, issueChallenge(secret, "old-install", NOW - 90000));
    expect(codes(verifyBatch([entry(old, "a")], context({ deviceSince: NOW - 100 })), "a")).toEqual([]);
    const relayed = make(7, "f".repeat(64), {}, true, issueChallenge(secret, "someone-else", NOW - 3500), deriveSealKey("someone else"));
    const unsignedRelay = make(8, "f".repeat(64), {}, false, issueChallenge(secret, "someone-else", NOW - 3500));
    expect(codes(verifyBatch([entry(relayed, "a", { kind: "relay" })], context()), "a")).toEqual([]);
    expect(codes(verifyBatch([entry(unsignedRelay, "b", { kind: "relay" })], context()), "b")).toEqual([]);
  });

  it("checks chain links", () => {
    const first = make(1, NO_PREV);
    expect(codes(verifyBatch([entry(first, "a"), entry(make(2, "0".repeat(63) + "1"), "b")], context()), "b")).toEqual(["sequence"]);
    const other = make(1, NO_PREV, { id: "QG-other" });
    const next = make(2, chainHash(other.canonical), { id: "QG-next" });
    expect([...verifyBatch([entry(first, "a"), entry(other, "c"), entry(next, "b")], context()).keys()]).toEqual([]);
    expect(codes(verifyBatch([entry(make(3, NO_PREV), "a", { earlier: true })], context()), "a")).toEqual([]);
    expect(codes(verifyBatch([entry(make(9, NO_PREV), "a")], context()), "a")).toEqual([]);
  });

  it("handles a missing seal", () => {
    const plain = { raw: base };
    expect(codes(verifyBatch([entry(plain, "a")], context()), "a")).toEqual([]);
    expect(codes(verifyBatch([entry(plain, "a")], context({ requireSeal: true })), "a")).toEqual(["signature"]);
    expect(sealOf(null)).toBeNull();
    expect(sealOf({ integrity: { seal: { n: 0, nonce, prev: NO_PREV } } })).toBeNull();
  });
});

describe("two copies of one run that disagree", () => {
  const a = statement({ deviceId: "d1", voucher: "kev" });
  it("compares two statements", () => {
    expect(contradicts(a, statement({ deviceId: "d2", voucher: "bob" }), STRICT)).toBe(false);
    expect(contradicts(a, statement({ deviceId: "d2", voucher: "bob", bosses: [1, 2, 3] }), STRICT)).toBe(false);
    expect(contradicts(a, statement({ deviceId: "d2", voucher: "bob", bosses: [7, 8], endedAt: NOW - 300 + 400, startedAt: NOW - 3000 + 400 }), STRICT)).toBe(true);
  });
  it("compares unrelated statements", () => {
    expect(contradicts(a, statement({ deviceId: "d2", instanceId: 91, bosses: [5] }), STRICT)).toBe(false);
    expect(contradicts(a, statement({ deviceId: "d2", players: ["xed", "yan", "zed"], bosses: [1] }), STRICT)).toBe(false);
    expect(contradicts(a, statement({ deviceId: "d2", startedAt: NOW - 280, endedAt: NOW + 100, bosses: [3] }), STRICT)).toBe(false);
  });
});

describe("server configuration and holding a run", () => {
  it("config parsing", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(parseIntegrityConfig(undefined)).toBe(DEFAULT_CONFIG);
    expect(DEFAULT_CONFIG).toMatchObject({ limits: null, holdScore: Infinity, challengeWindowSec: null });
    expect(holdsRun(["a", "b", "c", "d"], DEFAULT_CONFIG, 50)).toBe(false);
    expect(plausibilityFlags({ instanceId: 90, startedAt: NOW - 3000, endedAt: NOW - 300, players: [{ character: "Kev", level: 99 }], kills: [] }, { runRef: "me" })).toEqual([]);
    expect(parseIntegrityConfig("{nope")).toBe(DEFAULT_CONFIG);
    expect(parseIntegrityConfig("{nope")).toBe(DEFAULT_CONFIG);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain("RUN_INTEGRITY_CONFIG");
    warn.mockRestore();
    const config = parseIntegrityConfig(JSON.stringify({ holdScore: 2, weights: { "signature": 5, bad: "x" }, limits: { minSecondsPerBoss: 45, levelCap: "x" }, requireSeal: true }));
    expect(config).toMatchObject({ holdScore: 2, weights: { "signature": 5 }, requireSeal: true, limits: { minSecondsPerBoss: 45 } });
    expect(config.limits).not.toHaveProperty("levelCap");
    expect(parseIntegrityConfig(JSON.stringify({ holdScore: -5 })).holdScore).toBe(Infinity);
  });

  it("environment settings", () => {
    expect(integrityConfig({ RUN_INTEGRITY_CONFIG: JSON.stringify({ holdScore: 9 }) } as never).holdScore).toBe(9);
    expect(challengeSecret({} as never)).toBeNull();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    expect(challengeSecret({ RUN_CHALLENGE_SECRET: "short" } as never)).toBeNull();
    expect(challengeSecret({ RUN_CHALLENGE_SECRET: "short" } as never)).toBeNull();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain("RUN_CHALLENGE_SECRET");
    expect(String(warn.mock.calls[0]![0])).not.toContain("short\"");
    warn.mockRestore();
    expect(challengeSecret({ RUN_CHALLENGE_SECRET: "a-long-enough-secret" } as never)).toBe("a-long-enough-secret");
  });

  it("decides whether to hold a run", () => {
    const config = parseIntegrityConfig(JSON.stringify({ defaultWeight: 1, holdScore: 3, deviceStrikes: 2, weights: { hard: 3 } }));
    expect(holdsRun([], config, 99)).toBe(false);
    expect(holdsRun(["a"], config, 0)).toBe(false);
    expect(holdsRun(["a", "b", "c"], config, 0)).toBe(true);
    expect(holdsRun(["hard"], config, 0)).toBe(true);
    expect(holdsRun(["a"], config, 2)).toBe(true);
  });
});

describe("the review list and device exclusion", () => {
  const ref = "QG-" + "x".repeat(60);
  const rows = [{ id: "r1", runRef: ref, dungeonName: "Gnomeregan", endedAt: new Date("2026-11-13T12:00:00Z"), witnessCount: 1, anomalies: [{ code: "profile", detail: "Kev above level 60" }], players: [{ character: "Kev" }] }];
  const database = (devices: string[] = ["abcdef1234567890", "ffff00001111aaaa"], excludedGuilds: string[] = []) => {
    const updated: Record<string, unknown>[] = [];
    return { updated, db: {
      dungeonRun: { findMany: async () => rows },
      dungeonRunWitness: { findMany: async (args: { where: { runId?: unknown } }) => args.where.runId ? [{ runId: "r1", deviceId: devices[0] }] : devices.map((deviceId) => ({ deviceId })) },
      companionDevice: { findUnique: async () => ({ excludedGuilds }), update: async (args: Record<string, unknown>) => { updated.push(args); return {}; } }
    } as never };
  };

  it("lists a flagged run with its full code, its flags, its PC code and its witness count, in French too", async () => {
    const { db } = database();
    const report = await anomalyReport(db, "g1");
    expect(report).toMatchObject([{ runRef: ref, device: deviceShortId("abcdef1234567890"), flags: [{ code: "profile" }], witnesses: 1 }]);
    expect(deviceShortId("abcdef1234567890")).toBe("34567890");
    const text = describeAnomalies(report);
    expect(text).toContain(ref);
    expect(text).toContain("Kev above level 60");
    expect(text).toContain("`/officer dungeon flagged`");
    expect(describeAnomalies([])).toMatch(/No dungeon run was flagged/);
    expect(describeAnomalies([], "fr")).toMatch(/signalé/);
    expect(describeHeld([{ runRef: ref, instanceId: 90, endedAt: null, device: "34567890", flags: [{ code: "x", detail: "d" }], firstSeenAt: new Date() }])).toContain(ref);
  });

  it("excludes and restores a PC for this server only, by the code, only when exactly one matches", async () => {
    const { db, updated } = database();
    expect(await setDeviceExcluded(db, "g1", deviceShortId("abcdef1234567890"), true)).toBe("abcdef1234567890");
    expect(updated[0]).toMatchObject({ where: { id: "abcdef1234567890" }, data: { excludedGuilds: ["g1"] } });
    const other = database(undefined, ["g1", "g2"]);
    expect(await setDeviceExcluded(other.db, "g1", deviceShortId("abcdef1234567890"), false)).toBe("abcdef1234567890");
    expect(other.updated[0]).toMatchObject({ data: { excludedGuilds: ["g2"] } });
    expect(await setDeviceExcluded(db, "g1", "nomatch1", true)).toBeNull();
    expect(await setDeviceExcluded(db, "g1", "ab", true)).toBeNull();
    const ambiguous = database(["aaaa1234", "bbbb1234"]);
    expect(await setDeviceExcluded(ambiguous.db, "g1", "1234", true)).toBeNull();
  });
});
