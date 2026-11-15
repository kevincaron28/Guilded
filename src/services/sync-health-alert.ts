import type { Client } from "discord.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { config } from "../config.js";
import { diagnosticTarget } from "./diagnostic-target.js";
import { developerSummary, syncHealth } from "./sync-health.js";

// Once a day (first hourly tick at or after ALERT_HOUR_UTC) the developer gets a summary of stuck syncs in the error-log channel.
// Never a DM to a member, never a public post; silent when nothing is stuck or no verified admin-only channel is set.
export const ALERT_HOUR_UTC = 9;
let lastDay = "";
export function resetSyncAlertDay(): void { lastDay = ""; }

export async function sendSyncHealthAlert(client: Client | null, db: PrismaClient, now = new Date()): Promise<boolean> {
  const day = now.toISOString().slice(0, 10);
  if (now.getUTCHours() < ALERT_HOUR_UTC || lastDay === day) return false;
  lastDay = day;
  const target = await diagnosticTarget(client, config.ERROR_LOG_CHANNEL_ID);
  if (!target) return false;
  const guilds = await db.guild.findMany({ select: { id: true, name: true }, take: 200 });
  const results: { name: string; issues: Awaited<ReturnType<typeof syncHealth>> }[] = [];
  for (const guild of guilds) results.push({ name: guild.name, issues: await syncHealth(db, guild.id, now) });
  // Old companion notes are not kept past a week.
  await db.syncHealthReport.deleteMany({ where: { reportedAt: { lt: new Date(now.getTime() - 7 * 86_400_000) } } }).catch(() => undefined);
  const text = developerSummary(results);
  if (!text) return false;
  await target.channel.send({ content: text, allowedMentions: { parse: [] } });
  return true;
}
