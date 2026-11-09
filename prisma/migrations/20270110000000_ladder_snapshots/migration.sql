-- Daily leaderboard rank snapshots for the ladder cards' "since yesterday" arrows (pruned after 14 days).
CREATE TABLE "LadderSnapshot" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "board" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "ranks" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LadderSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LadderSnapshot_guildId_board_day_key" ON "LadderSnapshot"("guildId", "board", "day");

ALTER TABLE "LadderSnapshot" ADD CONSTRAINT "LadderSnapshot_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;
