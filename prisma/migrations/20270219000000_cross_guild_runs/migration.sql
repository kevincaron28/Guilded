-- A guild can switch off the sharing of runs made with other guilds' members (on by default).
-- Undo: ALTER TABLE "GuildSettings" DROP COLUMN "crossGuildRuns";
ALTER TABLE "GuildSettings" ADD COLUMN "crossGuildRuns" BOOLEAN NOT NULL DEFAULT true;
