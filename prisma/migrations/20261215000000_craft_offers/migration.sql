-- Crafter offers: per-server opt-in (off by default), offers, and the link from a request to the offer it answers.
CREATE TYPE "CraftOfferStatus" AS ENUM ('ACTIVE', 'WITHDRAWN', 'EXPIRED');

ALTER TABLE "GuildSettings" ADD COLUMN "craftOffersEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CraftRequest" ADD COLUMN "offerId" TEXT;

CREATE TABLE "CraftOffer" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "crafterId" TEXT NOT NULL,
    "character" TEXT,
    "item" TEXT NOT NULL,
    "itemKey" INTEGER,
    "profession" TEXT,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "price" TEXT,
    "materialsProvided" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "threadId" TEXT,
    "status" "CraftOfferStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CraftOffer_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CraftOffer_guildId_status_expiresAt_idx" ON "CraftOffer"("guildId", "status", "expiresAt");
CREATE INDEX "CraftOffer_crafterId_createdAt_idx" ON "CraftOffer"("crafterId", "createdAt");

ALTER TABLE "CraftOffer" ADD CONSTRAINT "CraftOffer_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CraftOffer" ADD CONSTRAINT "CraftOffer_crafterId_fkey" FOREIGN KEY ("crafterId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
