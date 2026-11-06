-- 9.0 guild bank ledger (docs/GUILD_BANK_LEDGER.md). Additive only.
ALTER TABLE "GuildSettings" ADD COLUMN "guildBankWeeklyEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "GuildSettings" ADD COLUMN "guildBankLastPostAt" TIMESTAMP(3);

CREATE TABLE "GuildBankContents" (
    "guildId" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "money" BIGINT,
    "tabs" JSONB NOT NULL,
    "reportedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GuildBankContents_pkey" PRIMARY KEY ("guildId")
);

CREATE TABLE "GuildBankGold" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "money" BIGINT NOT NULL,
    CONSTRAINT "GuildBankGold_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GuildBankGold_guildId_at_key" ON "GuildBankGold"("guildId", "at");

CREATE TABLE "GuildBankTransaction" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "itemId" INTEGER,
    "itemName" TEXT,
    "count" INTEGER,
    "tab" INTEGER,
    "tab2" INTEGER,
    "amount" BIGINT,
    "at" TIMESTAMP(3) NOT NULL,
    "reportedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GuildBankTransaction_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "GuildBankTransaction_guildId_at_idx" ON "GuildBankTransaction"("guildId", "at");
