-- 8.5 track G: daily guild statistics and the CSV feed key (hash only).
ALTER TABLE "GuildSettings" ADD COLUMN "statsEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "GuildSettings" ADD COLUMN "statsFeedKeyHash" TEXT;
ALTER TABLE "GuildSettings" ADD COLUMN "statsFeedKeyAt" TIMESTAMP(3);

CREATE TABLE "GuildStatSnapshot" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "discordMembers" INTEGER NOT NULL DEFAULT 0,
    "activeMembers" INTEGER NOT NULL DEFAULT 0,
    "linkedMembers" INTEGER NOT NULL DEFAULT 0,
    "rosterSize" INTEGER NOT NULL DEFAULT 0,
    "onlinePeak" INTEGER NOT NULL DEFAULT 0,
    "level60" INTEGER NOT NULL DEFAULT 0,
    "messages" INTEGER NOT NULL DEFAULT 0,
    "voiceMinutes" INTEGER NOT NULL DEFAULT 0,
    "raids" INTEGER NOT NULL DEFAULT 0,
    "dungeonRuns" INTEGER NOT NULL DEFAULT 0,
    "totalMessages" INTEGER NOT NULL DEFAULT 0,
    "totalVoiceSeconds" INTEGER NOT NULL DEFAULT 0,
    "levelBands" JSONB NOT NULL DEFAULT '{}',
    "classCounts" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GuildStatSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GuildStatSnapshot_guildId_day_key" ON "GuildStatSnapshot"("guildId", "day");

ALTER TABLE "GuildStatSnapshot" ADD CONSTRAINT "GuildStatSnapshot_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;
