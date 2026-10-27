-- Evidence corrections retain the original award and its audit trail.
ALTER TABLE "DungeonAchievement" ADD COLUMN "revokedAt" TIMESTAMP(3);
