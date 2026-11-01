import { describe, expect, it, vi } from "vitest";
import { personalWeeklyRecap, personalWeeklyRecapEmbed } from "../src/services/personal-weekly-recap.js";

const now = new Date("2026-10-30T12:00:00Z");
function db() {
  return { member: { findFirst: vi.fn().mockResolvedValue({ id: "member" }) },
    dungeonPointTransaction: { aggregate: vi.fn().mockResolvedValue({ _sum: { amount: -5 }, _count: 3 }) },
    dungeonAchievement: { findMany: vi.fn().mockResolvedValue([]) },
    communityBadge: { findMany: vi.fn().mockResolvedValue([]) },
    raidSignup: { findMany: vi.fn().mockResolvedValue([]) } };
}

describe("private personal recap", () => {
  it("resolves only the authenticated user and reuses the last complete report week", async () => {
    const database = db();
    const result = await personalWeeklyRecap(database as never, "guild", "actor", now);
    expect(database.member.findFirst).toHaveBeenCalledWith({ where: { guildId: "guild", discordUserId: "actor" }, select: { id: true } });
    expect(result.start.toISOString()).toBe("2026-10-20T15:00:00.000Z");
    expect(result.end.toISOString()).toBe("2026-10-27T15:00:00.000Z");
    expect(result.netParticipationPoints).toBe(-5); // Corrections must not become positive awards.
    expect(database.dungeonPointTransaction.aggregate.mock.calls[0]![0]).toMatchObject({ where: { guildId: "guild", memberId: "member", createdAt: { gte: result.start, lt: result.end } } });
    expect(database.dungeonAchievement.findMany.mock.calls[0]![0]).toMatchObject({ where: { guildId: "guild", memberId: "member", revokedAt: null } });
    expect(database.communityBadge.findMany.mock.calls[0]![0]).toMatchObject({ where: { userId: "actor", season: { guildId: "guild" }, source: { in: ["LEDGER", "REVIEW"] } } });
    expect(database.raidSignup.findMany.mock.calls[0]![0]).toMatchObject({ where: { memberId: "member", raid: { guildId: "guild", status: "PLANNED", isTest: false } } });
  });
  it("does not query another member or any reports if the actor lacks a record", async () => {
    const database = db(); database.member.findFirst.mockResolvedValue(null as never);
    await expect(personalWeeklyRecap(database as never, "guild", "actor", now)).rejects.toThrow("member record");
    expect(database.communityBadge.findMany).not.toHaveBeenCalled();
    expect(database.raidSignup.findMany).not.toHaveBeenCalled();
  });
  it("bounds previews and points to delivery controls without assuming opt-in state", async () => {
    const database = db();
    database.communityBadge.findMany.mockResolvedValue(Array.from({ length: 11 }, (_, i) => ({ code: `badge-${i}`, earnedAt: now })));
    database.raidSignup.findMany.mockResolvedValue(Array.from({ length: 6 }, () => ({ status: "WAITLISTED", raid: { title: "**Raid**", scheduledAt: now } })));
    const result = await personalWeeklyRecap(database as never, "guild", "actor", now);
    expect(result).toMatchObject({ moreBadges: true, moreSignups: true });
    expect(result.communityBadges).toHaveLength(10); expect(result.signups).toHaveLength(5);
    const en = personalWeeklyRecapEmbed(result, "en").toJSON(), fr = personalWeeklyRecapEmbed(result, "fr").toJSON();
    expect(en.footer?.text).toContain("/automation recap"); expect(fr.footer?.text).toContain("/automation recap");
    expect(en.footer?.text).not.toContain("delivery is off"); expect(fr.footer?.text).not.toContain("désactivé");
    expect(en.fields![2]!.value).toContain("Waitlisted"); expect(fr.fields![2]!.value).toContain("attente");
    expect(en.fields![2]!.value).not.toContain("**Raid**");
  });
});
