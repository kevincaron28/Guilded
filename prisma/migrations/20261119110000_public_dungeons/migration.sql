-- 7.0: personal companion accounts and the public dungeon leaderboards (roadmap request 6).
ALTER TABLE "GuildSettings" ADD COLUMN "publicDungeonRuns" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "WebPairing" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WebPairing_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WebPairing_accountId_key" ON "WebPairing"("accountId");
CREATE UNIQUE INDEX "WebPairing_codeHash_key" ON "WebPairing"("codeHash");
ALTER TABLE "WebPairing" ADD CONSTRAINT "WebPairing_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "WebAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "WebCompanionCredential" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    CONSTRAINT "WebCompanionCredential_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WebCompanionCredential_tokenHash_key" ON "WebCompanionCredential"("tokenHash");
CREATE INDEX "WebCompanionCredential_accountId_revokedAt_idx" ON "WebCompanionCredential"("accountId", "revokedAt");
ALTER TABLE "WebCompanionCredential" ADD CONSTRAINT "WebCompanionCredential_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "WebAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PublicRun" (
    "id" TEXT NOT NULL,
    "runKey" TEXT NOT NULL,
    "runRef" TEXT NOT NULL,
    "instanceId" INTEGER NOT NULL,
    "dungeonName" TEXT NOT NULL,
    "difficultyId" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3) NOT NULL,
    "durationSec" INTEGER NOT NULL,
    "deaths" INTEGER,
    "maxLevel" INTEGER,
    "bracket" TEXT,
    "season" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACCEPTED',
    "confirmations" INTEGER NOT NULL DEFAULT 1,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PublicRun_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PublicRun_runKey_key" ON "PublicRun"("runKey");
CREATE INDEX "PublicRun_instanceId_status_season_durationSec_idx" ON "PublicRun"("instanceId", "status", "season", "durationSec");
CREATE INDEX "PublicRun_status_endedAt_idx" ON "PublicRun"("status", "endedAt");

CREATE TABLE "PublicRunPlayer" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "character" TEXT NOT NULL,
    "realm" TEXT NOT NULL DEFAULT '',
    "className" TEXT,
    "role" TEXT,
    "level" INTEGER,
    "deaths" INTEGER,
    CONSTRAINT "PublicRunPlayer_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PublicRunPlayer_runId_character_realm_key" ON "PublicRunPlayer"("runId", "character", "realm");
CREATE INDEX "PublicRunPlayer_character_realm_idx" ON "PublicRunPlayer"("character", "realm");
ALTER TABLE "PublicRunPlayer" ADD CONSTRAINT "PublicRunPlayer_runId_fkey" FOREIGN KEY ("runId") REFERENCES "PublicRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PublicRunUpload" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "uploaderKey" TEXT NOT NULL,
    "durationSec" INTEGER NOT NULL,
    "endedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PublicRunUpload_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PublicRunUpload_runId_uploaderKey_key" ON "PublicRunUpload"("runId", "uploaderKey");
CREATE INDEX "PublicRunUpload_uploaderKey_createdAt_idx" ON "PublicRunUpload"("uploaderKey", "createdAt");
ALTER TABLE "PublicRunUpload" ADD CONSTRAINT "PublicRunUpload_runId_fkey" FOREIGN KEY ("runId") REFERENCES "PublicRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
