ALTER TABLE "Raid" ADD COLUMN "mirrorSignupChannelId" TEXT, ADD COLUMN "mirrorSignupMessageId" TEXT;
ALTER TABLE "RaidCore" ADD COLUMN "lootChannelId" TEXT, ADD COLUMN "raidLogChannelId" TEXT;
ALTER TABLE "GuildSettings" ADD COLUMN "dataResetAt" TIMESTAMP(3);
