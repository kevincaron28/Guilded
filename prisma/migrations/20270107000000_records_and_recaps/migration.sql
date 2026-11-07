-- 9.1 guild records, challenges and the daily recap (docs/plans/RECORDS_AND_RECAPS.md).
ALTER TABLE "GuildSettings" ADD COLUMN "dungeonHighlightsEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "dailyRecapEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "dailyRecapLastDay" TEXT;

ALTER TABLE "LevelRaceEntry" ADD COLUMN "dayStartLevel" INTEGER,
  ADD COLUMN "dayStartedAt" TIMESTAMP(3),
  ADD COLUMN "lastDayGain" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastDayStartedAt" TIMESTAMP(3);

CREATE TABLE "DungeonHighlight" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "instanceId" INTEGER NOT NULL,
    "difficultyId" INTEGER NOT NULL,
    "dungeonName" TEXT NOT NULL,
    "label" TEXT,
    "valueSec" INTEGER,
    "previousSec" INTEGER,
    "players" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DungeonHighlight_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DungeonHighlight_guildId_key_key" ON "DungeonHighlight"("guildId", "key");
CREATE INDEX "DungeonHighlight_guildId_createdAt_idx" ON "DungeonHighlight"("guildId", "createdAt");
CREATE INDEX "DungeonHighlight_runId_idx" ON "DungeonHighlight"("runId");
ALTER TABLE "DungeonHighlight" ADD CONSTRAINT "DungeonHighlight_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DungeonHighlight" ADD CONSTRAINT "DungeonHighlight_runId_fkey" FOREIGN KEY ("runId") REFERENCES "DungeonRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
