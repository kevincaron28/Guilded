ALTER TABLE "RaidCore"
  ADD COLUMN "weeklyStartDate" TEXT,
  ADD COLUMN "weeklyHorizonDays" INTEGER NOT NULL DEFAULT 6,
  ADD COLUMN "raidSize" INTEGER,
  ADD COLUMN "tankLimit" INTEGER,
  ADD COLUMN "healerLimit" INTEGER,
  ADD COLUMN "dpsLimit" INTEGER;
ALTER TABLE "RaidCore" ADD CONSTRAINT "RaidCore_planning_bounds" CHECK (
  "weeklyHorizonDays" BETWEEN 1 AND 90 AND
  (("raidSize" IS NULL AND "tankLimit" IS NULL AND "healerLimit" IS NULL AND "dpsLimit" IS NULL) OR
   ("raidSize" IS NOT NULL AND "tankLimit" IS NOT NULL AND "healerLimit" IS NOT NULL AND "dpsLimit" IS NOT NULL AND
    "raidSize" BETWEEN 1 AND 40 AND "tankLimit" >= 0 AND "healerLimit" >= 0 AND "dpsLimit" >= 0 AND
    "raidSize" = "tankLimit" + "healerLimit" + "dpsLimit")));
