-- Game reminders: private messages to members who have not picked a game.
ALTER TABLE "MemberOnboarding"
  ADD COLUMN "reminderCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastReminderAt" TIMESTAMP(3),
  ADD COLUMN "lastReminderSource" TEXT,
  ADD COLUMN "lastSentAt" TIMESTAMP(3),
  ADD COLUMN "remindersStopped" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "dmClosedAt" TIMESTAMP(3);

-- Their own automatic switch (off by default) and the time of the last "remind all".
ALTER TABLE "GuildSettings"
  ADD COLUMN "gameReminderAuto" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "gameRemindAllAt" TIMESTAMP(3);
