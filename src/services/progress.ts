import type { PrismaClient } from "../generated/prisma/client.js";

export interface BossProgress {
  boss: string;
  kills: number;
  firstKill: Date;
  firstKillRaid: string;
  lastKill: Date;
}

// One boss is killed once per raid night: a Discord mark and an addon record this close together are the same kill.
const SAME_KILL_MS = 6 * 3_600_000;

// Guild boss progression from bosses marked KILLED on Discord raids and the kills members' addons recorded
// (RaidKill): first kill (the "server first" for the guild), how many times, and the latest.
// Boss names typed differently ("Rag" vs "ragnaros") are merged only when they match case-insensitively.
export async function bossProgress(database: Pick<PrismaClient, "raidBoss"> & Partial<Pick<PrismaClient, "raidKill">>, guildId: string): Promise<BossProgress[]> {
  const marked = await database.raidBoss.findMany({
    where: { status: "KILLED", raid: { guildId, status: { not: "CANCELLED" } } },
    include: { raid: { select: { title: true, scheduledAt: true, startedAt: true } } }
  });
  const recorded = await database.raidKill?.findMany({
    where: { guildId, valid: true, bossName: { not: "" } },
    select: { bossName: true, instanceName: true, killedAt: true }
  }) ?? [];
  const kills = [
    ...marked.map((kill) => ({ name: kill.name, when: kill.killedAt ?? kill.raid.startedAt ?? kill.raid.scheduledAt, raid: kill.raid.title })),
    ...recorded.map((kill) => ({ name: kill.bossName, when: kill.killedAt, raid: kill.instanceName }))
  ].sort((a, b) => a.when.getTime() - b.when.getTime());
  const byBoss = new Map<string, BossProgress>();
  for (const { name, when, raid } of kills) {
    const key = name.trim().toLowerCase();
    const entry = byBoss.get(key);
    if (!entry) {
      byBoss.set(key, { boss: name.trim(), kills: 1, firstKill: when, firstKillRaid: raid, lastKill: when });
      continue;
    }
    // A capitalised spelling wins over one typed all in lower case.
    if (entry.boss === entry.boss.toLowerCase() && name !== name.toLowerCase()) entry.boss = name.trim();
    // Sorted by time: a kill right after the latest one is the same night's kill seen twice.
    if (when.getTime() - entry.lastKill.getTime() < SAME_KILL_MS) continue;
    entry.kills++;
    entry.lastKill = when;
  }
  return [...byBoss.values()].sort((a, b) => a.firstKill.getTime() - b.firstKill.getTime());
}
