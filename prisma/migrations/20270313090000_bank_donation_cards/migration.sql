-- Guild bank donation cards (21 Nov 2026): on by default, officers keep the off switch; an optional WoW chat channel shared
-- with the promotion cards; and a per-line marker so a deposit is announced at most once.
ALTER TABLE "GuildSettings" ADD COLUMN "guildBankDonationCards" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "GuildSettings" ADD COLUMN "wowChatChannelId" TEXT;
ALTER TABLE "GuildBankTransaction" ADD COLUMN "donationSeenAt" TIMESTAMP(3);
-- Start marker: every line stored before this feature counts as seen, so the backlog is never announced.
UPDATE "GuildBankTransaction" SET "donationSeenAt" = CURRENT_TIMESTAMP WHERE "donationSeenAt" IS NULL;
CREATE INDEX "GuildBankTransaction_guildId_donationSeenAt_idx" ON "GuildBankTransaction"("guildId", "donationSeenAt");
