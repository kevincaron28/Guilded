-- Single witness (13 November 2026, docs/plans/SINGLE_WITNESS_2026-11-13.md): check results and the witness count on a run, and a per-server device exclusion. Hand-written; additive only.
ALTER TABLE "DungeonRun" ADD COLUMN "anomalies" JSONB;
ALTER TABLE "DungeonRun" ADD COLUMN "witnessCount" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "DungeonRunWitness" ADD COLUMN "flags" JSONB;
ALTER TABLE "CompanionDevice" ADD COLUMN "excludedGuilds" TEXT[] DEFAULT ARRAY[]::TEXT[];
