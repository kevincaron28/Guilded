-- The in-game guild the uploader's client showed for a public run player (unverified display text);
-- the public guild directory groups players by it. Filled from new uploads and from re-sent runs.
ALTER TABLE "PublicRunPlayer" ADD COLUMN "guild" TEXT;
CREATE INDEX "PublicRunPlayer_guild_idx" ON "PublicRunPlayer"("guild");
