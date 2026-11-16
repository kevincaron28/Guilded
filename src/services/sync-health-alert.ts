import type { Client } from "discord.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { config } from "../config.js";
import { diagnosticTarget } from "./diagnostic-target.js";
import { SUMMARY_PREFIX, developerSummary, syncHealth } from "./sync-health.js";

// Once a day (first hourly tick at or after ALERT_HOUR_UTC) the developer gets a summary of stuck syncs in the error-log channel.
// Never a DM to a member, never a public post; silent when nothing is stuck or no verified admin-only channel is set.
export const ALERT_HOUR_UTC = 9;

let lastDay = "";
export function resetSyncAlertDay(): void { lastDay = ""; }

export async function sendSyncHealthAlert(client: Client | null, db: PrismaClient, now = new Date()): Promise<boolean> {
  const day = now.toISOString().slice(0, 10);
  if (now.getUTCHours() < ALERT_HOUR_UTC || lastDay === day) return false;
  // Old companion notes are not kept past a week, whether or not a log channel is set.
  await db.syncHealthReport.deleteMany({ where: { reportedAt: { lt: new Date(now.getTime() - 7 * 86_400_000) } } }).catch(() => undefined);
  const target = await diagnosticTarget(client, config.ERROR_LOG_CHANNEL_ID);
  if (!target) { lastDay = day; return false; }
  // A restart in the same hour must not post it twice: look for this bot's own summary from today in the channel.
  const startOfDay = Date.parse(`${day}T00:00:00Z`);
  const recent = await target.channel.messages.fetch({ limit: 30 }).catch(() => null);
  if (recent?.some((message) => message.author.id === client?.user?.id && message.createdTimestamp >= startOfDay && message.content.startsWith(SUMMARY_PREFIX))) { lastDay = day; return false; }
  const guilds = await db.guild.findMany({ select: { id: true, name: true }, take: 200 });
  const results: { name: string; issues: Awaited<ReturnType<typeof syncHealth>> }[] = [];
  for (const guild of guilds) results.push({ name: guild.name, issues: await syncHealth(db, guild.id, now) });
  const text = developerSummary(results);
  if (!text) { lastDay = day; return false; }
  // Marked done only after a successful send, so a failed post is tried again on the next tick.
  await target.channel.send({ content: text, allowedMentions: { parse: [] } });
  lastDay = day;
  return true;
}
