-- The first backfill (9.3.5) matched rosters through WowGuild, which most servers never have, so every run was marked looked-at with nothing
-- found. Clear the marker for runs that still have a player without a guild, so the (fixed) backfill looks at them once more.
UPDATE "PublicRun" SET "guildBackfillAt" = NULL
WHERE "guildBackfillAt" IS NOT NULL
  AND EXISTS (SELECT 1 FROM "PublicRunPlayer" p WHERE p."runId" = "PublicRun"."id" AND p."guild" IS NULL);
