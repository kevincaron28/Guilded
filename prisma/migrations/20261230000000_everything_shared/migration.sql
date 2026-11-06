-- 8.5: everything is shared, always (docs/PRIVACY.md). The sharing and privacy switches are gone from the product;
-- the columns stay so nothing is dropped. Existing rows are moved to the shared value so no stale "off" lingers.
UPDATE "WebAccount" SET "publicProfile" = true WHERE "publicProfile" = false;
UPDATE "Member" SET "raceHidden" = false WHERE "raceHidden" = true;
UPDATE "CommunityBadgeSharing" SET "shared" = true WHERE "shared" = false;
UPDATE "BattlegroundConsent" SET "capture" = true, "guildStats" = true WHERE "capture" = false OR "guildStats" = false;
ALTER TABLE "CommunityBadgeSharing" ALTER COLUMN "shared" SET DEFAULT true;
ALTER TABLE "BattlegroundConsent" ALTER COLUMN "capture" SET DEFAULT true;
ALTER TABLE "BattlegroundConsent" ALTER COLUMN "guildStats" SET DEFAULT true;
