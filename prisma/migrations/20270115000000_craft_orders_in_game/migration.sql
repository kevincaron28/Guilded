-- Crafting orders in game (docs/plans/CRAFTING_ORDERS.md).
ALTER TABLE "CraftRequest" ADD COLUMN "itemKey" INTEGER;
ALTER TABLE "CraftRequest" ADD COLUMN "askedCharacter" TEXT;
ALTER TABLE "CraftRequest" ADD COLUMN "crafterCharacter" TEXT;
ALTER TABLE "CraftRequest" ADD COLUMN "claimSource" TEXT;
ALTER TABLE "GuildSettings" ADD COLUMN "craftOrdersInGame" BOOLEAN NOT NULL DEFAULT true;
