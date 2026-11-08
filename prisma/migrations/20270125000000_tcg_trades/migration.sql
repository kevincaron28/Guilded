-- Guilded Clash stage D: guild-only card trading. Eligibility counters and switches, the server switch (on by default), and the trade audit log.
ALTER TABLE "TcgPlayer" ADD COLUMN "playedCounted" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "TcgPlayer" ADD COLUMN "tradingOff" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "TcgPlayer" ADD COLUMN "tradeBanned" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "GuildSettings" ADD COLUMN "tcgTradingEnabled" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "TcgTrade" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "fromUser" TEXT NOT NULL,
    "toUser" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "fromCards" JSONB NOT NULL,
    "toCards" JSONB NOT NULL,
    "fromValue" INTEGER NOT NULL DEFAULT 0,
    "toValue" INTEGER NOT NULL DEFAULT 0,
    "legendary" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'open',
    "fromConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "toConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "lockedUntil" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "flags" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    CONSTRAINT "TcgTrade_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TcgTrade_fromUser_createdAt_idx" ON "TcgTrade"("fromUser", "createdAt");
CREATE INDEX "TcgTrade_toUser_createdAt_idx" ON "TcgTrade"("toUser", "createdAt");
CREATE INDEX "TcgTrade_status_expiresAt_idx" ON "TcgTrade"("status", "expiresAt");
CREATE INDEX "TcgTrade_guildId_completedAt_idx" ON "TcgTrade"("guildId", "completedAt");

CREATE TABLE "TcgTradeEvent" (
    "id" TEXT NOT NULL,
    "tradeId" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "detail" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TcgTradeEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TcgTradeEvent_tradeId_createdAt_idx" ON "TcgTradeEvent"("tradeId", "createdAt");
