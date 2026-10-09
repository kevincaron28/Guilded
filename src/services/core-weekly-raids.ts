import type { PrismaClient, Prisma } from "@prisma/client";
import { parseWeeklySchedule, weeklyOccurrences, weeklyScheduleData } from "./core-weekly-time.js";
import { planningOptions } from "./core-planning.js";

async function locked<T>(database: PrismaClient, coreId: string, work: (tx: Prisma.TransactionClient) => Promise<T>) {
  return database.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`core-schedule:${coreId}`}, 0))`;
    return work(tx);
  }, { timeout: 15_000, maxWait: 15_000 });
}

export async function saveCoreWeeklySchedule(database: PrismaClient, guildId: string, coreId: string, input: string, createdBy: string, options?: { start: string; days: string }) {
  const settings = await database.guildSettings.findUnique({ where: { guildId }, select: { timezone: true } });
  const data = { ...weeklyScheduleData(input, settings?.timezone ?? "America/Toronto", createdBy), ...(options ? planningOptions(options.start, options.days) : {}) };
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
    const occurrences = weeklyOccurrences(parseWeeklySchedule(core.weeklySchedule), core.weeklyTimezone, now, core);
    const existingRaids = await tx.raid.findMany({ where: { guildId, OR: [
      { weeklyOccurrence: { in: occurrences.map(occurrence => `${core.id}:${occurrence.key}`) } },
      { coreId, scheduledAt: { in: occurrences.map(occurrence => occurrence.scheduledAt) }, isTest: false }
    ] }, orderBy: { createdAt: "asc" } });
    const pending: Prisma.RaidCreateManyInput[] = [];
    for (const occurrence of occurrences) {
      const weeklyOccurrence = `${core.id}:${occurrence.key}`;
      if (existingRaids.some(raid => raid.weeklyOccurrence === weeklyOccurrence)) continue;
      // Reuse a manually-created raid at this core/time (including a cancelled one).
      const existing = existingRaids.find(raid => raid.coreId === coreId && !raid.isTest && raid.scheduledAt.getTime() === occurrence.scheduledAt.getTime());
      if (existing) {
        // A moved occurrence already claimed another slot: leave its identity intact.
        if (!existing.weeklyOccurrence) await tx.raid.update({ where: { id: existing.id }, data: { weeklyOccurrence, repeatWeekly: false } });
        continue;
      }
      pending.push({
        guildId, coreId, weeklyOccurrence, title: `Raid — ${core.name}`, description: core.description,
        scheduledAt: occurrence.scheduledAt, createdBy: core.weeklyCreatedBy, repeatWeekly: false,
        tankLimit: core.tankLimit, healerLimit: core.healerLimit, dpsLimit: core.dpsLimit
      });
    }
    if (!pending.length) return [];
    // Bulk insert the launch window, keeping the posts atomic with their new raids.
    const created = await tx.raid.createManyAndReturn({ data: pending, select: { id: true } });
    await tx.discordJob.createMany({ data: created.map(raid => ({ guildId, key: `raid:${raid.id}`, kind: "RAID_POST", payload: { raidId: raid.id } })) });
    return created.map(raid => raid.id);
  });
}

export async function fillGuildWeeklyRaids(database: PrismaClient, guildId: string, onError: (error: unknown) => void, now = new Date()) {
  const cores = await database.raidCore.findMany({ where: { guildId, weeklySchedule: { not: null } }, select: { id: true } });
  for (const core of cores) {
    try { await fillCoreWeeklyRaids(database, guildId, core.id, now); }
    catch (error) { onError(error); }
  }
}
