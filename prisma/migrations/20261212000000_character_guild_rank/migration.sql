-- The character's rank in its own WoW guild, from the addon's guild roster (optional, additive).
-- Index 0 is the guild master. Only linked characters get it.
ALTER TABLE "Character" ADD COLUMN "guildRankName" TEXT;
ALTER TABLE "Character" ADD COLUMN "guildRankIndex" INTEGER;
ALTER TABLE "Character" ADD COLUMN "guildRankAt" TIMESTAMP(3);
