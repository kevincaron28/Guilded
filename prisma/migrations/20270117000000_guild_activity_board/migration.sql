ALTER TABLE "GuildSettings" ADD COLUMN "activityBoardEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "GuildSettings" ADD COLUMN "activityBoardMessageId" TEXT;
