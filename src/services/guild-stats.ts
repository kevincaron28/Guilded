import type { PrismaClient } from "@prisma/client";

export interface GuildStats {
  since: Date;
  coreId?: string;
  raids: number;
  averageRaiders: number;
  bossKills: number;
  lootCount: number;
  gpSpent: number;
  epAwarded: number;
  newMembers: number;
  applications: number;
  topAttendance: { name: string; raids: number }[];
  // Raids attended per player name (everyone, not just the top five).
  attendanceByName?: Map<string, number>;
  topLoot: { name: string; items: number; gp: number }[];
}

type Db = Pick<PrismaClient, "raid" | "lootAward" | "epgpTransaction" | "member" | "application">;

// Guild activity over a window: raids, kills, loot, EP, recruitment, and who
// showed up the most. Counts only - no performance rankings.
// `until` (exclusive) bounds the window; without it, everything since `since`.
export async function guildStats(database: Db, guildId: string, since: Date, until?: Date, coreId?: string): Promise<GuildStats> {
  const window = until ? { gte: since, lt: until } : { gte: since };
  const coreRaids = coreId ? await database.raid.findMany({ where: { guildId, coreId }, select: { id: true } }) : [];
  const [raids, loot, ep, newMembers, applications] = await Promise.all([
    database.raid.findMany({
      where: { guildId, ...(coreId ? { coreId } : {}), status: "COMPLETED", endedAt: window },
      include: { bosses: true, attendance: { include: { member: true } } }
    }),
    database.lootAward.findMany({ where: { guildId, ...(coreId ? { raidId: { in: coreRaids.map(raid => raid.id) } } : {}), awardedAt: window }, include: { member: true } }),
    database.epgpTransaction.aggregate({
      where: { guildId, createdAt: window, type: "EP_AWARD", ...(coreId ? { OR: [{ coreId }, ...coreRaids.map(raid => ({ sourceRef: { startsWith: `raid-ep:${raid.id}:` } }))] } : {}) },
      _sum: { epAmount: true }
    }),
    database.member.count({ where: { guildId, createdAt: window } }),
    database.application.count({ where: { guildId, createdAt: window } })
  ]);

  const attended = new Map<string, { name: string; raids: number }>();
  let raiderTotal = 0;
  for (const raid of raids) {
    for (const row of raid.attendance) {
      if (row.status === "ABSENT") continue;
      // Benched players earn attendance credit but weren't in the raid.
      if (row.status !== "BENCHED") raiderTotal++;
      const entry = attended.get(row.memberId) ?? { name: row.member.displayName, raids: 0 };
      entry.raids++;
      attended.set(row.memberId, entry);
    }
  }
  const looted = new Map<string, { name: string; items: number; gp: number }>();
  for (const award of loot) {
    const entry = looted.get(award.memberId) ?? { name: award.member.displayName, items: 0, gp: 0 };
    entry.items++;
    entry.gp += award.amount;
    looted.set(award.memberId, entry);
  }

  return {
    since,
    ...(coreId ? { coreId } : {}),
    raids: raids.length,
    averageRaiders: raids.length ? Math.round(raiderTotal / raids.length) : 0,
    bossKills: raids.reduce((sum, raid) => sum + raid.bosses.filter((boss) => boss.status === "KILLED").length, 0),
    lootCount: loot.length,
    gpSpent: loot.reduce((sum, award) => sum + award.amount, 0),
    epAwarded: ep._sum.epAmount ?? 0,
    newMembers,
    applications,
    topAttendance: [...attended.values()].sort((a, b) => b.raids - a.raids || a.name.localeCompare(b.name)).slice(0, 5),
    attendanceByName: new Map([...attended.values()].map((row) => [row.name, row.raids])),
    topLoot: [...looted.values()].sort((a, b) => b.items - a.items || b.gp - a.gp).slice(0, 5)
  };
}

// Weekly report timing: due when enabled and a week has passed since the last one.
export function isWeeklyReportDue(input: { enabled: boolean; lastAt: Date | null; now: Date }): boolean {
  if (!input.enabled) return false;
  return !input.lastAt || input.now.getTime() - input.lastAt.getTime() >= 7 * 86_400_000;
}
