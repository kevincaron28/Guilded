/* eslint-disable @typescript-eslint/no-explicit-any -- an in-memory stand-in for the few Prisma calls the lane makes */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  recordGlobalDuels: vi.fn<(...args: unknown[]) => Promise<object>>(async () => ({ recorded: 1, confirmed: 0 }))
}));
vi.mock("../src/services/duel-global.js", async (original) => ({ ...(await original<typeof import("../src/services/duel-global.js")>()), recordGlobalDuels: mocks.recordGlobalDuels }));

import { applyCarriedRecords, CARRY_RECEIPT_PREFIX, CARRY_RECORD_MAX_JSON, ownCarrierKeys } from "../src/services/carried-records.js";
import { deviceFor, handleDeviceUpload, registerDevice, type DeviceRow, type DeviceStore } from "../src/services/companion-device.js";

const NOW = new Date("2026-12-10T12:00:00Z");
const at = Math.floor(new Date("2026-12-09T10:00:00Z").getTime() / 1000);
const ext = (over: Record<string, unknown> = {}) => ({ winner: "Aldric Stone", winnerRealm: "Kronos", loser: "Brenna Vale", loserRealm: "Kronos", at, reason: "knockout", side: "winner", ...over });
const record = (key: string, over: Record<string, unknown> = {}, author = "Aldric Stone") => ({ kind: "externalDuel", key, author, data: ext(over) });

function fakeDb(failCreateWith?: { code: string }) {
  const stored: { kind: string; key: string; authorKey: string; carrier: string; status: string; createdAt: Date }[] = [];
  const db: any = {
    carriedRecord: {
      count: async ({ where }: any) => stored.filter((row) => row.carrier === where.carrier && row.createdAt >= where.createdAt.gte).length,
      findUnique: async ({ where }: any) => stored.find((row) => row.kind === where.kind_authorKey_key.kind && row.authorKey === where.kind_authorKey_key.authorKey && row.key === where.kind_authorKey_key.key) ?? null,
      create: async ({ data }: any) => {
        if (failCreateWith && data.status === "applied") throw Object.assign(new Error("unique"), failCreateWith);
        if (stored.some((row) => row.kind === data.kind && row.authorKey === data.authorKey && row.key === data.key)) throw Object.assign(new Error("unique"), { code: "P2002" });
        stored.push({ ...data, createdAt: NOW }); return data;
      }
    },
    $transaction: async (run: (tx: unknown) => Promise<unknown>) => run(db)
  };
  return { db, stored };
}
const carrierOf = (name: string) => new Set([name.toLowerCase()]);
const run = (db: any, records: unknown[], carrier = "device:1", names = carrierOf("Carrier One")) => applyCarriedRecords(db, { carrier, carrierKeys: names, now: NOW, records });

describe("carried records", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("applies an outside duel as the reporting side's own statement, carried, and answers by key", async () => {
    const { db, stored } = fakeDb();
    const out = await run(db, [record("x1-aaaa")]);
    expect(out.receipts).toEqual([`${CARRY_RECEIPT_PREFIX}externalDuel:x1-aaaa`]);
    expect(out.applied).toBe(1);
    const call = mocks.recordGlobalDuels.mock.calls[0]!;
    expect(call[1]).toEqual({ reporterKey: "install:carried|device:1|aldric stone-kronos", carried: true });
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ authorKey: "aldric stone-kronos", status: "applied" });
  });

  it("takes only the duel fields: no guild text, zone or device-upload proofs from a carried record", async () => {
    const { db } = fakeDb();
    await run(db, [record("x2-aaaa", { winnerGuild: "Evil Guild", zone: "Elwynn", nonce: "abcdef0123456789", chain: "0123456789abcdef", seq: 4, evidence: { endAt: 1 } })]);
    const sent = (mocks.recordGlobalDuels.mock.calls[0]![2] as Record<string, unknown>[])[0]!;
    expect(Object.keys(sent).sort()).toEqual(["at", "durationSec", "loser", "loserRealm", "reason", "side", "winner", "winnerRealm"].filter((k) => k in sent).sort());
    expect(sent).not.toHaveProperty("winnerGuild");
    expect(sent).not.toHaveProperty("zone");
    expect(sent).not.toHaveProperty("chain");
  });

  it("refuses a forged author, counts it, and still answers so it is not sent again", async () => {
    const { db, stored } = fakeDb();
    const out = await run(db, [record("x3-aaaa", {}, "Mallory Fox")]);
    expect(mocks.recordGlobalDuels).not.toHaveBeenCalled();
    expect(out.applied).toBe(0);
    expect(out.receipts).toHaveLength(1);
    expect(stored[0]).toMatchObject({ status: "rejected" });
  });

  it("files a record under the author's name and realm: the same name on another realm is another player", async () => {
    const { db, stored } = fakeDb();
    await run(db, [record("x4-aaaa")]);
    await run(db, [record("x4-aaaa", { winnerRealm: "Mirage Raceway" })], "device:2", carrierOf("Other"));
    expect(mocks.recordGlobalDuels).toHaveBeenCalledTimes(2);
    expect(new Set(stored.map((row) => row.authorKey)).size).toBe(2);
    // The same player and key again is one record.
    const again = await run(db, [record("x4-aaaa")], "device:3", carrierOf("Third"));
    expect(mocks.recordGlobalDuels).toHaveBeenCalledTimes(2);
    expect(again.receipts).toHaveLength(1);
  });

  it("does not let one author's key squat another's", async () => {
    const { db } = fakeDb();
    const squat = { kind: "externalDuel", key: "k1-aaaa", author: "Brenna Vale", data: ext({ side: "loser" }) };
    await run(db, [squat], "device:9", carrierOf("Squatter"));
    await run(db, [record("k1-aaaa")]);
    expect(mocks.recordGlobalDuels).toHaveBeenCalledTimes(2);
  });

  it("leaves a kind it does not know unanswered, and no longer applies guild duels or milestones", async () => {
    const { db } = fakeDb();
    const out = await run(db, [{ kind: "mystery", key: "m1-aaaa", author: "Aldric Stone", data: {} }, { kind: "duel", key: "d1-aaaa", author: "Aldric Stone", data: {} }, { kind: "milestone", key: "ms-aaaa", author: "Aldric Stone", data: {} }]);
    expect(out.receipts).toEqual([]);
    expect(mocks.recordGlobalDuels).not.toHaveBeenCalled();
  });

  it("answers a record about the carrier's own character without applying it", async () => {
    const { db } = fakeDb();
    const out = await run(db, [record("x5-aaaa")], "device:1", carrierOf("Aldric Stone"));
    expect(mocks.recordGlobalDuels).not.toHaveBeenCalled();
    expect(out.receipts).toHaveLength(1);
  });

  it("never answers a receipt without a row: the carrier's own character leaves an 'own' row", async () => {
    const { db, stored } = fakeDb();
    const out = await run(db, [record("x5-bbbb")], "device:1", carrierOf("Aldric Stone"));
    expect(out.receipts).toHaveLength(1);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ authorKey: "aldric stone-kronos", status: "own" });
  });

  // 14 November 2026: an addon-only guildmate's record (carried by a signed-in officer whose snapshot lists the whole guild in `characters`) was answered and dropped.
  it("applies a guildmate's carried record: the carrier's own characters are its database characters, never the roster", async () => {
    const { db, stored } = fakeDb();
    const members: any = { character: { findMany: async ({ where }: any) => (where.memberId === "m1" ? [{ name: "Lebowski Highspirits" }] : []) } };
    const snapshot = { character: { name: "Lebowski Highspirits" }, alts: [], characters: [{ name: "Blunt Cruising" }, { name: "Lebowski Highspirits" }, { name: "Somebody Else" }] };
    const carrierKeys = await ownCarrierKeys(members, { memberId: "m1", character: snapshot.character, alts: snapshot.alts });
    expect([...carrierKeys].sort()).toEqual(["lebowski highspirits"]);
    const exact = { kind: "externalDuel", key: "1794698440-472978", author: "Blunt Cruising", data: { side: "winner", winner: "Blunt Cruising", loser: "Lebowski Highspirits", winnerRealm: "CAMWOWUS2Realm8PvP", loserRealm: "CAMWOWUS2Realm8PvP", at: 1794698440, reason: "knockout" } };
    const out = await applyCarriedRecords(db, { carrier: "member:u1", carrierKeys, records: [exact], now: new Date("2026-11-14T23:40:00Z") });
    expect(out).toMatchObject({ applied: 1, receipts: [`${CARRY_RECEIPT_PREFIX}externalDuel:1794698440-472978`] });
    expect(mocks.recordGlobalDuels).toHaveBeenCalledTimes(1);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ status: "applied", authorKey: "blunt cruising-camwowus2realm8pvp" });
    // ...and the carrier's own character as author is still its own business, with a row.
    const own = { ...exact, key: "1794698441-111111", author: "Lebowski Highspirits", data: { ...exact.data, side: "loser" } };
    await applyCarriedRecords(db, { carrier: "member:u1", carrierKeys, records: [own], now: new Date("2026-11-14T23:41:00Z") });
    expect(mocks.recordGlobalDuels).toHaveBeenCalledTimes(1);
    expect(stored.at(-1)).toMatchObject({ status: "own" });
  });

  // Guild-only Discord (14 November 2026): a carried duel between two unaffiliated players, handed to a guild member's companion, stays on the
  // public duel lane: no guild table is read or written, so no Discord card, board row or points can come from it in the carrier's guild.
  it("a carried duel between two strangers, uploaded by a guild member, touches only the carried-record and public duel lane", async () => {
    const { db } = fakeDb();
    const guarded: any = new Proxy(db, { get: (target, name) => { if (["carriedRecord", "$transaction"].includes(String(name))) return target[name]; throw new Error(`guild table touched: ${String(name)}`); } });
    const out = await applyCarriedRecords(guarded, { carrier: "member:officer1", carrierKeys: new Set(["guild officer"]), records: [record("1794698999-111111", { winner: "Aaa Stranger", loser: "Bbb Stranger" }, "Aaa Stranger")], now: NOW });
    expect(out.applied).toBe(1);
    const [tx, source] = mocks.recordGlobalDuels.mock.calls[0]! as [unknown, Record<string, unknown>];
    expect(tx).toBe(db);
    expect(source).toMatchObject({ carried: true });
    expect(source).not.toHaveProperty("guildId");
  });

  it("ownCarrierKeys adds the exported character and alts, survives odd entries and a failing read", async () => {
    const broken: any = { character: { findMany: () => Promise.reject(new Error("db down")) } };
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const keys = await ownCarrierKeys(broken, { memberId: "m1", character: { name: " Kev " }, alts: [{ name: "Alt One" }, { name: 5 }, null, undefined] });
    expect([...keys].sort()).toEqual(["alt one", "kev"]);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
    expect((await ownCarrierKeys(broken, { memberId: null, character: undefined })).size).toBe(0);
  });

  it("counts every record looked at against the carrier's day, refused ones too, and a record over the size limit is refused", async () => {
    vi.stubEnv("RUN_INTEGRITY_CONFIG", JSON.stringify({ carriedRecordsPerDay: 3 }));
    try {
      const { db, stored } = fakeDb();
      const big = { ...record("big-aaaa"), pad: "x".repeat(CARRY_RECORD_MAX_JSON) };
      const out = await run(db, [big, "junk", record("f1-aaaa", {}, "Mallory"), record("ok-aaaa"), record("ok-bbbb", { at: at + 600 })]);
      expect(stored.filter((row) => row.status === "rejected")).toHaveLength(3);
      expect(mocks.recordGlobalDuels).not.toHaveBeenCalled();
      expect(out.applied).toBe(0);
      // The next call the same day has no room left.
      const next = await run(db, [record("ok-cccc", { at: at + 900 })]);
      expect(next.receipts).toEqual([]);
    } finally { vi.unstubAllEnvs(); }
  });

  it("treats two carriers sending one record at once as one record", async () => {
    const { db } = fakeDb({ code: "P2002" });
    const out = await run(db, [record("race-aaaa")]);
    expect(out.applied).toBe(0);
    expect(out.receipts).toEqual([`${CARRY_RECEIPT_PREFIX}externalDuel:race-aaaa`]);
  });

  it("never throws on a failed apply and leaves that record unanswered", async () => {
    const { db } = fakeDb();
    mocks.recordGlobalDuels.mockRejectedValueOnce(new Error("database down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const out = await run(db, [record("e1-aaaa"), record("e2-aaaa", { at: at + 700 })]);
    spy.mockRestore();
    expect(out.receipts).toEqual([`${CARRY_RECEIPT_PREFIX}externalDuel:e2-aaaa`]);
  });
});

describe("the device upload wrapper", () => {
  function store() {
    const devices = new Map<string, DeviceRow & { tokenHash: string }>();
    const s: DeviceStore = {
      async create(tokenHash) { devices.set("d1", { id: "d1", tokenHash, guildId: null, chosenGuildId: null, claimedMemberId: null, revokedAt: null, uploads: 0 }); return { id: "d1" }; },
      async find(tokenHash) { return [...devices.values()].find((d) => d.tokenHash === tokenHash) ?? null; },
      async candidates() { return []; },
      async characterKeys() { return []; },
      async saveUpload() { /* not under test */ },
      async claim() { return false; },
      async importRuns(_guildId, runs) { return { stored: runs.length, skipped: 0 }; }
    };
    return s;
  }
  const body = (carriedRecords: unknown[]) => ({ guild: { name: "Nowhere", realm: "Realm" }, characters: [{ name: "Kev" }], carriedRecords });

  it("applies the carried records of a device with no matching server and answers their receipts", async () => {
    const s = store();
    const device = (await deviceFor(s, (await registerDevice(s)).deviceSecret))!;
    const applyCarried = vi.fn<(records: unknown[], carrier: { deviceId: string; names: string[] }) => Promise<string[]>>(async (records) => records.map((_, i) => `carry:externalDuel:k${i}`));
    const answer = await handleDeviceUpload(s, device, body([record("a1-aaaa"), record("a2-aaaa")]), { now: NOW, applyCarried });
    expect(answer.status).toBe("no-guild");
    expect(answer.carriedReceipts).toEqual(["carry:externalDuel:k0", "carry:externalDuel:k1"]);
    expect(applyCarried.mock.calls[0]![1]).toEqual({ deviceId: "d1", names: ["kev"] });
  });

  it("does nothing for a claimed device, and a failing apply does not fail the upload", async () => {
    const s = store();
    const device = (await deviceFor(s, (await registerDevice(s)).deviceSecret))!;
    const applyCarried = vi.fn(async () => ["carry:x"]);
    expect(await handleDeviceUpload(s, { ...device, claimedMemberId: "m" }, body([record("a3-aaaa")]), { now: NOW, applyCarried })).toEqual({ status: "claimed" });
    expect(applyCarried).not.toHaveBeenCalled();
    const failing = await handleDeviceUpload(s, device, body([record("a4-aaaa")]), { now: NOW, applyCarried: async () => { throw new Error("down"); } });
    expect(failing.carriedReceipts).toBeUndefined();
  });
});

describe("the signed upload answers", () => {
  it("lists the receipts in the duplicate (409) and wrong-server answers too, not only the applied one", () => {
    const source = readFileSync(new URL("../src/companion-api.ts", import.meta.url), "utf8");
    const answers = source.split(/\r?\n/).filter((line) => line.includes('skipped: "wrong-server"') || line.includes('"This export was already received"'));
    expect(answers.length).toBeGreaterThanOrEqual(3);
    for (const line of answers) expect(line).toContain("...carriedExtra");
  });
});

describe("more limits and the public reader", () => {
  it("refuses a record whose reporting side has no realm, and counts it", async () => {
    const { db, stored } = fakeDb();
    const out = await run(db, [record("nr-aaaa", { winnerRealm: "" })]);
    expect(mocks.recordGlobalDuels).not.toHaveBeenCalled();
    expect(out.applied).toBe(0);
    expect(stored[0]).toMatchObject({ status: "rejected" });
  });

  it("counts records of unknown kinds past the first few against the carrier's day", async () => {
    vi.stubEnv("RUN_INTEGRITY_CONFIG", JSON.stringify({ carriedRecordsPerDay: 3 }));
    try {
      const { db } = fakeDb();
      const unknown = Array.from({ length: 14 }, (_, i) => ({ kind: "mystery", key: `u${i}-aaaa`, author: "Aldric Stone", data: {} }));
      const out = await run(db, [...unknown, record("late-aaaa")]);
      expect(out.receipts).toEqual([]);
      expect(mocks.recordGlobalDuels).not.toHaveBeenCalled();
    } finally { vi.unstubAllEnvs(); }
  });

  it("the public duel reader never returns a held duel", async () => {
    const { prismaLeaderboardStore } = await import("../src/services/public-leaderboard.js");
    const row = (held: boolean) => ({ held, counted: true, winnerKey: "aldric-kronos", loserKey: "brenna-kronos", winnerName: "Aldric", loserName: "Brenna", winnerRealm: "Kronos", loserRealm: "Kronos", winnerClass: null, loserClass: null, winnerLevel: 30, loserLevel: 30,
      winnerGuild: null, loserGuild: null, winnerMemberId: null, loserMemberId: null, endedAt: NOW, reason: "knockout", zone: null, durationSec: 40, reports: [{ reporterCharacterKey: "aldric-kronos", deviceId: "d1", guildId: null }] });
    const rows = [row(false), row(true)];
    const database: any = {
      publicDuel: { findMany: async ({ where }: any) => rows.filter((r) => (where.counted === undefined || r.counted === where.counted) && (where.held === undefined || r.held === where.held)) },
      publicDuelExclusion: { findMany: async () => [] },
      guildSettings: { findMany: async () => [] },
      member: { findMany: async () => [] }
    };
    const out = await prismaLeaderboardStore(database).globalDuelRows!();
    expect(out).toHaveLength(1);
  });
});

describe("who the carrier is", () => {
  it("is keyed on the Discord id, so one person in two servers is one carrier", () => {
    const source = readFileSync(new URL("../src/companion-api.ts", import.meta.url), "utf8");
    expect(source).toContain("applyCarriedRecords(prisma, { carrier: `member:${access.actorId}`");
    expect(source).not.toMatch(/applyCarriedRecords\(prisma, \{ carrier: `member:\$\{access\.memberId/);
  });
});
