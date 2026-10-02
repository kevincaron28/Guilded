-- Addon rows that could not be imported yet are held instead of blocking the whole import.
CREATE TABLE "AddonHeldEntry" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sourceRef" TEXT NOT NULL,
    "character" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dismissedAt" TIMESTAMP(3),
    "dismissedBy" TEXT,

    CONSTRAINT "AddonHeldEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AddonHeldEntry_guildId_kind_sourceRef_key" ON "AddonHeldEntry"("guildId", "kind", "sourceRef");
CREATE INDEX "AddonHeldEntry_guildId_dismissedAt_lastSeenAt_idx" ON "AddonHeldEntry"("guildId", "dismissedAt", "lastSeenAt");

ALTER TABLE "AddonHeldEntry" ADD CONSTRAINT "AddonHeldEntry_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;
