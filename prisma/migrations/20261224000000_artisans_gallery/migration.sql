-- 8.5 track D: the per-profession craft forum posts (on by default; officers can switch them off). Additive only.
ALTER TABLE "GuildSettings" ADD COLUMN "professionPostsEnabled" BOOLEAN NOT NULL DEFAULT true;
