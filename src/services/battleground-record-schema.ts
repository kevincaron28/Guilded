import { createHash } from "node:crypto";
import { z } from "zod";

const reference = z.string().min(8).max(100).regex(/^[A-Za-z0-9_:-]+$/);
// Self-only postmatch evidence. No roster, opponents, damage or honor are accepted.
export const battlegroundReportSchema = z.object({
  version: z.literal(1), reportId: reference,
  adapter: z.literal("forever-postmatch-v1"), edition: z.literal("forever"),
  character: z.string().trim().min(1).max(80), realm: z.string().trim().min(1).max(100),
  realmType: z.literal("normal"), mode: z.enum(["casual", "rated", "blitz"]),
  mapId: z.number().int().positive(), bracket: z.string().min(1).max(30),
  endedAt: z.number().int().positive(), durationSeconds: z.number().int().min(0).max(14400),
  outcome: z.enum(["win", "loss", "draw", "unknown"]),
  presence: z.enum(["complete", "backfill", "early-exit", "unknown"]),
  reloaded: z.boolean(), postmatch: z.literal(true), consent: z.literal(true),
  premadeNonce: reference.optional()
}).strict();
export type BattlegroundReportInput = z.infer<typeof battlegroundReportSchema>;

// Real-client acceptance is a release gate. A client cannot self-certify its adapter.
export const VERIFIED_BG_ADAPTERS: readonly string[] = [];
export function battlegroundReportFingerprint(report: BattlegroundReportInput): string {
  return createHash("sha256").update(JSON.stringify(battlegroundReportSchema.parse(report))).digest("hex");
}

export function validBattlegroundReportTime(report: BattlegroundReportInput, now: Date): boolean {
  const age = now.getTime() / 1000 - report.endedAt;
  return age >= -300 && age <= 90 * 86400;
}
