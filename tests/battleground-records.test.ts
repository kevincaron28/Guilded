import { describe, expect, it, vi } from "vitest";
import type { Prisma, PrismaClient } from "../src/generated/prisma/client.js";
import { battlegroundReportSchema } from "../src/services/battleground-record-schema.js";
import { battlegroundHistory, battlegroundStats, correctBattlegroundReport, importBattlegroundReports, setBattlegroundConsent } from "../src/services/battleground-records.js";

const now = new Date("2026-11-05T12:00:00Z");
const report = { version: 1, reportId: "own-report-001", adapter: "forever-postmatch-v1", edition: "forever",
  character: "Player", realm: "Realm", realmType: "normal", mode: "casual", mapId: 489, bracket: "60",
  endedAt: now.getTime() / 1000 - 60, durationSeconds: 600, outcome: "win", presence: "complete",
  reloaded: false, postmatch: true, consent: true };
function fixture() {
  const records: Record<string, unknown>[] = [];
  const consent = { memberId: "m", guildId: "g", capture: true, guildStats: false, consentedAt: new Date("2026-11-04T00:00:00Z") };
  const tx = {
    $executeRaw: vi.fn(async () => 1),
    member: { findFirst: vi.fn(async (arg: { where: { id: string; guildId: string } }) => arg.where.id === "m" && arg.where.guildId === "g" ? { id: "m" } : null) },
    guild: { findUniqueOrThrow: vi.fn(async () => ({ gameEdition: "forever" })) },
    character: { findMany: vi.fn(async () => [{ id: "c", memberId: "m", guildId: "g", gameEdition: "forever", name: "Player", realm: "Realm" }]) },
    battlegroundConsent: {
      findUnique: vi.fn(async () => consent),
      upsert: vi.fn(async (arg: { update: object }) => Object.assign(consent, arg.update))
    },
    battlegroundReport: {
      count: vi.fn(async () => records.length),
      findUnique: vi.fn(async (arg: { where: { guildId_memberId_reportId: { reportId: string } } }) => records.find(r => r["reportId"] === arg.where.guildId_memberId_reportId.reportId) ?? null),
      findFirst: vi.fn(async (arg: { where: { guildId: string; memberId: string; OR: { id?: string; reportId?: string }[] } }) => records.find(r => r["guildId"] === arg.where.guildId && r["memberId"] === arg.where.memberId
        && arg.where.OR.some(k => k.id === r["id"] || k.reportId === r["reportId"])) ?? null),
      findMany: vi.fn(async (arg: { where: { premadeNonce?: string } }) => typeof arg.where.premadeNonce === "string"
        ? records.filter(r => r["premadeNonce"] === arg.where.premadeNonce && consent.capture).map(r => ({ ...r, member: { battlegroundConsent: consent } })) : records),
      groupBy: vi.fn(async () => consent.guildStats ? ["win", "loss", "draw", "unknown"].map(outcome => ({ outcome, _count: { _all: records.filter(r => r["status"] === "PROVISIONAL" && r["outcome"] === outcome).length } })) : []),
      create: vi.fn(async (arg: { data: Record<string, unknown> }) => { const row = { id: `id-${records.length}`, ...arg.data }; records.push(row); return row; }),
      update: vi.fn(async (arg: { where: { id: string }; data: object }) => Object.assign(records.find(r => r["id"] === arg.where.id)!, arg.data)),
      updateMany: vi.fn(async (arg: { where: { premadeNonce?: string; id?: { in: string[] } }; data: object }) => {
        for (const r of records.filter(r => arg.where.premadeNonce ? r["premadeNonce"] === arg.where.premadeNonce : arg.where.id?.in.includes(String(r["id"])))) Object.assign(r, arg.data);
        return { count: records.length };
      })
    }
  };
  const db = { ...tx, $transaction: async (fn: (value: typeof tx) => Promise<unknown>) => fn(tx) };
  return { tx: tx as unknown as Prisma.TransactionClient, db: db as unknown as PrismaClient, raw: tx, consent, records };
}

describe("BG private reporter ingestion", () => {
  it("rejects unauthenticated, nonconsenting, foreign-guild and other-character evidence", async () => {
    const f = fixture();
    expect((await importBattlegroundReports(f.tx, "g", null, [report], now)).rejected).toBe(1);
    expect(f.raw.battlegroundConsent.findUnique).not.toHaveBeenCalled();
    f.consent.capture = false;
    expect((await importBattlegroundReports(f.tx, "g", "m", [report], now)).rejected).toBe(1);
    f.consent.capture = true;
    await expect(importBattlegroundReports(f.tx, "other-guild", "m", [report], now)).rejects.toThrow("membership");
    expect((await importBattlegroundReports(f.tx, "g", "m", [{ ...report, character: "SomeoneElse" }], now)).rejected).toBe(1);
    expect(f.records).toHaveLength(0);
  });
  it("does not accept preconsent, future, Hardcore or opponent roster payloads", async () => {
    const f = fixture();
    const rows = [{ ...report, endedAt: 1 }, { ...report, endedAt: now.getTime() / 1000 + 600 },
      { ...report, realmType: "hardcore" }, { ...report, opponents: ["private"] }, { ...report, postmatch: false }];
    expect((await importBattlegroundReports(f.tx, "g", "m", rows, now)).rejected).toBe(rows.length);
    expect(f.records).toHaveLength(0);
  });
  it("deduplicates exact replays and marks changed evidence conflicted without replacing the original", async () => {
    const f = fixture();
    expect((await importBattlegroundReports(f.tx, "g", "m", [report], now)).recorded).toBe(1);
    expect(f.records[0]?.["status"]).toBe("PROVISIONAL");
    expect((await importBattlegroundReports(f.tx, "g", "m", [report], now)).duplicates).toBe(1);
    expect((await importBattlegroundReports(f.tx, "g", "m", [{ ...report, outcome: "loss" }], now)).conflicts).toBe(1);
    expect(f.records).toHaveLength(1); expect(f.records[0]?.["outcome"]).toBe("win");
    expect(f.records[0]?.["status"]).toBe("CONFLICT");
    expect(f.records[0]?.["conflictSummary"]).toContain("outcome: win → loss");
    expect(f.raw.$executeRaw).toHaveBeenCalled();
  });
  it("never merges distinct reporter IDs by matching map/time or premade nonce", async () => {
    const f = fixture();
    const same = { ...report, premadeNonce: "premade-123" };
    await importBattlegroundReports(f.tx, "g", "m", [same, { ...same, reportId: "own-report-002" }], now);
    expect(f.records).toHaveLength(2);
    expect(f.records.every(r => r["status"] === "CONFLICT")).toBe(true);
  });
  it("withdraws only an owned report and replay cannot restore it", async () => {
    const f = fixture(); await importBattlegroundReports(f.tx, "g", "m", [report], now);
    await expect(correctBattlegroundReport(f.db, "g", "m", "foreign-report", "Wrong result")).rejects.toThrow("introuvable");
    await correctBattlegroundReport(f.db, "g", "m", report.reportId, "Wrong result");
    await importBattlegroundReports(f.tx, "g", "m", [report, { ...report, outcome: "loss" }], now);
    expect(f.records[0]?.["status"]).toBe("WITHDRAWN");
    expect(f.records[0]?.["correctionReason"]).toBe("Wrong result");
  });
  it("requires fresh consent for new capture after pause and scopes private history", async () => {
    const f = fixture();
    await expect(setBattlegroundConsent(f.db, "g", "m", { capture: false, guildStats: true })).rejects.toThrow("Enable capture");
    await setBattlegroundConsent(f.db, "g", "m", { capture: false, guildStats: false }, now);
    await setBattlegroundConsent(f.db, "g", "m", { capture: true, guildStats: false }, now);
    expect((await importBattlegroundReports(f.tx, "g", "m", [report], now)).rejected).toBe(1);
    await battlegroundHistory(f.db, "g", "m", report.reportId);
    expect(f.raw.battlegroundReport.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {
      guildId: "g", memberId: "m", OR: [{ id: report.reportId }, { reportId: report.reportId }] }, take: 1 }));
  });
  it("separates provisional evidence from verified stats and requires edition/season scope", async () => {
    const f = fixture(); await importBattlegroundReports(f.tx, "g", "m", [report], now);
    const scope = { edition: "forever", startsAt: new Date("2026-11-04T00:00:00Z"), endsAt: now, mode: "casual", bracket: "60" };
    expect((await battlegroundStats(f.db, "g", scope)).participations).toBe(0);
    f.consent.guildStats = true;
    const stats = await battlegroundStats(f.db, "g", scope);
    expect(stats).toMatchObject({ matches: 0, verifiedMatches: null, wins: 1, winRate: 1, provisionalReports: 1, knownOutcomes: 1 });
    expect(f.raw.battlegroundReport.groupBy).toHaveBeenLastCalledWith(expect.objectContaining({ where: expect.objectContaining({ guildId: "g", gameEdition: "forever", mode: "casual", bracket: "60",
      member: { guildId: "g", status: "ACTIVE", battlegroundConsent: { is: { guildId: "g", capture: true, guildStats: true } } } }) }));
    await correctBattlegroundReport(f.db, "g", "m", report.reportId, "Incorrect");
    expect((await battlegroundStats(f.db, "g", scope)).participations).toBe(0);
    await expect(battlegroundStats(f.db, "g", { ...scope, edition: "retail" })).rejects.toThrow("scope");
  });
  it("does not accept an invented verified adapter or secret payload fields", () => {
    expect(battlegroundReportSchema.safeParse({ ...report, adapter: "verified-retail" }).success).toBe(false);
    expect(battlegroundReportSchema.safeParse({ ...report, damage: 1234 }).success).toBe(false);
  });
});
