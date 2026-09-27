import type { Client } from "discord.js";
import type { PrismaClient } from "@prisma/client";
import { config } from "../config.js";

// Captures command/job failures and /report bug submissions: always saved to
// the ErrorReport table, and posted live to ERROR_LOG_CHANNEL_ID when set (a
// channel in any guild the bot is in, for the developer to watch after a
// release without needing server SSH access). Never throws: reporting a
// problem must never cause a second one.

export interface ErrorReportContext {
  source: string;
  guildId?: string | null;
  guildName?: string | null | undefined;
  userId?: string | null;
  extra?: string | null;
}

// De-dupes identical failures (e.g. a background job failing the same way
// every 5 minutes) so the live channel doesn't get spammed.
const DEDUPE_WINDOW_MS = 5 * 60_000;
const recentlySent = new Map<string, number>();

function shouldPost(key: string): boolean {
  const now = Date.now();
  const last = recentlySent.get(key);
  if (last && now - last < DEDUPE_WINDOW_MS) return false;
  recentlySent.set(key, now);
  if (recentlySent.size > 500) recentlySent.clear();
  return true;
}

export function createErrorReportService(prisma: PrismaClient) {
  return {
    async report(client: Client | null, error: unknown, context: ErrorReportContext): Promise<void> {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? (error.stack ?? null) : null;
      try {
        await prisma.errorReport.create({
          data: {
            source: context.source,
            guildId: context.guildId ?? null,
            userId: context.userId ?? null,
            message: message.slice(0, 2000),
            stack: stack?.slice(0, 4000) ?? null,
            context: context.extra?.slice(0, 500) ?? null
          }
        });
      } catch (dbError) {
        console.error("Failed to save error report", dbError);
      }
      const channelId = config.ERROR_LOG_CHANNEL_ID;
      if (!client || !channelId || !shouldPost(`${context.source}:${message.slice(0, 200)}`)) return;
      try {
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel || !channel.isTextBased() || !("send" in channel)) return;
        const lines = [
          `🐞 **${context.source}**${context.guildName ? ` — ${context.guildName}` : ""}${context.userId ? ` — <@${context.userId}>` : ""}`,
          `\`\`\`${message.slice(0, 1500)}\`\`\``,
          ...(context.extra ? [`Context: ${context.extra.slice(0, 300)}`] : [])
        ];
        await channel.send({ content: lines.join("\n").slice(0, 1900), allowedMentions: { parse: [] } });
      } catch (postError) {
        console.error("Failed to post error report", postError);
      }
    }
  };
}
