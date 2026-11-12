-- Guild-invite channel cleanup: about an hour after a request is handled (a full first+last name match, or an officer's
-- action) the bot removes the request message and its own follow-ups, through the Discord job queue.
ALTER TABLE "InviteRequest" ADD COLUMN "cleanedAt" TIMESTAMP(3);
ALTER TABLE "InviteRequest" ADD COLUMN "cleanupAt" TIMESTAMP(3);
ALTER TABLE "InviteRequest" ADD COLUMN "cleanTries" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "InviteRequest" ADD COLUMN "doneNoteMessageId" TEXT;
ALTER TABLE "GuildSettings" ADD COLUMN "inviteCleanupEnabled" BOOLEAN NOT NULL DEFAULT true;
-- Going forward only: requests handled before this update are left as they are (nothing is purged on deploy).
UPDATE "InviteRequest" SET "cleanedAt" = NOW() WHERE "status" <> 'PENDING';
