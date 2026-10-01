ALTER TABLE "RaidCore" ADD COLUMN "weeklySchedule" TEXT,
  ADD COLUMN "weeklyTimezone" TEXT, ADD COLUMN "weeklyCreatedBy" TEXT;
ALTER TABLE "Raid" ADD COLUMN "weeklyOccurrence" TEXT;
CREATE UNIQUE INDEX "Raid_weeklyOccurrence_key" ON "Raid"("weeklyOccurrence");
