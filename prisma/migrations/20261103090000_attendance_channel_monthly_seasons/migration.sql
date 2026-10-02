-- Officer-only channel for the attendance of each finished raid (falls back to the officer log).
ALTER TABLE "GuildSettings" ADD COLUMN "attendanceChannelId" TEXT;
-- Community seasons last one calendar month by default and are followed by the next one.
ALTER TABLE "CommunitySeason" ADD COLUMN "monthly" BOOLEAN NOT NULL DEFAULT true;
