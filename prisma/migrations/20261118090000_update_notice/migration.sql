-- Newest release the officers were told is available (src/services/update-check.ts).
ALTER TABLE "GuildSettings" ADD COLUMN "lastUpdateNoticeVersion" TEXT;
