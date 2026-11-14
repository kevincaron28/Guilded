-- Duel rating: per-server start of the rating rules (null = the built-in default, 1 December 2026 00:00 UTC).
ALTER TABLE "GuildSettings" ADD COLUMN "duelRatingStartsAt" TIMESTAMP(3);
