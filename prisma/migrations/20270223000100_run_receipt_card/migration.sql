-- 9.3.5: the per-player level, guild, score gained and season total of a stored run, kept on its receipt so the companion can hand
-- them to the addon's result card. Optional and additive: null for every older receipt.
ALTER TABLE "DungeonRunReceipt" ADD COLUMN "card" JSONB;
