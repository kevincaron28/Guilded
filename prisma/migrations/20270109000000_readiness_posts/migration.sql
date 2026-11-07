-- 9.1 readiness upgrade (docs/plans/READINESS_UPGRADE.md): officer off switch for the readiness posts.
ALTER TABLE "GuildSettings" ADD COLUMN "readinessPostsEnabled" BOOLEAN NOT NULL DEFAULT true;
