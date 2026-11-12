-- Game reminders: private messages to members who have not picked a game.
ALTER TABLE "MemberOnboarding"
  ADD COLUMN "reminderCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "lastReminderAt" TIMESTAMP(3),
  ADD COLUMN "lastReminderSource" TEXT,
  ADD COLUMN "lastSentAt" TIMESTAMP(3),
  ADD COLUMN "remindersStopped" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "dmClosedAt" TIMESTAMP(3);

-- The one reminder the old onboarding nudge already sent counts as the first automatic one.
UPDATE "MemberOnboarding"
  SET "reminderCount" = 1, "lastReminderAt" = "nudgedAt", "lastReminderSource" = 'AUTO', "lastSentAt" = "nudgedAt"
  WHERE "nudgedAt" IS NOT NULL;
