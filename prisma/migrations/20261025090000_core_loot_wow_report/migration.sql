ALTER TABLE "GuildSettings" ADD COLUMN "weeklyReportChannelId" TEXT,
  ADD COLUMN "coreLootOnly" BOOLEAN NOT NULL DEFAULT false;
