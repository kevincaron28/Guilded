-- Live duel board in the PvP statistics channel. Additive only.
ALTER TABLE "GuildSettings" ADD COLUMN "duelBoardEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "GuildSettings" ADD COLUMN "duelBoardMessageId" TEXT;

-- Quebec Gold's reviewed PvP statistics channel (the static panel there is left untouched).
UPDATE "GuildSettings" s SET "bgStatsChannelId" = '1565740142977880104'
FROM "Guild" g
WHERE g."id" = s."guildId" AND g."discordId" = '1323321076478119967' AND g."scopeKey" = 'default' AND s."bgStatsChannelId" IS NULL;

-- A server whose officers already set up the PvP statistics channel gets the board; others stay off.
UPDATE "GuildSettings" SET "duelBoardEnabled" = true WHERE "bgStatsChannelId" IS NOT NULL;
