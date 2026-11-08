-- Guilded Clash stage E: player-vs-player. Friendly challenges between guildmates, the ranked ladder (hidden Glicko-2 rating plus
-- visible stars per monthly season) and the ranked waiting room.
CREATE TABLE "TcgDuel" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "guildId" TEXT,
    "userA" TEXT NOT NULL,
    "userB" TEXT NOT NULL,
    "clsA" TEXT NOT NULL,
    "clsB" TEXT,
    "live" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "season" TEXT NOT NULL DEFAULT '',
    "seed" INTEGER NOT NULL DEFAULT 0,
    "deckA" JSONB,
    "deckB" JSONB,
    "actions" JSONB NOT NULL DEFAULT '[]',
    "state" JSONB,
    "stateHash" TEXT NOT NULL DEFAULT '',
    "winner" INTEGER,
    "reason" TEXT,
    "spellsA" INTEGER NOT NULL DEFAULT 0,
    "zonesA" INTEGER NOT NULL DEFAULT 0,
    "spellsB" INTEGER NOT NULL DEFAULT 0,
    "zonesB" INTEGER NOT NULL DEFAULT 0,
    "counted" BOOLEAN NOT NULL DEFAULT false,
    "rated" BOOLEAN NOT NULL DEFAULT false,
    "flags" JSONB NOT NULL DEFAULT '[]',
    "result" JSONB,
    "turnSeconds" INTEGER NOT NULL DEFAULT 86400,
    "turnDeadlineAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "lastActionAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    CONSTRAINT "TcgDuel_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TcgDuel_userA_status_idx" ON "TcgDuel"("userA", "status");
CREATE INDEX "TcgDuel_userB_status_idx" ON "TcgDuel"("userB", "status");
CREATE INDEX "TcgDuel_kind_status_finishedAt_idx" ON "TcgDuel"("kind", "status", "finishedAt");
CREATE INDEX "TcgDuel_guildId_kind_finishedAt_idx" ON "TcgDuel"("guildId", "kind", "finishedAt");
CREATE INDEX "TcgDuel_status_expiresAt_idx" ON "TcgDuel"("status", "expiresAt");
CREATE INDEX "TcgDuel_status_turnDeadlineAt_idx" ON "TcgDuel"("status", "turnDeadlineAt");

CREATE TABLE "TcgRating" (
    "discordUserId" TEXT NOT NULL,
    "season" TEXT NOT NULL,
    "rating" DOUBLE PRECISION NOT NULL DEFAULT 1500,
    "rd" DOUBLE PRECISION NOT NULL DEFAULT 350,
    "vol" DOUBLE PRECISION NOT NULL DEFAULT 0.06,
    "stars" INTEGER NOT NULL DEFAULT 0,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "streak" INTEGER NOT NULL DEFAULT 0,
    "games" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TcgRating_pkey" PRIMARY KEY ("discordUserId", "season")
);

CREATE INDEX "TcgRating_season_stars_idx" ON "TcgRating"("season", "stars");
CREATE INDEX "TcgRating_season_rating_idx" ON "TcgRating"("season", "rating");

CREATE TABLE "TcgQueue" (
    "discordUserId" TEXT NOT NULL,
    "cls" TEXT NOT NULL,
    "rating" DOUBLE PRECISION NOT NULL,
    "rd" DOUBLE PRECISION NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TcgQueue_pkey" PRIMARY KEY ("discordUserId")
);

CREATE INDEX "TcgQueue_joinedAt_idx" ON "TcgQueue"("joinedAt");
