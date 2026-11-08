import { createHash } from "node:crypto";
import { ZodError } from "zod";
import { GameEditionError } from "./game-edition.js";

// Why an automatic addon import was not applied (investigation, 7 November 2026: Québec Gold's
// officer journal showed "Addon import not applied" four times and the server log seemed to have
// nothing). The server log did have it: src/services/diagnostic-console.ts replaces every text
// passed to console.error/warn with "[diagnostic:<hash>]" ("Auto-apply of an addon import failed"
// is [diagnostic:a197968563bf]), so the line could not be found by its words, and the duplicate
// retry path logged nothing at all. Every failure now writes one console.info line (not hashed:
// it holds codes only, no names, no payload) and transient database failures are retried.

export type ApplyFailureReason =
  | "transaction-timeout" // P2028: the transaction could not start or ran out of time (lock or pool wait under load)
  | "pool-timeout"        // P2024: no database connection free in time
  | "write-conflict"      // P2034: a concurrent write; retrying is the documented answer
  | "database-unreachable"// P1001/P1002/P1008/P1017
  | "database"            // any other Prisma error
  | "already-applied"
  | "not-found"
  | "edition"
  | "guild-scope"
  | "invalid-payload"
  | "rejected"            // a short rule message from the import itself
  | "unknown";

export interface ApplyFailure {
  reason: ApplyFailureReason;
  /** Prisma or Node error code when there is one (P2028, ECONNRESET). */
  code: string | null;
  /** Worth trying again in a moment: nothing was imported and the cause is load, not the data. */
  transient: boolean;
  /** What officers and the companion are told (short, never a raw database message). */
  message: string;
}

const TRANSIENT: Partial<Record<string, ApplyFailureReason>> = {
  P2028: "transaction-timeout", P2024: "pool-timeout", P2034: "write-conflict",
  P1001: "database-unreachable", P1002: "database-unreachable", P1008: "database-unreachable", P1017: "database-unreachable"
};

const SAY: Record<ApplyFailureReason, string> = {
  "transaction-timeout": "the database was busy with other uploads and the import timed out",
  "pool-timeout": "the database had no free connection in time",
  "write-conflict": "another upload changed the same data at the same moment",
  "database-unreachable": "the database could not be reached",
  database: "a database error stopped it",
  "already-applied": "it was already applied",
  "not-found": "the upload was not found",
  edition: "the saved data is for another WoW edition",
  "guild-scope": "the saved data belongs to another WoW guild or realm",
  "invalid-payload": "the saved data could not be read",
  rejected: "the import refused it",
  unknown: "an unexpected error stopped it"
};

function errorCode(error: unknown): string | null {
  const raw = error && typeof error === "object" && "code" in error ? String((error as { code: unknown }).code) : "";
  return /^(?:P\d{4}|E[A-Z]{2,25})$/.test(raw) ? raw : null;
}

export function classifyApplyFailure(error: unknown): ApplyFailure {
  const code = errorCode(error);
  const text = error instanceof Error ? error.message : "";
  let reason: ApplyFailureReason;
  if (code && TRANSIENT[code]) reason = TRANSIENT[code]!;
  else if (code?.startsWith("P")) reason = "database";
  else if (code === "ECONNRESET" || code === "ECONNREFUSED" || code === "ETIMEDOUT") reason = "database-unreachable";
  else if (/already been applied/i.test(text)) reason = "already-applied";
  else if (/^Addon import not found/.test(text)) reason = "not-found";
  else if (error instanceof GameEditionError) reason = "edition";
  else if (/does not identify the selected WoW guild/.test(text)) reason = "guild-scope";
  else if (error instanceof ZodError || error instanceof SyntaxError) reason = "invalid-payload";
  // Prisma's transaction timeout sometimes arrives without a code on older paths.
  else if (/Transaction (?:already closed|API error)|expired transaction|Unable to start a transaction/i.test(text)) reason = "transaction-timeout";
  // A plain Error with a short sentence is one of the import's own rules: shown as is.
  else if (error instanceof Error && error.constructor === Error && text.length > 0 && text.length < 200) reason = "rejected";
  else reason = "unknown";
  const transient = ["transaction-timeout", "pool-timeout", "write-conflict", "database-unreachable"].includes(reason);
  const message = reason === "rejected" || reason === "guild-scope" || reason === "edition" ? text
    : `${SAY[reason][0]!.toUpperCase()}${SAY[reason].slice(1)}${code ? ` (${code})` : ""}.`;
  return { reason, code, transient, message };
}

/** Runs `apply`; transient database failures are tried again after `delaysMs` (nothing is imported
 * by a failed attempt: the import runs in one transaction). Returns the result and the attempts used,
 * or throws the last error with `attempts` attached. */
export async function applyWithRetry<T>(apply: () => Promise<T>, options: { delaysMs?: readonly number[]; sleep?: (ms: number) => Promise<void> } = {}): Promise<{ result: T; attempts: number }> {
  const delays = options.delaysMs ?? [3_000, 10_000];
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  for (let attempt = 1; ; attempt++) {
    try {
      return { result: await apply(), attempts: attempt };
    } catch (error) {
      const failure = classifyApplyFailure(error);
      if (!failure.transient || attempt > delays.length) {
        if (error && typeof error === "object") Object.assign(error, { applyAttempts: attempt });
        throw error;
      }
      await sleep(delays[attempt - 1]!);
    }
  }
}

export function applyAttempts(error: unknown): number {
  const value = error && typeof error === "object" ? (error as { applyAttempts?: unknown }).applyAttempts : undefined;
  return typeof value === "number" && value > 0 ? value : 1;
}

/** One server-log line per failed automatic import: codes and timings only. */
export function applyFailureLogLine(input: { guildId: string; importId: string; failure: ApplyFailure; attempts: number; ms: number; officer: boolean; retriedDuplicate: boolean; payloadBytes?: number }): string {
  const guild = createHash("sha256").update(input.guildId).digest("hex").slice(0, 8);
  return `import-apply-failed guild=${guild} import=${input.importId.slice(-8)} reason=${input.failure.reason} code=${input.failure.code ?? "-"}`
    + ` transient=${input.failure.transient ? 1 : 0} attempts=${input.attempts} ms=${Math.round(input.ms)} officer=${input.officer ? 1 : 0}`
    + ` duplicate=${input.retriedDuplicate ? 1 : 0}${input.payloadBytes !== undefined ? ` bytes=${input.payloadBytes}` : ""}`;
}
