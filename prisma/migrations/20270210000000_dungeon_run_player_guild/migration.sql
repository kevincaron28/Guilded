-- 9.3: the guild each player of a dungeon run belonged to, as the addon saw it (nullable, no backfill).
ALTER TABLE "DungeonRunPlayer" ADD COLUMN "guild" TEXT;
