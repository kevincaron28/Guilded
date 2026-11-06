-- 8.5 light recruiting kit: recruit record fields, interview questions, recruiting post template with a shared cooldown.
ALTER TABLE "InviteRequest" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'discord';
ALTER TABLE "InviteRequest" ADD COLUMN "note" TEXT;
ALTER TABLE "InviteRequest" ADD COLUMN "answers" TEXT;

ALTER TABLE "GuildSettings" ADD COLUMN "inviteQuestions" JSONB;
ALTER TABLE "GuildSettings" ADD COLUMN "inviteGuideMessageId" TEXT;
ALTER TABLE "GuildSettings" ADD COLUMN "recruitPostTemplate" TEXT;
ALTER TABLE "GuildSettings" ADD COLUMN "recruitCooldownHours" INTEGER NOT NULL DEFAULT 72;
ALTER TABLE "GuildSettings" ADD COLUMN "recruitLastPostAt" TIMESTAMP(3);
ALTER TABLE "GuildSettings" ADD COLUMN "recruitLastPostBy" TEXT;
ALTER TABLE "GuildSettings" ADD COLUMN "recruitRemindedAt" TIMESTAMP(3);
