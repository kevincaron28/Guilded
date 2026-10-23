import type { PrismaClient } from "@prisma/client";

// LATE counts as half credit, BENCHED (asked to sit out) as full credit;
// ABSENT (or no record) counts as none.
const CREDIT: Record<string, number> = { PRESENT: 1, LATE: 0.5, BENCHED: 1 };

export function attendanceRate(statuses: readonly string[], totalRaids: number): number {
  if (totalRaids <= 0) return 0;
  const credit = statuses.reduce((sum, status) => sum + (CREDIT[status] ?? 0), 0);
  return Math.min(1, credit / totalRaids);
}

// Displayed ranking only - never written to the EPGP ledger. Transparent on
// purpose: priority ratio scaled by recent attendance, nothing hidden.
export function meritScore(pr: number, rate: number): number {
  return pr * rate;
}

export function createMeritService(database: PrismaClient) {
  return {
    async getAttendanceRates(guildId: string, days = 30, now = new Date()): Promise<Map<string, number>> {
      const since = new Date(now.getTime() - days * 86_400_000);
      const raids = await database.raid.findMany({
        where: { guildId, status: "COMPLETED", endedAt: { gte: since } },
        select: { id: true }
      });
      const rates = new Map<string, number>();
      if (raids.length === 0) return rates;
      const rows = await database.raidAttendance.findMany({
        where: { raidId: { in: raids.map((raid) => raid.id) } },
        select: { memberId: true, status: true }
      });
      const byMember = new Map<string, string[]>();
      for (const row of rows) {
        byMember.set(row.memberId, [...(byMember.get(row.memberId) ?? []), row.status]);
      }
      for (const [memberId, statuses] of byMember) rates.set(memberId, attendanceRate(statuses, raids.length));
      return rates;
    }
  };
}
