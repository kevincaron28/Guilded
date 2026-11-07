-- Race to 60 shows the top 50 by default (owner request, 7 November 2026). Rows still at the old default 25 move to 50.
ALTER TABLE "GuildSettings" ALTER COLUMN "raceBoardTop" SET DEFAULT 50;
UPDATE "GuildSettings" SET "raceBoardTop" = 50 WHERE "raceBoardTop" = 25;
