import type { PrismaClient } from "@prisma/client";

export interface BossProgress {
  boss: string;
  kills: number;
  firstKill: Date;
  firstKillRaid: string;
  lastKill: Date;
}

// Guild boss progression from bosses marked KILLED on Discord raids: first
// kill (the "server first" for the guild), how many times, and the latest.
// Boss names typed differently ("Rag" vs "ragnaros") are merged only when
// they match case-insensitively.
export async function bossProgress(database: Pick<PrismaClient, "raidBoss">, guildId: string): Promise<BossProgress[]> {
  const kills = await database.raidBoss.findMany({
    where: { status: "KILLED", raid: { guildId, status: { not: "CANCELLED" } } },
    include: { raid: { select: { title: true, scheduledAt: true, startedAt: true } } }
  });
  const byBoss = new Map<string, BossProgress>();
  for (const kill of kills) {
    const when = kill.killedAt ?? kill.raid.startedAt ?? kill.raid.scheduledAt;
    const key = kill.name.trim().toLowerCase();
    const entry = byBoss.get(key);
    if (!entry) {
      byBoss.set(key, { boss: kill.name.trim(), kills: 1, firstKill: when, firstKillRaid: kill.raid.title, lastKill: when });
      continue;
    }
    entry.kills++;
    if (when < entry.firstKill) {
      entry.firstKill = when;
      entry.firstKillRaid = kill.raid.title;
    }
    if (when > entry.lastKill) entry.lastKill = when;
  }
  return [...byBoss.values()].sort((a, b) => a.firstKill.getTime() - b.firstKill.getTime());
}
