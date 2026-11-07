-- Owner decision (7 November 2026): public sharing and nickname sync are always on; only "Delete my data" remains.
-- Old "off" flags are switched on (no column dropped). A guild that had sharing off publishes only runs started from now.
UPDATE "GuildSettings" SET "publicDungeonRunsSince" = COALESCE("publicDungeonRunsSince", NOW()), "publicDungeonRuns" = true WHERE "publicDungeonRuns" = false;
UPDATE "MemberNickname" SET "optedOut" = false WHERE "optedOut" = true;
