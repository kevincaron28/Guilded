import { describe, expect, it, vi } from "vitest";
import { parseAddonSnapshot } from "../src/integrations/addon.js";
import { createAddonImportService } from "../src/services/addon-import.js";
import { excludeHistoryBeforeReset } from "../src/services/import-reset.js";

const report = { version: 1, reportId: "self-report-001", adapter: "forever-postmatch-v1", edition: "forever",
  character: "Player", realm: "Forever", realmType: "normal", mode: "casual", mapId: 489, bracket: "60",
  endedAt: Date.parse("2026-11-05T12:00:00Z") / 1000, durationSeconds: 600, outcome: "win", presence: "complete",
  reloaded: false, postmatch: true, consent: true };
const payload = (rows: unknown[]) => ({ source: "Guilded", gameEdition: "forever", exportedAt: "2026-11-05T12:01:00Z", battlegroundReports: rows });
describe("BG staging and retained-data privacy", () => {
  it("drops malformed/private roster fields individually without blocking valid sections", () => {
    const parsed = parseAddonSnapshot(payload([report, { ...report, opponents: ["Secret opponent"] }]));
    expect(parsed.battlegroundReports).toHaveLength(1);
    expect(parsed.rejected).toHaveLength(1);
    expect(JSON.stringify(parsed)).not.toContain("Secret opponent");
    expect(excludeHistoryBeforeReset(parsed, new Date("2026-11-06T00:00:00Z")).battlegroundReports).toHaveLength(0);
  });
  it("retains no BG staging data for officer imports or missing server consent", async () => {
    const create = vi.fn(async () => ({}));
    const consent = { capture: false, guildId: "g", consentedAt: new Date("2026-11-04T00:00:00Z") };
    const db = { addonImport: { create }, battlegroundConsent: { findUnique: vi.fn(async () => consent) },
      member: { findFirst: vi.fn(async () => ({ id: "paired-member" })) }, $executeRaw: vi.fn(async () => 1),
      $transaction: async (fn: (tx: unknown) => Promise<unknown>): Promise<unknown> => fn(db) };
    const service = createAddonImportService(db as never), snapshot = parseAddonSnapshot(payload([report]));
    await service.record("g", snapshot, "checksum", "officer");
    expect(create).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ payload: expect.objectContaining({ battlegroundReports: [] }) }) }));
    await service.record("g", snapshot, "checksum", "actor", "paired-member");
    expect(create).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ payload: expect.objectContaining({ battlegroundReports: [] }) }) }));
  });
  it("only stages owned characters after explicit consent in the paired guild", async () => {
    const create = vi.fn(async () => ({}));
    const consent = { capture: true, guildId: "g", consentedAt: new Date("2026-11-04T00:00:00Z") };
    const db = { addonImport: { create }, battlegroundConsent: { findUnique: vi.fn(async () => consent) },
      character: { findMany: vi.fn(async () => [{ id: "c", name: "Player", realm: "Forever", gameEdition: "forever" }]) },
      member: { findFirst: vi.fn(async () => ({ id: "paired-member" })) }, $executeRaw: vi.fn(async () => 1),
      $transaction: async (fn: (tx: unknown) => Promise<unknown>): Promise<unknown> => fn(db) };
    const service = createAddonImportService(db as never), snapshot = parseAddonSnapshot(payload([report, { ...report, character: "Other" }]));
    await service.record("g", snapshot, "checksum", "actor", "paired-member");
    expect(create).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ payload: expect.objectContaining({ battlegroundReports: [report] }) }) }));
    expect(db.character.findMany).toHaveBeenCalledWith({ where: { guildId: "g", memberId: "paired-member" } });
    expect(db.$executeRaw).toHaveBeenCalled();
    consent.guildId = "foreign";
    await service.record("g", snapshot, "checksum", "actor", "paired-member");
    expect(create).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ payload: expect.objectContaining({ battlegroundReports: [] }) }) }));
  });
});
