-- Day-before raid message (on by default) and where an auction closes by itself.
ALTER TABLE "GuildSettings" ADD COLUMN "raidNudge" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Raid" ADD COLUMN "nudgeSentAt" TIMESTAMP(3);
ALTER TABLE "Auction" ADD COLUMN "channelId" TEXT;
