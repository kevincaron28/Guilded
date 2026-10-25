-- Presentation only. Preserve character IDs, accounting names and all history.
ALTER TABLE "Character" ADD COLUMN "displayName" TEXT;
ALTER TABLE "UnclaimedCharacter" ADD COLUMN "displayName" TEXT;
ALTER TABLE "WebCharacter" ADD COLUMN "displayName" TEXT;
ALTER TABLE "PublicRunPlayer" ADD COLUMN "displayName" TEXT;
