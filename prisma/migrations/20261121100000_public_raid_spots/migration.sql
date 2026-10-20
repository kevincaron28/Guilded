ALTER TABLE "Raid"
  ADD COLUMN "publicPug" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "pugRealm" TEXT,
  ADD COLUMN "pugFaction" TEXT,
  ADD COLUMN "pugLanguage" TEXT,
  ADD COLUMN "pugInviteUrl" TEXT;

ALTER TABLE "GuildSettings"
  ADD COLUMN "pugChannelId" TEXT,
  ADD COLUMN "pugMessageId" TEXT;

CREATE INDEX "Raid_publicPug_status_scheduledAt_idx" ON "Raid" ("publicPug", "status", "scheduledAt");

ALTER TABLE "WebAccount" ADD COLUMN "publicProfile" BOOLEAN NOT NULL DEFAULT true;
CREATE TABLE "WebCharacter" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "realm" TEXT NOT NULL,
  CONSTRAINT "WebCharacter_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "WebCharacter_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "WebAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "WebCharacter_accountId_name_realm_key" ON "WebCharacter" ("accountId", "name", "realm");
