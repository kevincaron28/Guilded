-- World PvP extras: call posts, weekly recap with defender line, hot zones, most wanted. All off until an officer turns them on.
ALTER TABLE "GuildSettings" ADD COLUMN "pvpCallPostsEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "GuildSettings" ADD COLUMN "pvpRecapEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "GuildSettings" ADD COLUMN "pvpHotZonesEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "GuildSettings" ADD COLUMN "pvpMostWantedEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "GuildSettings" ADD COLUMN "pvpRecapLastWeek" INTEGER;
ALTER TABLE "GuildHelpCall" ADD COLUMN "postChannelId" TEXT;
ALTER TABLE "GuildHelpCall" ADD COLUMN "postMessageId" TEXT;
