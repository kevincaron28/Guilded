-- "Records broken this week" post: opt-in (off by default), claimed once per weekly reset.
ALTER TABLE "GuildSettings" ADD COLUMN "weeklyRecordsEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "GuildSettings" ADD COLUMN "weeklyRecordsLastAt" TIMESTAMP(3);
