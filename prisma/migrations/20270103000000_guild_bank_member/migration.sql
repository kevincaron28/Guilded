-- 9.1 guild bank additions (docs/plans/GUILD_BANK.md): member search, request cards, minimum stock.
ALTER TABLE "BankRequest" ADD COLUMN "itemId" INTEGER,
  ADD COLUMN "source" TEXT NOT NULL DEFAULT 'discord',
  ADD COLUMN "clientRef" TEXT,
  ADD COLUMN "channelId" TEXT,
  ADD COLUMN "messageId" TEXT;
CREATE UNIQUE INDEX "BankRequest_guildId_clientRef_key" ON "BankRequest"("guildId", "clientRef");

ALTER TABLE "GuildSettings" ADD COLUMN "guildBankMemberSearch" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "guildBankRequestPosts" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "guildBankStockAlerts" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "bankRequestChannelId" TEXT;

CREATE TABLE "GuildBankTarget" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "itemId" INTEGER NOT NULL,
    "itemName" TEXT NOT NULL,
    "minCount" INTEGER NOT NULL,
    "lowSince" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GuildBankTarget_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "GuildBankTarget_guildId_itemId_key" ON "GuildBankTarget"("guildId", "itemId");
