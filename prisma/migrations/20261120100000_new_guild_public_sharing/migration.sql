-- Preserve every existing sharing choice and the conservative false database default.
-- Only new Guild creation in the application sets sharing true with a cutoff.
ALTER TABLE "GuildSettings" ADD COLUMN "publicDungeonRunsSince" TIMESTAMP(3);
