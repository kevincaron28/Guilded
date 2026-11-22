-- Guild bank donor card backfill (owner, 22 Nov 2026): every member who deposited before the donor cards existed is thanked once,
-- one card at a time (bank-donations.ts backfillBankDonations). The backlog is every deposit line the 20270313090000 migration stamped
-- seen: stamped no later than that migration finished. Lines the live cards handled were stamped after it, so they are left alone.
ALTER TABLE "GuildBankTransaction" ADD COLUMN "donationBackfill" BOOLEAN NOT NULL DEFAULT false;
UPDATE "GuildBankTransaction" SET "donationBackfill" = true
WHERE lower("type") = 'deposit' AND "kind" IN ('item', 'money') AND "donationSeenAt" IS NOT NULL
  AND "donationSeenAt" <= COALESCE((SELECT max("finished_at") FROM "_prisma_migrations" WHERE "migration_name" = '20270313090000_bank_donation_cards'), '-infinity'::timestamp);
CREATE INDEX "GuildBankTransaction_guildId_donationBackfill_idx" ON "GuildBankTransaction"("guildId", "donationBackfill");
