import type { Client } from "discord.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { readFileSync } from "node:fs";
import { config } from "../config.js";
import { ScopedReportError, encodeReportOrigin, reportSourceLink, type ReportOrigin } from "./report-context.js";
import { automaticDiagnostic, approvedDiagnosticFields, discordAttachmentUrl, redactDiagnosticText } from "./diagnostic-privacy.js";
import { diagnosticTarget } from "./diagnostic-target.js";
import { MemberAnswerError } from "./member-answer.js";

const BOT_VERSION = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")).version as string;

// The short reference a reporter is given and the developer quotes back ("fix bug K3X9QZ2A").
export const reportRef = (id: string): string => id.slice(-8).toUpperCase();

// Commands answer a member's mistake ("link a character first", "pick a core") by throwing a
// plain Error whose short message is shown to them as is. That is the command working, not a
// bug, so it is not reported. Discord, database, validation and programming errors use their
// own error classes (or long messages) and are still reported.
export function isMemberAnswer(error: unknown): boolean {
  return error instanceof MemberAnswerError || (error instanceof Error && error.constructor === Error && error.message.length > 0 && error.message.length < 200);
}

// Captures minimized command/job failures and confirmed /report bug submissions,
// saved to
// the ErrorReport table, and posted live to ERROR_LOG_CHANNEL_ID when set (a
// verified administrator-only channel, for the developer to watch after a
// release without needing server SSH access). Never throws: reporting a
// problem must never cause a second one.

export interface ErrorReportContext extends ReportOrigin {
  source: string;
  guildId?: string | null;
  guildName?: string | null | undefined;
  userId?: string | null;
  consented?: boolean;
  diagnostics?: unknown;
  notificationChannelId?: string | null;
  // A confirmed /report bug may carry the member's previewed screenshot (Discord CDN only).
  screenshotUrl?: string | null;
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
    async destination(client: Client | null) {
      const target = await diagnosticTarget(client, config.ERROR_LOG_CHANNEL_ID);
      return target ? { id: target.id, label: redactDiagnosticText(target.label, 160) } : null;
    },
    // Returns the report's short reference (see reportRef), or null when it could not be saved.
    async report(client: Client | null, error: unknown, context: ErrorReportContext): Promise<string | null> {
      if (error instanceof ScopedReportError) {
        context = { ...context, ...error.origin };
        error = error.original;
      }
      const bug=context.source==="bug-report";
      if (bug && !context.consented) return null;
      const detail=bug ? {message:redactDiagnosticText(typeof error==="string"?error:"[non-text report omitted]"),stack:null} : automaticDiagnostic(error);
      const {message,stack}=detail;
      const diagnostics=approvedDiagnosticFields(context.diagnostics);
      const screenshot=bug ? discordAttachmentUrl(context.screenshotUrl) : null;
      context={...context,source:redactDiagnosticText(context.source,80),
        guildName:context.guildName ? redactDiagnosticText(context.guildName,80) : undefined,
        operation:context.operation ? redactDiagnosticText(context.operation,150) : null,
        messageId:bug ? context.messageId ?? null : null,
        // The developer inbox reads a bug report's extra as its screenshot link.
        extra:screenshot ?? (Object.keys(diagnostics).length ? JSON.stringify(diagnostics) : null),
        userId:bug ? context.userId ?? null : null};
      let ref: string | null = null;
      try {
        const saved = await prisma.errorReport.create({
          data: {
            source: context.source,
            guildId: context.guildId ?? null,
            userId: context.userId ?? null,
            message: message.slice(0, 2000),
            stack: stack?.slice(0, 4000) ?? null,
            context: encodeReportOrigin(context),
            version: BOT_VERSION
          },
          select: { id: true }
        });
        ref = reportRef(saved.id);
      } catch (dbError) {
        console.error("Failed to save error report", automaticDiagnostic(dbError));
      }
      if (!ref) return null;
      const channelId = bug ? context.notificationChannelId : config.ERROR_LOG_CHANNEL_ID;
      // Storage is authoritative; a private notification is best-effort and is
      // never redirected beyond the destination previewed by the reporter.
      if (!client || !channelId || channelId !== config.ERROR_LOG_CHANNEL_ID || (!bug && !shouldPost(`${context.guildId ?? "global"}:${context.channelId ?? ""}:${context.operation ?? context.source}:${message.slice(0, 200)}`))) return ref;
      try {
        const target = await diagnosticTarget(client, channelId);
        if (!target) return ref;
        const channel = target.channel;
        const sourceLink = reportSourceLink(context.guildId, context);
        const metadata = [
          `🐞 **${context.source}**${context.guildName ? ` — ${context.guildName}` : ""}${context.guildId ? ` (${context.guildId})` : ""}${context.userId ? ` — <@${context.userId}>` : ""}`,
          `Ref \`${ref ?? "not saved"}\` · v${BOT_VERSION}`,
          `Operation: ${(context.operation ?? context.source).slice(0, 150)}`,
          `Source guild: ${context.guildId ?? "unknown"} · channel: ${context.channelId ?? "not recorded"}`,
          sourceLink ? `${context.messageId ? "Source message" : "Source channel"}: ${sourceLink}` : "Source message: not recorded",
          ...(screenshot ? [`Screenshot: ${screenshot}`] : context.extra ? [`Context: ${context.extra.slice(0, 300)}`] : [])
        ].join("\n");
        // Keep source/ref metadata and the closing fence even for long errors.
        const detail = message.replaceAll("```", "'''").slice(0, Math.max(0, 1888 - metadata.length));
        await channel.send({ content: `${metadata}\n\`\`\`\n${detail}\n\`\`\``, allowedMentions: { parse: [] } });
      } catch (postError) {
        console.error("Failed to post error report", automaticDiagnostic(postError));
      }
      return ref;
    }
  };
}
