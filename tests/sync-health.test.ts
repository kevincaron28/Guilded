import { beforeEach, describe, expect, it, vi } from "vitest";
import { collectSyncIssues, describeSyncIssues, developerSummary, parseHealthHeader, recordHealthReport, resetSyncHealthCache, syncHealth } from "../src/services/sync-health.js";

const now = new Date("2026-11-15T12:00:00Z");
const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 3_600_000);

function fakeDb(over: Record<string, unknown[]> = {}) {
  const table = (name: string) => ({ findMany: vi.fn(async () => over[name] ?? []) });
  return { companionCredential: table("credentials"), companionDevice: table("devices"), dungeonRunPlayer: table("runPlayers"), duelResult: table("duels"),
    carriedRecord: table("carried"), dungeonRun: table("runs"), dungeonRunReceipt: table("receipts"), dungeonRunWitness: table("witnesses"), syncHealthReport: table("reports") } as never;
}

describe("sync health signals", () => {
  beforeEach(() => resetSyncHealthCache());

  it("flags a companion silent for a day while the member kept playing", async () => {
    const db = fakeDb({ credentials: [{ memberId: "m1", createdAt: hoursAgo(500), lastUsedAt: hoursAgo(30), member: { displayName: "Ana" } }], runPlayers: [{ memberId: "m1", run: { endedAt: hoursAgo(3) } }] });
    const issues = await collectSyncIssues(db, "g", now);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ signal: "silent", who: "Ana" });
    expect(issues[0]!.fix.en).toMatch(/open the companion/);
  });
  it("does not flag a silent companion whose member is not playing, or a fresh one", async () => {
    const quiet = fakeDb({ credentials: [{ memberId: "m1", createdAt: hoursAgo(500), lastUsedAt: hoursAgo(30), member: { displayName: "Ana" } }] });
    expect(await collectSyncIssues(quiet, "g", now)).toEqual([]);
    const fresh = fakeDb({ credentials: [{ memberId: "m1", createdAt: hoursAgo(500), lastUsedAt: hoursAgo(1), member: { displayName: "Ana" } }], duels: [{ winnerId: "m1", loserId: "x", endedAt: hoursAgo(0.5) }] });
    expect(await collectSyncIssues(fresh, "g", now)).toEqual([]);
  });
  it("flags a carried run whose own recorder never uploaded it", async () => {
    const db = fakeDb({ carried: [{ authorKey: "bob|realm", key: "1:QG-1-Bob@device:d", runKey: "1:QG-1-Bob" }],
      runs: [{ runRef: "QG-1-Bob", reporterNames: ["carol"], players: [{ character: "Bob", memberId: "m2", member: { displayName: "Bob D" } }] }] });
    const issues = await collectSyncIssues(db, "g", now);
    expect(issues).toMatchObject([{ signal: "carried-only", who: "Bob D" }]);
    const arrived = fakeDb({ carried: [{ authorKey: "bob|realm", key: "x", runKey: "1:QG-1-Bob" }], runs: [{ runRef: "QG-1-Bob", reporterNames: ["bob"], players: [{ character: "Bob", memberId: "m2", member: { displayName: "Bob D" } }] }] });
    expect(await collectSyncIssues(arrived, "g", now)).toEqual([]);
  });
  it("flags receipts refused again and again for one reason, not a single refusal", async () => {
    const row = (hours: number) => ({ reason: "run needs a newer addon version", createdAt: hoursAgo(hours + 10), seenAt: hoursAgo(hours) });
    const issues = await collectSyncIssues(fakeDb({ receipts: [row(1), row(2)] }), "g", now);
    expect(issues).toMatchObject([{ signal: "refused", who: null }]);
    expect(issues[0]!.fix.en).toMatch(/update/);
    expect(await collectSyncIssues(fakeDb({ receipts: [row(1)] }), "g", now)).toEqual([]);
    expect(await collectSyncIssues(fakeDb({ receipts: [{ reason: "x", createdAt: hoursAgo(2), seenAt: hoursAgo(1) }, { reason: "x", createdAt: hoursAgo(2), seenAt: hoursAgo(1) }] }), "g", now)).toEqual([]);
  });
  it("flags a PC that keeps retrying statements that stay undecided", async () => {
    const stuck = { deviceId: "device-12345678", firstSeenAt: hoursAgo(20), lastSeenAt: hoursAgo(1), device: { claimedMember: null } };
    const issues = await collectSyncIssues(fakeDb({ witnesses: [stuck, stuck] }), "g", now);
    expect(issues).toMatchObject([{ signal: "retrying", who: "PC 12345678" }]);
    expect(issues[0]!.detail).toContain("2 runs");
    expect(await collectSyncIssues(fakeDb({ witnesses: [{ ...stuck, firstSeenAt: hoursAgo(2) }] }), "g", now)).toEqual([]);
  });
  it("shows what a companion reports: parked records and a damaged file", async () => {
    const issues = await collectSyncIssues(fakeDb({ reports: [{ ownerKey: "device:abcdefghij", memberId: null, parked: 3, damaged: false }, { ownerKey: "member:m9", memberId: "m9", parked: 0, damaged: true }] }), "g", now);
    expect(issues.map((issue) => issue.signal)).toEqual(["parked", "parked"]);
    expect(issues[0]!.detail).toContain("3 records parked");
    expect(issues[1]!.fix.en).toMatch(/Repair/);
  });
});

describe("sync health cost and wording", () => {
  beforeEach(() => resetSyncHealthCache());
  it("asks the database once per server per hour", async () => {
    const db = fakeDb();
    const credentials = (db as unknown as { companionCredential: { findMany: ReturnType<typeof vi.fn> } }).companionCredential.findMany;
    await syncHealth(db, "g", now);
    await syncHealth(db, "g", new Date(now.getTime() + 30 * 60_000));
    expect(credentials).toHaveBeenCalledTimes(1);
    await syncHealth(db, "g", new Date(now.getTime() + 61 * 60_000));
    expect(credentials).toHaveBeenCalledTimes(2);
  });
  it("describes in both languages and summarises for the developer", () => {
    const issue = { signal: "silent" as const, who: "Ana", detail: "companion silent for 30 h", fix: { en: "Open it.", fr: "Ouvrez-le." } };
    expect(describeSyncIssues([issue], "en")).toContain("Open it.");
    expect(describeSyncIssues([issue], "fr")).toContain("Ouvrez-le.");
    expect(describeSyncIssues([], "en")).toMatch(/No sync problem/);
    expect(developerSummary([{ name: "QG", issues: [] }])).toBeNull();
    expect(developerSummary([{ name: "QG", issues: [issue] }])).toContain("1 silent");
  });
  it("parses the companion header and stores one report, skipping an unchanged one within the hour", async () => {
    expect(parseHealthHeader("parked=2;damaged=1")).toEqual({ parked: 2, damaged: true });
    expect(parseHealthHeader("parked=0")).toEqual({ parked: 0, damaged: false });
    expect(parseHealthHeader("nonsense")).toBeNull();
    expect(parseHealthHeader(undefined)).toBeNull();
    const upsert = vi.fn(async () => ({}));
    const findUnique = vi.fn(async () => null);
    const db = { syncHealthReport: { findUnique, upsert } } as never;
    await recordHealthReport(db, { guildId: "g", ownerKey: "device:d", memberId: null, header: "parked=2", now });
    expect(upsert).toHaveBeenCalledTimes(1);
    findUnique.mockResolvedValueOnce({ parked: 2, damaged: false, reportedAt: hoursAgo(0.2) } as never);
    await recordHealthReport(db, { guildId: "g", ownerKey: "device:d", memberId: null, header: "parked=2", now });
    expect(upsert).toHaveBeenCalledTimes(1);
  });
});
