import type { PrismaClient } from "@prisma/client";

// Reserve before contacting the provider. Failed requests also consume a reservation:
// retries, concurrent messages and restarts must not multiply the host's spending limit.
export async function reserveAiAttempt(database: PrismaClient, guildId: string,
  limits: { global: number; guild: number }, now = new Date()): Promise<boolean> {
  if (![limits.global, limits.guild].every(limit => Number.isInteger(limit) && limit > 0)) return false;
  const day = now.toISOString().slice(0, 10), scope = `guild:${guildId}`;
  return database.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`ai-budget:${day}`}))`;
    const rows = await tx.aiDailyUsage.findMany({ where: { day, scope: { in: ["global", scope] } } });
    if ((rows.find(row => row.scope === "global")?.attempts ?? 0) >= limits.global
      || (rows.find(row => row.scope === scope)?.attempts ?? 0) >= limits.guild) return false;
    for (const key of ["global", scope]) await tx.aiDailyUsage.upsert({
      where: { day_scope: { day, scope: key } },
      create: { day, scope: key, attempts: 1 }, update: { attempts: { increment: 1 } }
    });
    return true;
  });
}
