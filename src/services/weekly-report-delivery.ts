import type { Prisma, PrismaClient } from "@prisma/client";
import { enqueueDiscordJob } from "./discord-jobs.js";
import { isWeeklyReportDueAfterReset } from "./weekly-report.js";

// The report reservation and durable outbox are atomic; failed deliveries remain retryable.
export async function queueWeeklyWowReport(database: PrismaClient, guildId: string, weekEnd: Date, now: Date, message: Prisma.InputJsonObject): Promise<boolean> {
  return database.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`weekly-wow:${guildId}`}))`;
    const current = await tx.guildSettings.findUniqueOrThrow({ where: { guildId } });
    if (!current.weeklyReportChannelId && !current.notifyChannelId) return false;
    if (!isWeeklyReportDueAfterReset({ enabled: current.weeklyReportEnabled, lastAt: current.weeklyReportLastAt, now })) return false;
    await enqueueDiscordJob(tx, guildId, `weekly-wow:${weekEnd.toISOString()}`, "MESSAGE", { route: "wowWeekly", message });
    await tx.guildSettings.update({ where: { guildId }, data: { weeklyReportLastAt: now } });
    return true;
  });
}
