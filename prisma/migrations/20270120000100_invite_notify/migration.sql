ALTER TABLE "GuildSettings" ADD COLUMN "inviteNotifyEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "InviteRequest" ADD COLUMN "notifiedAt" TIMESTAMP(3);
