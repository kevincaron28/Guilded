-- One row per bot message of a profession forum thread: one message per recipe category part, edited in place.
CREATE TABLE "ProfessionPostMessage" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "profession" TEXT NOT NULL,
    "slot" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProfessionPostMessage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProfessionPostMessage_guildId_profession_slot_key" ON "ProfessionPostMessage"("guildId", "profession", "slot");

ALTER TABLE "ProfessionPostMessage" ADD CONSTRAINT "ProfessionPostMessage_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;
