CREATE TABLE "GuildPage" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "guildId" TEXT NOT NULL REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "slug" TEXT NOT NULL,
  "published" BOOLEAN NOT NULL DEFAULT false,
  "sections" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "intro" TEXT,
  "recruitment" TEXT,
  "inviteUrl" TEXT,
  "indexable" BOOLEAN NOT NULL DEFAULT true,
  "publishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "GuildPage_guildId_key" ON "GuildPage"("guildId");
CREATE UNIQUE INDEX "GuildPage_slug_key" ON "GuildPage"("slug");
