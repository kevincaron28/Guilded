-- 9.1 crafting channels and crafter pings (owner, 7 November 2026).
ALTER TABLE "GuildSettings" ADD COLUMN "craftOrdersChannelId" TEXT,
  ADD COLUMN "craftArchiveChannelId" TEXT,
  ADD COLUMN "craftOrdersEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "craftPingsEnabled" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "CraftRequest" ADD COLUMN "orderMessageId" TEXT,
  ADD COLUMN "archiveMessageId" TEXT;

CREATE TABLE "CraftNotify" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "profession" TEXT NOT NULL,
    "lastPingAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CraftNotify_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CraftNotify_memberId_profession_key" ON "CraftNotify"("memberId", "profession");
CREATE INDEX "CraftNotify_guildId_profession_idx" ON "CraftNotify"("guildId", "profession");
