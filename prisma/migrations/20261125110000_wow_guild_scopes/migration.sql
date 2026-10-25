-- Existing guild IDs remain the default scope, preserving every FK and ledger.
ALTER TABLE "Guild" ADD COLUMN "scopeKey" TEXT NOT NULL DEFAULT 'default';
ALTER TABLE "Guild" ADD COLUMN "gameEdition" TEXT NOT NULL DEFAULT 'forever';
CREATE UNIQUE INDEX "Guild_discordId_scopeKey_key" ON "Guild"("discordId", "scopeKey");
DROP INDEX "Guild_discordId_key";
ALTER TABLE "WowGuild" ADD COLUMN "scopeGuildId" TEXT;
ALTER TABLE "WowGuild" ADD COLUMN "permissionRoles" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "WowGuild" ADD COLUMN "memberRoleId" TEXT;
CREATE UNIQUE INDEX "WowGuild_scopeGuildId_key" ON "WowGuild"("scopeGuildId");
ALTER TABLE "WowGuild" ADD CONSTRAINT "WowGuild_scopeGuildId_fkey" FOREIGN KEY ("scopeGuildId") REFERENCES "Guild"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE TABLE "WowGuildSelection" (
  "discordId" TEXT NOT NULL, "userId" TEXT NOT NULL, "scopeGuildId" TEXT NOT NULL,
  CONSTRAINT "WowGuildSelection_pkey" PRIMARY KEY ("discordId", "userId")
);
CREATE TABLE "WowGuildChannel" (
  "discordId" TEXT NOT NULL, "channelId" TEXT NOT NULL, "scopeGuildId" TEXT NOT NULL,
  CONSTRAINT "WowGuildChannel_pkey" PRIMARY KEY ("discordId", "channelId")
);
ALTER TABLE "WowGuildSelection" ADD CONSTRAINT "WowGuildSelection_scopeGuildId_fkey" FOREIGN KEY ("scopeGuildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WowGuildChannel" ADD CONSTRAINT "WowGuildChannel_scopeGuildId_fkey" FOREIGN KEY ("scopeGuildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;
