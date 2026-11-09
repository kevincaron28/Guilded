-- The duel ladder moves to its own channel; the battleground ladder keeps the statistics channel.
ALTER TABLE "GuildSettings" ADD COLUMN "duelBoardChannelId" TEXT;
