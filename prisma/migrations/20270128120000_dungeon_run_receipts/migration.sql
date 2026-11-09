-- Every dungeon run ref an upload brought (stored, another observer's copy, or refused), so the
-- addon stops counting acknowledged runs as waiting (9.0.8).
CREATE TABLE "DungeonRunReceipt" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "runRef" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "reason" TEXT,
    "runId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "seenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DungeonRunReceipt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DungeonRunReceipt_guildId_runRef_key" ON "DungeonRunReceipt"("guildId", "runRef");
CREATE INDEX "DungeonRunReceipt_guildId_seenAt_idx" ON "DungeonRunReceipt"("guildId", "seenAt");

ALTER TABLE "DungeonRunReceipt" ADD CONSTRAINT "DungeonRunReceipt_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;
