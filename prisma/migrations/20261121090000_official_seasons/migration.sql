-- Bot-wide dungeon season calendar (7.3), set only by the bot owner with /guilded-season.
CREATE TABLE "OfficialSeason" (
    "id" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OfficialSeason_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OfficialSeason_number_key" ON "OfficialSeason"("number");
CREATE UNIQUE INDEX "OfficialSeason_startsAt_key" ON "OfficialSeason"("startsAt");

-- Season 1 starts with the WoW Forever release: 4 November 2026, 3 PM Pacific (23:00 UTC).
INSERT INTO "OfficialSeason" ("id", "number", "name", "startsAt", "createdBy")
VALUES ('official-season-1', 1, 'Season 1', '2026-11-04 23:00:00', 'migration');
