import { describe, expect, it, vi } from "vitest";
import { DEVICE_LIMITS, deviceFor, handleDeviceUpload, registerDevice, runsOfDevice, storeDeviceRuns, type DeviceRow, type DeviceStore, type ServerCandidate } from "../src/services/companion-device.js";
import { witnessTables } from "./helpers/witness-tables.js";
import { provisionalSeasonRules } from "../src/services/dungeon-bracket-season.js";
import { NO_PREV, canonicalText, chainHash, deriveSealKey, issueChallenge, sealMac } from "../src/services/run-challenge.js";
import { dungeonRating } from "../src/services/dungeon-rating.js";

// Zero-setup companion: dungeon runs from an unsigned device are stored like any run and count on the guild board.

const SRC = { deviceId: "d1", characterKeys: ["kev"] };
const season = { id: "s1", startsAt: new Date("2026-11-04T23:00:00Z"), endsAt: null, status: "ACTIVE", name: "Season 1", ratingRules: provisionalSeasonRules().rules };
const start = Math.floor(new Date("2026-11-08T20:00:00Z").getTime() / 1000);
const now = new Date("2026-11-09T12:00:00Z");
const run = (id: string, over: Record<string, unknown> = {}) => ({ id, protocolVersion: 1, state: "COMPLETED", instanceId: 90, name: "Gnomeregan", difficultyId: 0,
  startedAt: start, endedAt: start + 2700, reporters: 1, completedBy: "final boss", encounters: [],
  players: ["Kev", "Bob", "Amy"].map((character) => ({ character, realm: "Forever", deaths: 0, presentSec: 2700, inGuild: true, level: 30, minLevel: 30 })), ...over });

function fakeTx(initial: Record<string, unknown>[] = [], characters: unknown[] = [], roster: string[] = ["kev"], seasons: number[] = [1], excluded: string[] = []) {
  const runs = [...initial];
  const trust = witnessTables(roster, seasons, excluded);
  const tx = {
    guild: { findUnique: async () => ({ gameEdition: "forever" }) },
    character: { findMany: async () => characters },
    guildSettings: { findUnique: async () => ({ dungeonLeaderboardChannelId: null }) },
    dungeonSeason: { findFirst: async () => season, create: async () => season, update: vi.fn() },
    dungeonRun: {
      aggregate: async () => ({ _min: { durationSec: null }, _count: { _all: 0 } }),
      findUnique: async ({ where }: { where: { guildId_runRef: { runRef: string } } }) => runs.find((r) => r["runRef"] === where.guildId_runRef.runRef) ?? null,
      findMany: async ({ where }: { where: { runRef?: { in: string[] }; instanceId?: number; valid?: boolean; state?: string; completedBy?: string } }) => runs.filter((r) =>
        (!where.runRef || where.runRef.in.includes(r["runRef"] as string)) && (where.instanceId === undefined || r["instanceId"] === where.instanceId)
        && (where.valid === undefined || r["valid"] === where.valid) && (where.state === undefined || r["state"] === where.state)
        && (where.completedBy === undefined || r["completedBy"] === where.completedBy)),
      updateMany: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => { const hit = runs.find((r) => r["id"] === where.id); if (hit) Object.assign(hit, data); return { count: hit ? 1 : 0 }; },
      create: async ({ data }: { data: Record<string, unknown> & { players: { create: { character: string; memberId: string | null }[] } } }) => {
        const row = { ...data, id: `run-${runs.length + 1}`, players: data.players.create.map((p) => ({ ...p, member: null })) };
        runs.push(row);
        return row;
      }
    },
    ...trust.tables,
    dungeonAchievement: { findMany: async () => [], create: async () => ({}) },
    dungeonPointTransaction: { create: async ({ data }: { data: unknown }) => data }
  };
  return { tx: tx as never, runs, witnesses: trust.witnesses, heads: trust.heads };
}

describe("runs an unsigned device sends", () => {
  it("only keeps runs a character of this device was in", () => {
    const own = new Set(["kev"]);
    expect(runsOfDevice([run("a"), run("b", { players: [{ character: "Zed", realm: "", presentSec: 1, inGuild: true }] }), null, { id: "c" }], own)).toHaveLength(1);
  });

  it("stores the run and it counts on the guild board for an in-guild reported character", async () => {
    const { tx, runs } = fakeTx();
    expect(await storeDeviceRuns(tx, "g1", [run("QG-1")], now, SRC)).toEqual({ stored: 1, skipped: 0 });
    expect(runs).toHaveLength(1);
    const rows = await dungeonRating(tx, "g1", season);
    expect(rows.find((row) => row.character === "Kev")?.points).toBeGreaterThan(0);
  });

  it("links a character a member already has, and keeps the integrity rules (manual end, too short)", async () => {
    const { tx, runs } = fakeTx([], [{ name: "Kev", realm: "", memberId: "m-kev", spec: null, displayName: null, member: { discordUserId: "1" } }]);
    await storeDeviceRuns(tx, "g1", [run("run-ok"), run("manual", { completedBy: undefined, endReason: "manual", startedAt: start + 9000, endedAt: start + 11700 }), run("short", { startedAt: start + 20000, endedAt: start + 20020 })], now, SRC);
    const players = (id: string) => (runs.find((r) => r["runRef"] === id)?.["players"] as { character: string; memberId: string | null }[] | undefined);
    expect(players("run-ok")?.find((p) => p.character === "Kev")?.memberId).toBe("m-kev");
    expect(runs.find((r) => r["runRef"] === "short")).toMatchObject({ valid: false });
  });

  it("never touches a run the server already stores, and a second upload adds nothing", async () => {
    const confirmed = { id: "run-0", runRef: "QG-1", valid: true, state: "COMPLETED", completedBy: "final boss", instanceId: 90, players: [] };
    const { tx, runs } = fakeTx([confirmed]);
    expect(await storeDeviceRuns(tx, "g1", [run("QG-1", { endedAt: start + 3000 })], now, SRC)).toEqual({ stored: 0, skipped: 1 });
    expect(runs).toEqual([confirmed]);
    expect(await storeDeviceRuns(tx, "g1", [run("QG-2")], now, SRC)).toMatchObject({ stored: 1 });
    expect(await storeDeviceRuns(tx, "g1", [run("QG-2")], now, SRC)).toEqual({ stored: 0, skipped: 1 });
    expect(runs).toHaveLength(2);
  });
});

describe("device upload with runs", () => {
  const quebec: ServerCandidate = { guildId: "g1", discordId: "111111111", serverName: "Quebec Gold", officerLinked: true };
  function store() {
    const devices = new Map<string, DeviceRow & { tokenHash: string }>();
    const imported: unknown[][] = [];
    const s: DeviceStore = {
      async create(tokenHash) { devices.set("d1", { id: "d1", tokenHash, guildId: null, chosenGuildId: null, claimedMemberId: null, revokedAt: null, uploads: 0 }); return { id: "d1" }; },
      async find(tokenHash) { return [...devices.values()].find((d) => d.tokenHash === tokenHash) ?? null; },
      async candidates() { return [quebec]; },
      async characterKeys() { return []; },
      async saveUpload() { /* characters are covered by companion-device.test.ts */ },
      async claim() { return false; },
      async importRuns(_guildId, runs) { imported.push(runs); return { stored: runs.length, skipped: 0 }; }
    };
    return { s, imported };
  }
  const body = (runs: unknown[]) => ({ guild: { name: "Quebec Gold", realm: "Realm" }, characters: [{ name: "Kev" }], dungeonRuns: runs });

  it("sends the device's runs for import and says how many were stored", async () => {
    const { s, imported } = store();
    const device = (await deviceFor(s, (await registerDevice(s)).deviceSecret))!;
    const answer = await handleDeviceUpload(s, device, body([run("a"), run("b", { players: [{ character: "Zed", realm: "", presentSec: 1, inGuild: true }] })]), { now });
    expect(answer).toMatchObject({ status: "synced", runs: { received: 2, stored: 1, skipped: 0 } });
    expect(imported[0]).toHaveLength(1);
  });

  it("does not import for a claimed device or more than the per-upload cap", async () => {
    const { s, imported } = store();
    const device = (await deviceFor(s, (await registerDevice(s)).deviceSecret))!;
    expect(await handleDeviceUpload(s, { ...device, claimedMemberId: "m" }, body([run("a")]))).toEqual({ status: "claimed" });
    await expect(handleDeviceUpload(s, device, body(Array.from({ length: DEVICE_LIMITS.runsPerUpload + 1 }, (_, i) => run(`r${i}`))))).rejects.toThrow();
    expect(imported).toHaveLength(0);
  });

  it("stops at the per-device hourly run limit", async () => {
    const { s, imported } = store();
    const device = (await deviceFor(s, (await registerDevice(s)).deviceSecret))!;
    let left = 2;
    await handleDeviceUpload(s, device, body([run("a"), run("b"), run("c")]), { now, runLimiter: () => left-- > 0 });
    expect(imported[0]).toHaveLength(2);
  });
});

describe("run trust: one witness is enough (docs/plans/SINGLE_WITNESS_2026-11-13.md; before 13 November a second statement was needed from Season 2)", () => {
  const two = { deviceId: "d2", characterKeys: ["bob"] };
  const trustOf = (runs: Record<string, unknown>[]) => runs.map((r) => [r["runRef"], r["trust"]]);

  it("stores a run nobody in the party is known for, from Season 2 on too: one witness is enough", async () => {
    const { tx, runs, witnesses } = fakeTx([], [], [], [1, 2]);
    expect(await storeDeviceRuns(tx, "g1", [run("QG-1")], now, SRC)).toEqual({ stored: 1, skipped: 0 });
    expect(trustOf(runs)).toEqual([["QG-1", "device"]]);
    expect(witnesses).toMatchObject([{ status: "stored", voucher: "kev", trust: "device" }]);
  });

  it("a second device speaking for another party member only adds to it: witnessed, confirmed by 2, nothing stored twice", async () => {
    const { tx, runs } = fakeTx([], [], [], [1, 2]);
    await storeDeviceRuns(tx, "g1", [run("QG-1")], now, SRC);
    const later = new Date(now.getTime() + 60_000);
    expect(await storeDeviceRuns(tx, "g1", [run("QG-OTHER-ID", { startedAt: start + 30, endedAt: start + 2710 })], later, two)).toEqual({ stored: 0, skipped: 1 });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ runRef: "QG-1", trust: "witnessed", witnessCount: 2 });
  });

  it("never lets one device witness itself, and a replay changes nothing", async () => {
    const { tx, runs } = fakeTx([], [], [], [1, 2]);
    await storeDeviceRuns(tx, "g1", [run("QG-1")], now, SRC);
    expect(await storeDeviceRuns(tx, "g1", [run("QG-1b")], now, { deviceId: "d1", characterKeys: ["kev", "bob"] })).toMatchObject({ stored: 0 });
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ trust: "device" });
    expect(runs[0]!["witnessCount"]).toBeUndefined();
  });

  it("does not count two devices that rest on the same party member, and a different clear is a different run", async () => {
    const { tx, runs } = fakeTx([], [], [], [1, 2]);
    await storeDeviceRuns(tx, "g1", [run("QG-1")], now, SRC);
    expect(await storeDeviceRuns(tx, "g1", [run("QG-2")], now, { deviceId: "d2", characterKeys: ["kev"] })).toMatchObject({ stored: 0 });
    expect(runs[0]).toMatchObject({ trust: "device" });
    expect(await storeDeviceRuns(tx, "g1", [run("QG-3", { startedAt: start + 9000, endedAt: start + 11700 })], now, two)).toMatchObject({ stored: 1 });
    expect(runs).toHaveLength(2);
  });

  it("refuses everything from an excluded PC, with the reason, and stores nothing", async () => {
    const { tx, runs } = fakeTx([], [], ["kev"], [1], ["d1"]);
    expect(await storeDeviceRuns(tx, "g1", [run("QG-1"), run("QG-2", { startedAt: start + 9000, endedAt: start + 11700 })], now, SRC)).toEqual({ stored: 0, skipped: 2 });
    expect(runs).toHaveLength(0);
  });

  it("flags a run that looks unlikely but still stores and counts it (a level above the cap, kills before the run began)", async () => {
    const { tx, runs } = fakeTx([], [], ["kev"], [1, 2]);
    const odd = run("QG-ODD", { encounters: [{ id: 1, success: true, kind: "boss", at: start - 5000 }],
      players: ["Kev", "Bob", "Amy"].map((character) => ({ character, realm: "Forever", deaths: 0, presentSec: 2700, inGuild: true, level: 70, minLevel: 70 })) });
    expect(await storeDeviceRuns(tx, "g1", [odd], now, SRC)).toMatchObject({ stored: 1 });
    expect((runs[0]!["anomalies"] as { code: string }[]).map((flag) => flag.code).sort()).toEqual(["kill-outside-run", "level-above-cap"]);
    const clean = fakeTx([], [], ["kev"], [1, 2]);
    await storeDeviceRuns(clean.tx, "g1", [run("QG-OK")], now, SRC);
    expect(clean.runs[0]!["anomalies"]).toBeUndefined();
  });

  it("holds a run that trips several checks, tells the member nothing, and counts it once an officer releases it", async () => {
    process.env["RUN_INTEGRITY_CONFIG"] = JSON.stringify({ holdScore: 2 });
    try {
      const { tx, runs, witnesses } = fakeTx([], [], ["kev"], [1, 2]);
      const odd = run("QG-ODD", { encounters: [{ id: 1, success: true, kind: "boss", at: start - 5000 }],
        players: ["Kev", "Bob", "Amy"].map((character) => ({ character, realm: "Forever", deaths: 0, presentSec: 2700, inGuild: true, level: 70, minLevel: 70 })) });
      expect(await storeDeviceRuns(tx, "g1", [odd], now, SRC)).toEqual({ stored: 0, skipped: 0 });
      expect(runs).toHaveLength(0);
      expect(witnesses).toMatchObject([{ runRef: "QG-ODD", status: "held", flags: expect.arrayContaining([expect.objectContaining({ code: "level-above-cap" })]) }]);
      expect(await storeDeviceRuns(tx, "g1", [odd], now, SRC)).toEqual({ stored: 0, skipped: 0 }); // resent: still silent
      witnesses[0]!["status"] = "pending"; witnesses[0]!["reason"] = "released"; // /officer dungeon flagged run:...
      expect(await storeDeviceRuns(tx, "g1", [odd], now, SRC)).toMatchObject({ stored: 1 });
      expect(runs).toHaveLength(1);
    } finally { delete process.env["RUN_INTEGRITY_CONFIG"]; }
  });

  it("holds a single soft flag from a PC that already has several held runs, and reports it from a clean PC", async () => {
    process.env["RUN_INTEGRITY_CONFIG"] = JSON.stringify({ holdScore: 5, deviceStrikes: 2 });
    try {
      const one = run("QG-ONE", { players: ["Kev", "Bob", "Amy"].map((character) => ({ character, realm: "Forever", deaths: 0, presentSec: 2700, inGuild: true, level: 70, minLevel: 70 })) });
      const clean = fakeTx([], [], ["kev"], [1, 2]);
      expect(await storeDeviceRuns(clean.tx, "g1", [one], now, SRC)).toMatchObject({ stored: 1 });
      const struck = fakeTx([], [], ["kev"], [1, 2]);
      for (const ref of ["H1", "H2"]) struck.witnesses.push({ deviceId: "d1", status: "held", runRef: ref, firstSeenAt: now });
      expect(await storeDeviceRuns(struck.tx, "g1", [one], now, SRC)).toEqual({ stored: 0, skipped: 0 });
      expect(struck.runs).toHaveLength(0);
    } finally { delete process.env["RUN_INTEGRITY_CONFIG"]; }
  });

  it("checks signed records against the device key and the server's challenge, and moves the chain head", async () => {
    const secret = "server-secret-0123456789";
    process.env["RUN_CHALLENGE_SECRET"] = secret;
    process.env["RUN_INTEGRITY_CONFIG"] = JSON.stringify({ holdScore: 2, weights: { "seal-invalid": 2 } });
    try {
      const sealKey = deriveSealKey("device-key-abc");
      const nonce = issueChallenge(secret, "d1", start - 600);
      const sealed = (id: string, n: number, prev: string, key: string) => {
        const record = run(id);
        const seal = { n, nonce, prev };
        return { record: { ...record, integrity: { seal: { ...seal, mac: sealMac(key, canonicalText(record, seal)) } } }, canonical: canonicalText(record, seal) };
      };
      const good = fakeTx([], [], ["kev"], [1, 2]);
      const first = sealed("QG-S1", 1, NO_PREV, sealKey);
      expect(await storeDeviceRuns(good.tx, "g1", [first.record], now, { ...SRC, sealKey })).toMatchObject({ stored: 1 });
      expect(good.heads.get("d1")).toEqual({ n: 1, hash: chainHash(first.canonical) });
      const bad = fakeTx([], [], ["kev"], [1, 2]);
      expect(await storeDeviceRuns(bad.tx, "g1", [sealed("QG-S2", 1, NO_PREV, deriveSealKey("another key")).record], now, { ...SRC, sealKey })).toEqual({ stored: 0, skipped: 0 });
      expect(bad.witnesses).toMatchObject([{ status: "held", flags: [expect.objectContaining({ code: "seal-invalid" })] }]);
    } finally { delete process.env["RUN_INTEGRITY_CONFIG"]; delete process.env["RUN_CHALLENGE_SECRET"]; }
  });

  it("takes a run a guildmate's addon relayed when a party member is in the officer-synced roster", async () => {
    const { tx, runs } = fakeTx([], [], ["amy"]);
    const relayed = run("QG-R", { reporterNames: ["Amy"], players: ["Zed", "Amy", "Bob"].map((character) => ({ character, realm: "Forever", deaths: 0, presentSec: 2700, inGuild: true, level: 30, minLevel: 30 })) });
    expect(await storeDeviceRuns(tx, "g1", [relayed], now, SRC)).toMatchObject({ stored: 1 });
    expect(trustOf(runs)).toEqual([["QG-R", "device"]]);
  });

  it("holds a device to a daily limit on runs it vouches for alone", async () => {
    const { tx, runs, witnesses } = fakeTx([], [], ["kev"]);
    for (let i = 0; i < 20; i++) witnesses.push({ deviceId: "d1", status: "stored", trust: "device", decidedAt: now });
    expect(await storeDeviceRuns(tx, "g1", [run("QG-X")], now, SRC)).toMatchObject({ stored: 0, pending: { "QG-X": expect.stringContaining("Daily limit") } });
    expect(runs).toHaveLength(0);
  });

  it("answers a waiting run apart from the receipts, so the addon never marks it synced", async () => {
    const rows: DeviceRow[] = [];
    const s: DeviceStore = {
      async create() { return { id: "d1" }; }, async find() { return rows[0] ?? null; },
      async candidates() { return [{ guildId: "g1", discordId: "111111111", serverName: "Quebec Gold", officerLinked: true }]; },
      async characterKeys() { return []; }, async saveUpload() { /* not under test */ }, async claim() { return false; },
      async importRuns() { return { stored: 0, skipped: 0, pending: { a: "Waiting for a second player's addon to confirm it" } }; },
      async receipts() { return []; }
    };
    const device: DeviceRow = { id: "d1", guildId: null, chosenGuildId: null, claimedMemberId: null, revokedAt: null, uploads: 0 };
    const answer = await handleDeviceUpload(s, device, { guild: { name: "Quebec Gold", realm: "R" }, characters: [{ name: "Kev" }], dungeonRuns: [run("a")] }, { now });
    expect(answer).toMatchObject({ status: "synced", runs: { pending: 1 }, runReceipts: { acceptedRunRefs: [], pendingRunNotes: { a: expect.any(String) } } });
  });
});

describe("Season 1: runs only anonymous devices vouch for still count (owner decision, 10 Nov 2026)", () => {
  it("stores a single-source run with nobody known in the party, marked device, with a receipt", async () => {
    const { tx, runs } = fakeTx([], [], [], [1]);
    expect(await storeDeviceRuns(tx, "g1", [run("QG-1")], now, SRC)).toMatchObject({ stored: 1 });
    expect(runs.map((r) => [r["runRef"], r["trust"]])).toEqual([["QG-1", "device"]]);
  });

  it("keeps the daily cap, and never changes a stored run", async () => {
    const { tx, runs, witnesses } = fakeTx([], [], [], [1]);
    for (let i = 0; i < 20; i++) witnesses.push({ deviceId: "d1", status: "stored", trust: "device", decidedAt: now });
    expect(await storeDeviceRuns(tx, "g1", [run("QG-X")], now, SRC)).toMatchObject({ stored: 0, pending: { "QG-X": expect.stringContaining("Daily limit") } });
    expect(runs).toHaveLength(0);
  });

  it("a run that waited for a second statement before 13 November is stored on the device's next upload", async () => {
    const shared = fakeTx([], [], [], [1, 2]);
    shared.witnesses.push({ guildId: "g1", runRef: "QG-1", deviceId: "d1", kind: "first-hand", voucher: "kev", instanceId: 90, difficultyId: 0, status: "pending", reason: "Waiting for a second player's addon to confirm it",
      startedAt: new Date(start * 1000), endedAt: new Date((start + 2700) * 1000), players: ["amy", "bob", "kev"], bosses: [], payload: null, firstSeenAt: now });
    // The companion resends a waiting run on every upload.
    expect(await storeDeviceRuns(shared.tx, "g1", [run("QG-1")], now, SRC)).toMatchObject({ stored: 1 });
  });
});
