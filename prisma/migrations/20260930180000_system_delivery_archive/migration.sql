ALTER TABLE "DungeonSeason" ADD COLUMN "finalStandings" JSONB, ADD COLUMN "rulesSnapshot" JSONB;
CREATE TABLE "DiscordJob" (
 "id" TEXT NOT NULL, "guildId" TEXT NOT NULL, "key" TEXT NOT NULL, "kind" TEXT NOT NULL,
 "payload" JSONB NOT NULL, "revision" INTEGER NOT NULL DEFAULT 1, "status" TEXT NOT NULL DEFAULT 'PENDING',
 "attempts" INTEGER NOT NULL DEFAULT 0, "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "leaseToken" TEXT, "lockedUntil" TIMESTAMP(3), "lastError" TEXT, "deliveredAt" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "DiscordJob_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "DiscordJob_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "DiscordJob_guildId_key_key" ON "DiscordJob"("guildId", "key");
CREATE INDEX "DiscordJob_status_nextAttemptAt_idx" ON "DiscordJob"("status", "nextAttemptAt");
