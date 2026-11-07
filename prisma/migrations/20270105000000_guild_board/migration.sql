-- 9.1 in-game guild board (docs/GUILD_BOARD.md): officers' news posts and the officer off switch.
ALTER TABLE "GuildSettings" ADD COLUMN "guildBoardEnabled" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "BoardPost" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "authorId" TEXT,
    "memberId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'discord',
    "clientRef" TEXT,
    "channelId" TEXT,
    "messageId" TEXT,
    "removedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BoardPost_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BoardPost_guildId_clientRef_key" ON "BoardPost"("guildId", "clientRef");
CREATE INDEX "BoardPost_guildId_createdAt_idx" ON "BoardPost"("guildId", "createdAt");
ALTER TABLE "BoardPost" ADD CONSTRAINT "BoardPost_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;
