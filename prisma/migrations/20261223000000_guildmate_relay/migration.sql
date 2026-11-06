-- 8.5 track K: provenance of character data relayed by a guildmate's companion. Additive only.
ALTER TABLE "Character" ADD COLUMN "relayedAt" TIMESTAMP(3);
ALTER TABLE "Character" ADD COLUMN "relayedById" TEXT;
