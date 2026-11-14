-- 9.3: officer switch for the season start/end cards (on by default).
ALTER TABLE "GuildSettings" ADD COLUMN "seasonCardsEnabled" BOOLEAN NOT NULL DEFAULT true;
