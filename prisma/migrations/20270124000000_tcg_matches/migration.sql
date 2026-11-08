-- Guilded Clash stage C: stored matches (seed, decks, action log, current state), per-member pack progress and PvE run, and daily quest counters.
CREATE TABLE "TcgMatch" (
    "id" TEXT NOT NULL,
    "discordUserId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "aiLevel" TEXT NOT NULL,
    "bossId" TEXT,
    "seed" INTEGER NOT NULL,
    "playerDeck" JSONB NOT NULL,
    "opponentDeck" JSONB NOT NULL,
    "setup" JSONB NOT NULL,
    "actions" JSONB NOT NULL DEFAULT '[]',
    "state" JSONB NOT NULL,
    "stateHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "reason" TEXT,
    "spellsCast" INTEGER NOT NULL DEFAULT 0,
    "zonesPlayed" INTEGER NOT NULL DEFAULT 0,
    "turnSeconds" INTEGER NOT NULL DEFAULT 86400,
    "turnDeadlineAt" TIMESTAMP(3),
    "lastActionAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,
    "rewardedAt" TIMESTAMP(3),
    "rewardDust" INTEGER NOT NULL DEFAULT 0,
    "rewardPacks" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    CONSTRAINT "TcgMatch_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TcgMatch_discordUserId_createdAt_idx" ON "TcgMatch"("discordUserId", "createdAt");
CREATE INDEX "TcgMatch_discordUserId_status_idx" ON "TcgMatch"("discordUserId", "status");

CREATE TABLE "TcgPlayer" (
    "discordUserId" TEXT NOT NULL,
    "packProgress" INTEGER NOT NULL DEFAULT 0,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "pveCleared" INTEGER NOT NULL DEFAULT 0,
    "pveRuns" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TcgPlayer_pkey" PRIMARY KEY ("discordUserId")
);

CREATE TABLE "TcgDaily" (
    "discordUserId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "played" INTEGER NOT NULL DEFAULT 0,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "spells" INTEGER NOT NULL DEFAULT 0,
    "zones" INTEGER NOT NULL DEFAULT 0,
    "packsEarned" INTEGER NOT NULL DEFAULT 0,
    "questsDone" JSONB NOT NULL DEFAULT '[]',
    "bossesPaid" JSONB NOT NULL DEFAULT '[]',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TcgDaily_pkey" PRIMARY KEY ("discordUserId","day")
);
