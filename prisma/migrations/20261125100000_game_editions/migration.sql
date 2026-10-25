-- Preserve every existing ID, link and ledger; old records belong to Forever.
ALTER TABLE "Character" ADD COLUMN "gameEdition" TEXT NOT NULL DEFAULT 'forever';
ALTER TABLE "UnclaimedCharacter" ADD COLUMN "gameEdition" TEXT NOT NULL DEFAULT 'forever';
CREATE UNIQUE INDEX "Character_gameEdition_realm_name_key" ON "Character"("gameEdition", "realm", "name");
DROP INDEX "Character_realm_name_key";

-- In-game guilds belong to a Discord server; there is no server-wide edition.
-- Do not infer actual WoW guild names from Discord server names or move history.
CREATE TABLE "WowGuild" (
  "id" TEXT NOT NULL,
  "guildId" TEXT NOT NULL,
  "gameEdition" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "realm" TEXT NOT NULL,
  "nameKey" TEXT NOT NULL,
  "realmKey" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WowGuild_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WowGuild_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "WowGuild_guildId_gameEdition_realmKey_nameKey_key" ON "WowGuild"("guildId", "gameEdition", "realmKey", "nameKey");
CREATE INDEX "WowGuild_guildId_gameEdition_idx" ON "WowGuild"("guildId", "gameEdition");
