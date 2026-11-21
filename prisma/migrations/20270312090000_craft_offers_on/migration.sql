-- Crafter offers on by default (owner rule, 21 Nov 2026: features ship ON, officers keep the off switch).
ALTER TABLE "GuildSettings" ALTER COLUMN "craftOffersEnabled" SET DEFAULT true;
UPDATE "GuildSettings" SET "craftOffersEnabled" = true WHERE "craftOffersEnabled" = false;
