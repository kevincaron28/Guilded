ALTER TABLE "GuildSettings" ADD COLUMN "publicSlug" TEXT;
CREATE UNIQUE INDEX "GuildSettings_publicSlug_key" ON "GuildSettings"("publicSlug");
