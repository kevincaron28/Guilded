import { z } from "zod";

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
export function challengesAgree(a: ChallengeEvidence | undefined, b: ChallengeEvidence | undefined): boolean {
  return !a || !b || a.mapId === b.mapId && a.level === b.level && a.durationMs === b.durationMs
    && a.timeLimitSec === b.timeLimitSec && a.onTime === b.onTime && a.practiceRun === b.practiceRun
    && a.eligibleForScore === b.eligibleForScore && a.affixIds.join(",") === b.affixIds.join(",");
}
