-- A carried dungeon run keeps its identity (instance id and run id) for the per-run limits (src/services/carried-runs.ts).
-- A near-match lookup of a placed run (same game edition, instance and start time).
-- Undo: DROP INDEX "PublicRun_gameEdition_instanceId_startedAt_idx"; DROP INDEX "CarriedRecord_kind_runKey_idx"; ALTER TABLE "CarriedRecord" DROP COLUMN "runKey";
ALTER TABLE "CarriedRecord" ADD COLUMN "runKey" TEXT;
CREATE INDEX "CarriedRecord_kind_runKey_idx" ON "CarriedRecord"("kind", "runKey");
CREATE INDEX "PublicRun_gameEdition_instanceId_startedAt_idx" ON "PublicRun"("gameEdition", "instanceId", "startedAt");
