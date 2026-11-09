-- TCG stage 1 (phone card collection, server side): the member's pack state, cards and an audit log, plus the server switch (on by default).
ALTER TABLE "GuildSettings" ADD COLUMN "tcgEnabled" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "TcgAccount" (
    "discordUserId" TEXT NOT NULL,
    "banked" INTEGER NOT NULL DEFAULT 1,
    "accruedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pityEpic" INTEGER NOT NULL DEFAULT 0,
    "pityLegendary" INTEGER NOT NULL DEFAULT 0,
    "dust" INTEGER NOT NULL DEFAULT 0,
    "packsOpened" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "TcgAccount_pkey" PRIMARY KEY ("discordUserId")
);

CREATE TABLE "TcgCard" (
    "discordUserId" TEXT NOT NULL,
    "cardKey" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TcgCard_pkey" PRIMARY KEY ("discordUserId","cardKey")
);

CREATE TABLE "TcgLog" (
    "id" TEXT NOT NULL,
    "discordUserId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "cards" JSONB NOT NULL,
    "dustDelta" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TcgLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TcgLog_discordUserId_createdAt_idx" ON "TcgLog"("discordUserId", "createdAt");
