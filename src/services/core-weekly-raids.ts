import type { PrismaClient, Prisma } from "@prisma/client";
import { enqueueDiscordJob } from "./discord-jobs.js";
import { parseWeeklySchedule, weeklyOccurrences, weeklyScheduleData } from "./core-weekly-time.js";

async function locked<T>(database: PrismaClient, coreId: string, work: (tx: Prisma.TransactionClient) => Promise<T>) {
  return database.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`core-schedule:${coreId}`}, 0))`;
    return work(tx);
  }, { timeout: 15_000, maxWait: 15_000 });
}

export async function saveCoreWeeklySchedule(database: PrismaClient, guildId: string, coreId: string, input: string, createdBy: string) {
  const settings = await database.guildSettings.findUnique({ where: { guildId }, select: { timezone: true } });
  const data = weeklyScheduleData(input, settings?.timezone ?? "America/Toronto", createdBy);
  return locked(database, coreId, async tx => {
    const core = await tx.raidCore.findFirst({ where: { id: coreId, guildId } });
    if (!core) throw new Error("Raid core not found in this guild.");
    return tx.raidCore.update({ where: { id: coreId }, data });
  });
}

// Creation and the durable Discord delivery job commit together. A cancelled or moved
// occurrence keeps its identity, so subsequent checks/restarts never resurrect it.
export async function fillCoreWeeklyRaids(database: PrismaClient, guildId: string, coreId: string, now = new Date()): Promise<string[]> {
  return locked(database, coreId, async tx => {
    const core = await tx.raidCore.findFirst({ where: { id: coreId, guildId } });
    if (!core?.weeklySchedule || !core.weeklyTimezone || !core.weeklyCreatedBy) return [];
    const created: string[] = [];
    for (const occurrence of weeklyOccurrences(parseWeeklySchedule(core.weeklySchedule), core.weeklyTimezone, now)) {
      const weeklyOccurrence = `${core.id}:${occurrence.key}`;
      if (await tx.raid.findUnique({ where: { weeklyOccurrence }, select: { id: true } })) continue;
      // Reuse a manually-created raid at this core/time (including a cancelled one).
      const existing = await tx.raid.findFirst({ where: { guildId, coreId, scheduledAt: occurrence.scheduledAt, isTest: false }, orderBy: { createdAt: "asc" } });
      if (existing) {
        // A moved occurrence already claimed another slot: leave its identity intact.
        if (!existing.weeklyOccurrence) await tx.raid.update({ where: { id: existing.id }, data: { weeklyOccurrence, repeatWeekly: false } });
        continue;
      }
      const raid = await tx.raid.create({ data: {
        guildId, coreId, weeklyOccurrence, title: `Raid — ${core.name}`, description: core.description,
        scheduledAt: occurrence.scheduledAt, createdBy: core.weeklyCreatedBy, repeatWeekly: false
      } });
      await enqueueDiscordJob(tx, guildId, `raid:${raid.id}`, "RAID_POST", { raidId: raid.id });
      created.push(raid.id);
    }
    return created;
  });
}

export async function fillGuildWeeklyRaids(database: PrismaClient, guildId: string, onError: (error: unknown) => void, now = new Date()) {
  const cores = await database.raidCore.findMany({ where: { guildId, weeklySchedule: { not: null } }, select: { id: true } });
  for (const core of cores) {
    try { await fillCoreWeeklyRaids(database, guildId, core.id, now); }
    catch (error) { onError(error); }
  }
}
