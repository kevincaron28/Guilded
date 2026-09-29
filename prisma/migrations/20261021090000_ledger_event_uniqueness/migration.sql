-- Existing duplicates require a reviewed accounting correction; never silently delete points.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "EpgpTransaction" WHERE "sourceRef" IS NOT NULL GROUP BY "guildId", "sourceRef" HAVING count(*) > 1)
     OR EXISTS (SELECT 1 FROM "DkpTransaction" WHERE "sourceRef" IS NOT NULL GROUP BY "guildId", "sourceRef" HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Duplicate ledger event references exist. Run npm run release:ledger-check and review before retrying this migration.';
  END IF;
END $$;
CREATE UNIQUE INDEX "EpgpTransaction_guildId_sourceRef_key" ON "EpgpTransaction"("guildId", "sourceRef");
CREATE UNIQUE INDEX "DkpTransaction_guildId_sourceRef_key" ON "DkpTransaction"("guildId", "sourceRef");
