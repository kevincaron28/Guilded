-- One group finder for dungeons and PvP (9.1): the activity of a PvP group (battleground or arena) and the officer switch (on by default).
ALTER TABLE "DungeonGroup" ADD COLUMN "activity" TEXT;
ALTER TABLE "GuildSettings" ADD COLUMN "unifiedGroupFinder" BOOLEAN NOT NULL DEFAULT true;
