-- Opt-in edited/deleted message log and starboard (both off by default).
ALTER TABLE "GuildSettings" ADD COLUMN "messageLogEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "GuildSettings" ADD COLUMN "starboardChannelId" TEXT;
ALTER TABLE "GuildSettings" ADD COLUMN "starboardThreshold" INTEGER NOT NULL DEFAULT 3;
-- Trial period and sponsor; existing trial members keep no dates (no reminder until set).
ALTER TABLE "RaidCoreMember" ADD COLUMN "trialStartedAt" TIMESTAMP(3);
ALTER TABLE "RaidCoreMember" ADD COLUMN "trialEndsAt" TIMESTAMP(3);
ALTER TABLE "RaidCoreMember" ADD COLUMN "trialSponsorId" TEXT;
ALTER TABLE "RaidCoreMember" ADD COLUMN "trialRemindedAt" TIMESTAMP(3);
CREATE TABLE "DoNotInvite" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "realm" TEXT,
    "discordUserId" TEXT,
    "reason" TEXT NOT NULL,
    "addedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DoNotInvite_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "DoNotInvite_guildId_idx" ON "DoNotInvite"("guildId");
ALTER TABLE "DoNotInvite" ADD CONSTRAINT "DoNotInvite_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE TABLE "StarboardPost" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "sourceChannelId" TEXT NOT NULL,
    "sourceMessageId" TEXT NOT NULL,
    "starboardChannelId" TEXT NOT NULL,
    "starboardMessageId" TEXT NOT NULL,
    "stars" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StarboardPost_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "StarboardPost_sourceMessageId_key" ON "StarboardPost"("sourceMessageId");
CREATE INDEX "StarboardPost_guildId_idx" ON "StarboardPost"("guildId");
ALTER TABLE "StarboardPost" ADD CONSTRAINT "StarboardPost_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;
