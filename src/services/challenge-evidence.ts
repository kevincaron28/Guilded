import { z } from "zod";

// Retail Mythic+ keystone evidence. Guilded supports WoW Forever only: new uploads with it are refused
// (dungeon-rules.ts); the schema stays so stored Retail runs remain readable.
// Blizzard's result for THIS attempt, not the character's season/personal best.
export const challengeEvidenceSchema = z.object({
  mapId: z.number().int().min(1).max(1000000), level: z.number().int().min(1).max(100),
  affixIds: z.array(z.number().int().min(1).max(1000000)).max(10)
    .refine(ids => new Set(ids).size === ids.length).transform(ids => [...ids].sort((a, b) => a - b)),
  durationMs: z.number().int().min(1).max(14400000), timeLimitSec: z.number().int().min(1).max(14400),
  onTime: z.boolean(), practiceRun: z.boolean(), eligibleForScore: z.boolean()
});
export type ChallengeEvidence = z.infer<typeof challengeEvidenceSchema>;
export function readChallenge(value: unknown): ChallengeEvidence | undefined {
  const parsed = challengeEvidenceSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}
/** m:ss.mmm for a stored keystone timer (Retail runs from before WoW Forever only). */
export function challengeClock(milliseconds: number): string {
  return `${Math.floor(milliseconds / 60000)}:${(Math.floor(milliseconds / 1000) % 60).toString().padStart(2, "0")}.${(milliseconds % 1000).toString().padStart(3, "0")}`;
}
export function challengesAgree(a: ChallengeEvidence | undefined, b: ChallengeEvidence | undefined): boolean {
  return !a || !b || a.mapId === b.mapId && a.level === b.level && a.durationMs === b.durationMs
    && a.timeLimitSec === b.timeLimitSec && a.onTime === b.onTime && a.practiceRun === b.practiceRun
    && a.eligibleForScore === b.eligibleForScore && a.affixIds.join(",") === b.affixIds.join(",");
}
