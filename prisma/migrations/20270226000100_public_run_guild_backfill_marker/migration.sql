-- Marks a public run the guild backfill has looked at (covered or not), so it is not scanned again on every start.
ALTER TABLE "PublicRun" ADD COLUMN "guildBackfillAt" TIMESTAMP(3);
