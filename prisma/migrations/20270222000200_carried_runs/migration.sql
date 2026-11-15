-- A dungeon run carried for a party with no companion is held here (payload) until a release rule is met (src/services/carried-runs.ts).
-- Undo: DROP INDEX "CarriedRecord_kind_runKey_idx"; ALTER TABLE "CarriedRecord" DROP COLUMN "payload", DROP COLUMN "runKey";
ALTER TABLE "CarriedRecord" ADD COLUMN "runKey" TEXT, ADD COLUMN "payload" JSONB;
CREATE INDEX "CarriedRecord_kind_runKey_idx" ON "CarriedRecord"("kind", "runKey");
