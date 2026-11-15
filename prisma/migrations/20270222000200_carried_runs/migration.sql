-- A carried dungeon run keeps its identity (instance id and run id) for the per-run limits (src/services/carried-runs.ts).
-- Undo: DROP INDEX "CarriedRecord_kind_runKey_idx"; ALTER TABLE "CarriedRecord" DROP COLUMN "runKey";
ALTER TABLE "CarriedRecord" ADD COLUMN "runKey" TEXT;
CREATE INDEX "CarriedRecord_kind_runKey_idx" ON "CarriedRecord"("kind", "runKey");
