import { z } from "zod";
import { dungeonRole } from "../../companion/dungeon-role.mjs";

/** Additive evidence capability; the enclosing import and score wire protocols stay unchanged. */
export const dungeonIntegritySchema = z.object({
  version: z.literal(2),
  startWitness: z.enum(["unknown", "native-reset"]),
  witnessAt: z.number().int().positive().optional(),
  observer: z.string().trim().min(1).max(100).optional(),
  detectedAt: z.number().int().positive().optional(),
  combatAt: z.number().int().positive().optional(),
  startTrigger: z.enum(["first combat", "manual", "encounter start", "encounter end", "challenge start", "peer", "unknown"]),
  continuous: z.boolean()
}).strict();
export const playerIntegritySchema = z.object({
  knownSec: z.number().int().min(0).max(14400),
  unknownSec: z.number().int().min(0).max(14400),
  lockedRole: z.enum(["TANK", "HEALER", "DPS"]).optional(),
  mixedRole: z.boolean(),
  knownIntervals: z.array(z.tuple([z.number().int().positive(), z.number().int().positive()])).max(64).optional(),
  observers: z.array(z.string().min(1).max(200)).max(40).optional(),
  basis: z.enum(["self", "local"]).optional()
}).strict();
export type DungeonIntegrity = z.infer<typeof dungeonIntegritySchema>;
export type PlayerIntegrity = z.infer<typeof playerIntegritySchema>;
export const UPLOAD_GRACE_MS = 72 * 60 * 60 * 1000;
export const currentIntegrityPolicy = (rules: unknown): boolean => (rules as { evidencePolicy?: unknown } | null)?.evidencePolicy === "current-v2";
export function withIntegrityWindow<T extends { evidencePolicy?: string; seasonWindow?: { from: string; to: string | null } }>(rules: T, from: Date, to?: Date | null): T {
  return currentIntegrityPolicy(rules) && !rules.seasonWindow ? { ...rules, seasonWindow: { from: from.toISOString(), to: to?.toISOString() ?? null } } : rules;
}

export function integrityRuleWindowReason(start: Date | null | undefined, end: Date | null | undefined,
  received: Date | null | undefined, rules: { seasonWindow?: { from: string; to: string | null } }): string | undefined {
  if (!rules.seasonWindow) return "Official season window unavailable";
  return integrityWindowReason(start, end, received, { from: new Date(rules.seasonWindow.from), to: rules.seasonWindow.to ? new Date(rules.seasonWindow.to) : null });
}

export function readDungeonIntegrity(value: unknown): DungeonIntegrity | null {
  const result = dungeonIntegritySchema.safeParse(value); return result.success ? result.data : null;
}
export function readPlayerIntegrity(value: unknown): PlayerIntegrity | null {
  const result = playerIntegritySchema.safeParse(value); return result.success ? result.data : null;
}
export function integrityStartReason(value: unknown, start: Date | null | undefined, duration: number): string | undefined {
  const evidence = readDungeonIntegrity(value);
  if (!evidence) return "Current-v2 evidence required";
  if (!evidence.observer || !start || !evidence.detectedAt || !evidence.combatAt) return "Observed start provenance required";
  const began = start.getTime() / 1000;
  // Five seconds accommodates peer clock/start alignment, not late attachment.
  if (evidence.detectedAt > began + 5 || evidence.combatAt < began - 5 || evidence.combatAt > began + duration
    || !["first combat", "peer"].includes(evidence.startTrigger)) return "Observed first-combat start required";
  // Native events establish an observed clear, never a fresh-instance certificate.
  // Unknown freshness is a separate display fact, not an impossible score gate.
  if (!evidence.continuous || duration <= 0) return "Run observation interrupted";
  return undefined;
}
export function integrityPresence(value: unknown, duration: number, began?: number): boolean {
  const p = readPlayerIntegrity(value);
  if (!p?.knownIntervals || duration <= 0 || p.knownSec + p.unknownSec > duration) return false;
  let known = 0, end = 0;
  for (const [a,b] of p.knownIntervals) {
    if (a < end || b <= a || began !== undefined && (a < began || b > began + duration)) return false;
    known += b-a; end=b;
  }
  return known === p.knownSec && known >= duration * 0.8;
}
export function integrityRole(value: unknown): string | null {
  const p = readPlayerIntegrity(value);
  return p && !p.mixedRole ? dungeonRole(p.lockedRole) : null;
}
/** End selects the season; both endpoints must be inside its half-open window. */
export function integrityWindowReason(start: Date | null | undefined, end: Date | null | undefined,
  received: Date | null | undefined, window: { from: Date | null; to: Date | null }): string | undefined {
  if (!start || !end || !Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start >= end
    || window.from && start < window.from || window.to && end >= window.to) return "Run crosses season boundary";
  if (!received || !Number.isFinite(received.getTime()) || window.to && received.getTime() >= window.to.getTime() + UPLOAD_GRACE_MS) return "Season upload grace expired";
  return undefined;
}
