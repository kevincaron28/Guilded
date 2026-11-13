-- 9.3: officer switch for the per-duel Discord cards (on by default).
ALTER TABLE "GuildSettings" ADD COLUMN "duelCardsEnabled" BOOLEAN NOT NULL DEFAULT true;
