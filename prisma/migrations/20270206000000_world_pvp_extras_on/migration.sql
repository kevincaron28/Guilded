-- World PvP extras are ON by default (owner, 13 November 2026): defender of the week and Tuesday recap, hot zones, most wanted.
-- The Discord post for a call for help is removed entirely; its columns go.
ALTER TABLE "GuildSettings" DROP COLUMN "pvpCallPostsEnabled";
ALTER TABLE "GuildHelpCall" DROP COLUMN "postChannelId";
ALTER TABLE "GuildHelpCall" DROP COLUMN "postMessageId";
ALTER TABLE "GuildSettings" ALTER COLUMN "pvpRecapEnabled" SET DEFAULT true;
ALTER TABLE "GuildSettings" ALTER COLUMN "pvpHotZonesEnabled" SET DEFAULT true;
ALTER TABLE "GuildSettings" ALTER COLUMN "pvpMostWantedEnabled" SET DEFAULT true;
-- Nothing was ever switched on (the earlier migration created them all false and no officer could save a choice before this ships).
UPDATE "GuildSettings" SET "pvpRecapEnabled" = true, "pvpHotZonesEnabled" = true, "pvpMostWantedEnabled" = true;
-- No recap for a week that ended before this goes live: the baseline is the last finished raid week now
-- (weeks start Tuesday 15:00 UTC counted from the epoch, as weekKeyOf in world-pvp.ts).
UPDATE "GuildSettings" SET "pvpRecapLastWeek" = (floor((extract(epoch from now()) - 486000) / 604800))::int - 1;
