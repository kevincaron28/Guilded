-- 9.1 craft history, crafter points and the Top crafters ladder (owner, 7 November 2026).
ALTER TABLE "GuildSettings" ADD COLUMN "craftLadderEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "craftLadderChannelId" TEXT,
  ADD COLUMN "craftLadderMessageId" TEXT;

CREATE TABLE "CraftCompletion" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "crafterId" TEXT NOT NULL,
    "item" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "profession" TEXT,
    "source" TEXT NOT NULL DEFAULT 'board',
    "requestId" TEXT,
    "points" INTEGER NOT NULL DEFAULT 1,
    "doneAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CraftCompletion_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CraftCompletion_requestId_key" ON "CraftCompletion"("requestId");
CREATE INDEX "CraftCompletion_guildId_doneAt_idx" ON "CraftCompletion"("guildId", "doneAt");
CREATE INDEX "CraftCompletion_crafterId_idx" ON "CraftCompletion"("crafterId");

-- History starts with every craft already finished on the board.
INSERT INTO "CraftCompletion" ("id", "guildId", "crafterId", "item", "quantity", "profession", "source", "requestId", "points", "doneAt")
SELECT 'cc_' || "id", "guildId", "crafterId", "item", "quantity", "profession", 'board', "id", 1, COALESCE("doneAt", "updatedAt")
FROM "CraftRequest" WHERE "status" = 'DONE' AND "crafterId" IS NOT NULL;
