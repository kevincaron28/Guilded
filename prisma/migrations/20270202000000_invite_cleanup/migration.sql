-- Guild-invite channel cleanup: about an hour after a request is handled the bot removes the request message and
-- its own follow-ups. cleanedAt is set once the attempt was made (done, already gone, or refused), so it never repeats.
ALTER TABLE "InviteRequest" ADD COLUMN "cleanedAt" TIMESTAMP(3);
ALTER TABLE "GuildSettings" ADD COLUMN "inviteCleanupEnabled" BOOLEAN NOT NULL DEFAULT true;
