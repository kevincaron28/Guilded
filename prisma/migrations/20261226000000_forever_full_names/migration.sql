-- WoW Forever full names (8.5, docs/FOREVER_NAMES.md). Additive only: the pre-8.5 first-name key a
-- row had before the owner's backfill (scripts/forever-names.ts, preview unless --apply) or the
-- member's own upload renamed it to "First Last". Kept so every rename can be traced and undone.
ALTER TABLE "Character" ADD COLUMN "legacyName" TEXT;
ALTER TABLE "UnclaimedCharacter" ADD COLUMN "legacyName" TEXT;
