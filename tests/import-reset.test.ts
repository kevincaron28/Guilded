import { describe, expect, it } from "vitest";
import { parseAddonSnapshot } from "../src/integrations/addon.js";
import { excludeHistoryBeforeReset } from "../src/services/import-reset.js";
describe("fresh setup excludes local history", () => {
  it("keeps post-reset history while discarding old and undated ledger entries", () => {
    const entry = { character: "Ann", realm: "Forever", epAmount: 10, gpAmount: 0, type: "EP_AWARD", reason: "Attendance" };
    const snapshot = parseAddonSnapshot({ source: "Guilded", exportedAt: "2026-09-30T12:00:00Z", epgpTransactions: [
      { ...entry, createdAt: "2026-09-29T12:00:00Z" }, entry, { ...entry, createdAt: "2026-09-30T11:00:00Z" }
    ], dungeonRuns: [{ endedAt: Date.parse("2026-09-29T12:00:00Z") / 1000 }, { endedAt: Date.parse("2026-09-30T11:00:00Z") / 1000 }], loot: [
      { ref: "old", character: "Ann", realm: "Forever", item: "Ring", awardedAt: "2026-09-29T12:00:00Z" }
    ] });
    const filtered = excludeHistoryBeforeReset(snapshot, new Date("2026-09-30T10:00:00Z"));
    expect(filtered.epgpTransactions).toHaveLength(1); expect(filtered.loot).toEqual([]);
    expect(filtered.dungeonRuns).toHaveLength(1);
    expect(excludeHistoryBeforeReset(snapshot, null)).toBe(snapshot);
  });
});
