-- Track M (ROADMAP "Final phase 2" items 3 and 4): the phone guildmate map, last-seen heat map and help pins.
ALTER TABLE "Member" ADD COLUMN "mapShareOff" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "GuildSettings" ADD COLUMN "guildMapEnabled" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "GuildMapSighting" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "character" TEXT NOT NULL,
    "mapId" INTEGER NOT NULL,
    "zone" TEXT NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "continentId" INTEGER,
    "continent" TEXT,
    "cx" DOUBLE PRECISION,
    "cy" DOUBLE PRECISION,
    "seenAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GuildMapSighting_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GuildMapSighting_memberId_character_seenAt_key" ON "GuildMapSighting"("memberId", "character", "seenAt");
CREATE INDEX "GuildMapSighting_guildId_seenAt_idx" ON "GuildMapSighting"("guildId", "seenAt");
ALTER TABLE "GuildMapSighting" ADD CONSTRAINT "GuildMapSighting_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GuildMapSighting" ADD CONSTRAINT "GuildMapSighting_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "GuildHelpCall" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "ref" TEXT NOT NULL,
    "character" TEXT NOT NULL,
    "zone" TEXT NOT NULL,
    "subzone" TEXT,
    "mapId" INTEGER,
    "x" DOUBLE PRECISION,
    "y" DOUBLE PRECISION,
    "continentId" INTEGER,
    "continent" TEXT,
    "cx" DOUBLE PRECISION,
    "cy" DOUBLE PRECISION,
    "attackers" JSONB NOT NULL,
    "calledAt" TIMESTAMP(3) NOT NULL,
    "clearedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GuildHelpCall_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GuildHelpCall_memberId_ref_key" ON "GuildHelpCall"("memberId", "ref");
CREATE INDEX "GuildHelpCall_guildId_calledAt_idx" ON "GuildHelpCall"("guildId", "calledAt");
ALTER TABLE "GuildHelpCall" ADD CONSTRAINT "GuildHelpCall_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GuildHelpCall" ADD CONSTRAINT "GuildHelpCall_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
