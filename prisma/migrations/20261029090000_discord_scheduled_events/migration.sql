CREATE TABLE "DiscordEventLink" (
  "id" TEXT NOT NULL,
  "guildId" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "discordId" TEXT,
  "signature" TEXT,
  "settled" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DiscordEventLink_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DiscordEventLink_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "DiscordEventLink_discordId_key" ON "DiscordEventLink"("discordId");
CREATE UNIQUE INDEX "DiscordEventLink_guildId_sourceType_sourceId_key" ON "DiscordEventLink"("guildId", "sourceType", "sourceId");
