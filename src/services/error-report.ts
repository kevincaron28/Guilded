import type { Client } from "discord.js";
import type { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import { config } from "../config.js";

const BOT_VERSION = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")).version as string;

// The short reference a reporter is given and the developer quotes back ("fix bug K3X9QZ2A").
export const reportRef = (id: string): string => id.slice(-8).toUpperCase();

// Commands answer a member's mistake ("link a character first", "pick a core") by throwing a
// plain Error whose short message is shown to them as is. That is the command working, not a
// bug, so it is not reported. Discord, database, validation and programming errors use their
// own error classes (or long messages) and are still reported.
export function isMemberAnswer(error: unknown): boolean {
  return error instanceof Error && error.constructor === Error && error.message.length > 0 && error.message.length < 200;
}

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
    // Returns the report's short reference (see reportRef), or null when it could not be saved.
    async report(client: Client | null, error: unknown, context: ErrorReportContext): Promise<string | null> {
      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? (error.stack ?? null) : null;
      let ref: string | null = null;
      try {
        const saved = await prisma.errorReport.create({
          data: {
            source: context.source,
            guildId: context.guildId ?? null,
            userId: context.userId ?? null,
            message: message.slice(0, 2000),
            stack: stack?.slice(0, 4000) ?? null,
            context: context.extra?.slice(0, 500) ?? null,
            version: BOT_VERSION
          },
          select: { id: true }
        });
        ref = reportRef(saved.id);
      } catch (dbError) {
        console.error("Failed to save error report", dbError);
      }
      const channelId = config.ERROR_LOG_CHANNEL_ID;
      // A member's bug report always reaches the developer; repeated failures are de-duplicated.
      const bug = context.source === "bug-report";
      if (!client || !channelId || (!bug && !shouldPost(`${context.source}:${message.slice(0, 200)}`))) return ref;
      try {
        const channel = await client.channels.fetch(channelId).catch(() => null);
        if (!channel || !channel.isTextBased() || !("send" in channel)) return ref;
        const lines = [
          `🐞 **${context.source}**${context.guildName ? ` — ${context.guildName}` : ""}${context.guildId ? ` (${context.guildId})` : ""}${context.userId ? ` — <@${context.userId}>` : ""}`,
          `Ref \`${ref ?? "not saved"}\` · v${BOT_VERSION}`,
          `\`\`\`${message.slice(0, 1500)}\`\`\``,
          ...(context.extra ? [`Context: ${context.extra.slice(0, 300)}`] : [])
        ];
        await channel.send({ content: lines.join("\n").slice(0, 1900), allowedMentions: { parse: [] } });
      } catch (postError) {
        console.error("Failed to post error report", postError);
      }
      return ref;
    }
  };
}
