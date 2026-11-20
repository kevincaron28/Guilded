-- Exact character matching by ID (docs/plans/CHARACTER_ID_MATCHING_2026-11-20.md, Stage A).
-- wowId = low part of the in-game GUID. Nullable: no backfill; uploads fill it in. ALTER + index only. GuildRosterEntry.wowId comes from 20270309120000_armory_roster.
ALTER TABLE "Character" ADD COLUMN "wowId" BIGINT;
ALTER TABLE "UnclaimedCharacter" ADD COLUMN "wowId" BIGINT;
ALTER TABLE "DeviceCharacter" ADD COLUMN "wowId" BIGINT;
ALTER TABLE "DungeonRunPlayer" ADD COLUMN "wowId" BIGINT;
ALTER TABLE "PublicRunPlayer" ADD COLUMN "wowId" BIGINT;

CREATE UNIQUE INDEX "Character_guildId_gameEdition_wowId_key" ON "Character"("guildId", "gameEdition", "wowId");
CREATE UNIQUE INDEX "UnclaimedCharacter_guildId_gameEdition_wowId_key" ON "UnclaimedCharacter"("guildId", "gameEdition", "wowId");
CREATE INDEX "DungeonRunPlayer_wowId_idx" ON "DungeonRunPlayer"("wowId");
CREATE INDEX "PublicRunPlayer_wowId_idx" ON "PublicRunPlayer"("wowId");
