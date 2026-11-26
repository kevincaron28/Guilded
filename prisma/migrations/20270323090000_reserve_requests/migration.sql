-- Reserves asked for from Discord or the phone, waiting for the loot keeper's addon.
CREATE TABLE "ReserveRequest" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "character" TEXT NOT NULL,
    "realm" TEXT NOT NULL,
    "itemId" INTEGER,
    "itemName" TEXT NOT NULL,
    "remove" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReserveRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ReserveRequest_guildId_createdAt_idx" ON "ReserveRequest"("guildId", "createdAt");
CREATE INDEX "ReserveRequest_memberId_idx" ON "ReserveRequest"("memberId");

ALTER TABLE "ReserveRequest" ADD CONSTRAINT "ReserveRequest_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReserveRequest" ADD CONSTRAINT "ReserveRequest_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
