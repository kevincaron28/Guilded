ALTER TABLE "GuildRosterEntry" ADD COLUMN "blizzardCharacterId" INTEGER;
CREATE INDEX "GuildRosterEntry_guildId_blizzardCharacterId_idx" ON "GuildRosterEntry"("guildId", "blizzardCharacterId");

CREATE TABLE "ArmoryGuild" (
    "guildId" TEXT NOT NULL,
    "wowGuildName" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "faction" TEXT,
    "memberCount" INTEGER,
    "achievementPoints" INTEGER,
    "fetchedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ArmoryGuild_pkey" PRIMARY KEY ("guildId")
);

CREATE TABLE "ArmoryRosterEntry" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "blizzardCharacterId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "level" INTEGER,
    "classId" INTEGER,
    "raceId" INTEGER,
    "rank" INTEGER,
    "seenAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ArmoryRosterEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ArmoryRosterEntry_guildId_blizzardCharacterId_key" ON "ArmoryRosterEntry"("guildId", "blizzardCharacterId");

ALTER TABLE "ArmoryGuild" ADD CONSTRAINT "ArmoryGuild_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ArmoryRosterEntry" ADD CONSTRAINT "ArmoryRosterEntry_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;
