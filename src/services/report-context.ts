// Only metadata already available to the failing handler. Never read extra
// messages, command arguments, attachments or member profiles to fill gaps.
import { MessageFlags } from "discord.js";

export interface InteractionReportInput {
  channelId: string | null;
  message?: { id: string; flags: { has(flag: number): boolean } } | null;
}
export interface ReportOrigin {
  channelId?: string | null;
  messageId?: string | null;
  operation?: string | null;
  extra?: string | null;
}
export interface ReportScope extends ReportOrigin {
  guildId?: string | null;
  guildName?: string | null | undefined;
}

export function interactionReportOrigin(interaction: InteractionReportInput): ReportOrigin {
  return { channelId: interaction.channelId, messageId: interaction.message && !interaction.message.flags.has(MessageFlags.Ephemeral) ? interaction.message.id : null };
}

export class ScopedReportError extends Error {
  constructor(readonly original: unknown, readonly origin: ReportScope) {
    super("Background operation failed", { cause: original });
  }
}

// Preserve the original exception/stack and existing propagation behavior while
// carrying the guild known inside a loop to its outer reporting callback.
export async function withReportContext<T>(origin: ReportScope, run: () => Promise<T>): Promise<T> {
  try { return await run(); }
  catch (error) {
    throw error instanceof ScopedReportError
      ? new ScopedReportError(error.original, { ...origin, ...error.origin })
      : new ScopedReportError(error, origin);
  }
}

const snowflake = (value: unknown): string | null => typeof value === "string" && /^\d{17,20}$/.test(value) ? value : null;
export function encodeReportOrigin(origin: ReportOrigin): string {
  return JSON.stringify({ v: 1, channelId: snowflake(origin.channelId), messageId: snowflake(origin.messageId), operation: origin.operation?.slice(0, 150) ?? null, extra: origin.extra?.slice(0, 500) ?? null });
}

// Old rows contain a plain screenshot URL. Both formats remain readable.
export function decodeReportOrigin(value: string | null): { channelId: string | null; messageId: string | null; operation: string | null; extra: string | null } {
  try {
    const parsed: unknown = JSON.parse(value ?? "null");
    if (parsed && typeof parsed === "object" && "v" in parsed && parsed.v === 1) {
      const data = parsed as Record<string, unknown>;
      return { channelId: snowflake(data["channelId"]), messageId: snowflake(data["messageId"]), operation: typeof data["operation"] === "string" ? data["operation"].slice(0, 150) : null, extra: typeof data["extra"] === "string" ? data["extra"].slice(0, 500) : null };
    }
  } catch { /* Legacy screenshot/context. */ }
  return { channelId: null, messageId: null, operation: null, extra: value?.slice(0, 500) ?? null };
}

export function reportSourceLink(guildId: string | null | undefined, origin: ReportOrigin): string | null {
  const guild = snowflake(guildId), channel = snowflake(origin.channelId), message = snowflake(origin.messageId);
  return guild && channel ? `https://discord.com/channels/${guild}/${channel}${message ? `/${message}` : ""}` : null;
}
