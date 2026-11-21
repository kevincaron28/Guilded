import { describe, expect, it, vi } from "vitest";
import { guildStats, isWeeklyReportDue } from "../src/services/guild-stats.js";

const member = (id: string, displayName: string) => ({ id, displayName });

describe("guild stats", () => {
  it("counts raids, kills, loot, EP, and ranks attendance and loot", async () => {
    const database = {
      raid: {
        findMany: vi.fn().mockResolvedValue([
          {
            bosses: [{ status: "KILLED" }, { status: "KILLED" }, { status: "PENDING" }],
            attendance: [
              { memberId: "a", status: "PRESENT", member: member("a", "Amy") },
              { memberId: "b", status: "LATE", member: member("b", "Bob") },
              { memberId: "c", status: "ABSENT", member: member("c", "Cid") }
            ]
          },
          {
            bosses: [{ status: "KILLED" }],
            attendance: [{ memberId: "a", status: "PRESENT", member: member("a", "Amy") }]
          }
        ])
      },
      lootAward: {
        findMany: vi.fn().mockResolvedValue([
          { memberId: "b", amount: 30, member: member("b", "Bob") },
          { memberId: "b", amount: 20, member: member("b", "Bob") },
          { memberId: "a", amount: 90, member: member("a", "Amy") }
        ])
      },
      epgpTransaction: { aggregate: vi.fn().mockResolvedValue({ _sum: { epAmount: 120 } }) },
      member: { count: vi.fn().mockResolvedValue(3) },
      application: { count: vi.fn().mockResolvedValue(2) }
    };
    const stats = await guildStats(database as never, "g1", new Date("2026-09-17T00:00:00Z"));
    expect(stats).toMatchObject({
      raids: 2, averageRaiders: 2, bossKills: 3, lootCount: 3, gpSpent: 140, epAwarded: 120, newMembers: 3, applications: 2
    });
    expect(stats.topAttendance).toEqual([{ name: "Amy", raids: 2 }, { name: "Bob", raids: 1 }]);
    expect(stats.topLoot[0]).toEqual({ name: "Bob", items: 2, gp: 50 });
  });

  it("weekly report is due once a week when enabled", () => {
    const now = new Date("2026-10-01T12:00:00Z");
    expect(isWeeklyReportDue({ enabled: false, lastAt: null, now })).toBe(false);
    expect(isWeeklyReportDue({ enabled: true, lastAt: null, now })).toBe(true);
    expect(isWeeklyReportDue({ enabled: true, lastAt: new Date("2026-09-26T12:00:00Z"), now })).toBe(false);
    expect(isWeeklyReportDue({ enabled: true, lastAt: new Date("2026-09-24T12:00:00Z"), now })).toBe(true);
  });
});
