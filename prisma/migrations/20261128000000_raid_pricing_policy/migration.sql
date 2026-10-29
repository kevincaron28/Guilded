ALTER TABLE "RaidCore" ADD COLUMN "pricingPolicy" JSONB,
    ADD COLUMN "pricingRevision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "LootAward" ADD COLUMN "pricingSnapshot" JSONB;
ALTER TABLE "RaidCore" ADD COLUMN "pricingAutoDecay" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "RaidCore" ADD COLUMN "lastPricingDecayAt" TIMESTAMP(3);
