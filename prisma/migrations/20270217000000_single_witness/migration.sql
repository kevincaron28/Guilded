-- Single witness (13 November 2026, docs/plans/SINGLE_WITNESS_2026-11-13.md): plausibility flags and the witness count on a run,
-- and a device exclusion. Hand-written; additive only.
ALTER TABLE "DungeonRun" ADD COLUMN "anomalies" JSONB;
ALTER TABLE "DungeonRun" ADD COLUMN "witnessCount" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "CompanionDevice" ADD COLUMN "excludedAt" TIMESTAMP(3);
ALTER TABLE "CompanionDevice" ADD COLUMN "excludedReason" TEXT;
