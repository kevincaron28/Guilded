-- 8.5 track B: Race to 60 board and the PvP channel module. Additive only; everything is off until an officer opts in.
ALTER TABLE "GuildSettings" ADD COLUMN "raceBoardEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "GuildSettings" ADD COLUMN "raceBoardChannelId" TEXT;
ALTER TABLE "GuildSettings" ADD COLUMN "raceBoardMessageId" TEXT;
ALTER TABLE "GuildSettings" ADD COLUMN "pvpModuleEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Member" ADD COLUMN "raceHidden" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "LevelRaceEntry" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "nameKey" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "className" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "reachedMaxAt" TIMESTAMP(3),
    "weekStartLevel" INTEGER NOT NULL,
    "weekStartedAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LevelRaceEntry_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LevelRaceEntry_guildId_nameKey_key" ON "LevelRaceEntry"("guildId", "nameKey");
ALTER TABLE "LevelRaceEntry" ADD CONSTRAINT "LevelRaceEntry_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;
