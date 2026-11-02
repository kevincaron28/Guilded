-- Opt-in achievement announcements: off by default; existing achievements count as already announced.
ALTER TABLE "GuildSettings" ADD COLUMN "achievementAnnounceEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "GuildSettings" ADD COLUMN "achievementChannelId" TEXT;
ALTER TABLE "MemberAchievement" ADD COLUMN "announcedAt" TIMESTAMP(3);
UPDATE "MemberAchievement" SET "announcedAt" = "recordedAt";
CREATE INDEX "MemberAchievement_guildId_announcedAt_idx" ON "MemberAchievement"("guildId", "announcedAt");
