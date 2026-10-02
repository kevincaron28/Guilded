-- Raid attendance seasons: a named date range; raids belong to one by their date.
CREATE TABLE "RaidSeason" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "summaryChannelId" TEXT,
    "summaryMessageId" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RaidSeason_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RaidSeason_guildId_name_key" ON "RaidSeason"("guildId", "name");
CREATE INDEX "RaidSeason_guildId_startsAt_idx" ON "RaidSeason"("guildId", "startsAt");

ALTER TABLE "RaidSeason" ADD CONSTRAINT "RaidSeason_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;
