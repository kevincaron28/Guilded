import { describe, expect, it, vi } from "vitest";
import { buildRaidReport, formatDuration } from "../src/services/raid-report.js";

describe("raid report", () => {
  it("summarizes attendance, kills, approved EP, and loot for the raid", async () => {
    const epFind = vi.fn().mockResolvedValue([{ epAmount: 20 }, { epAmount: 15 }]);
    const database = {
      raid: {
        findFirst: vi.fn().mockResolvedValue({
          title: "Molten Core",
          startedAt: new Date("2026-10-01T20:00:00Z"),
          endedAt: new Date("2026-10-01T22:14:00Z"),
          bosses: [{ name: "Lucifron", status: "KILLED" }, { name: "Ragnaros", status: "PENDING" }],
          attendance: [{ status: "PRESENT" }, { status: "LATE" }, { status: "ABSENT" }]
        })
      },
      epgpTransaction: { findMany: epFind },
      lootAward: {
        findMany: vi.fn().mockResolvedValue([
          { itemName: "Helm", amount: 50, member: { displayName: "Kev" } },
          { itemName: "Ring", amount: 20, member: { displayName: "Bob" } }
        ])
      }
    };
    const report = await buildRaidReport(database as never, "g1", "r1");
    expect(report).toMatchObject({
      durationMinutes: 134, raiders: 2, late: 1, absent: 1, bossesKilled: 1, bossesPlanned: 2,
      killedNames: ["Lucifron"], epAwarded: 35, epRecipients: 2, lootCount: 2, gpSpent: 70
    });
    // Only this raid's approved EP counts.
    expect(epFind.mock.calls[0]?.[0].where.sourceRef).toEqual({ startsWith: "raid-ep:r1:" });
  });

  it("formats durations", () => {
    expect(formatDuration(134)).toBe("2h 14m");
    expect(formatDuration(45)).toBe("45m");
    expect(formatDuration(null)).toBe("unknown");
  });
});
