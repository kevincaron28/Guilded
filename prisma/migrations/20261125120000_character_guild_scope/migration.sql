ALTER TABLE "Character" ADD COLUMN "guildId" TEXT;
UPDATE "Character" AS c SET "guildId" = m."guildId" FROM "Member" AS m WHERE m.id = c."memberId";
ALTER TABLE "Character" ALTER COLUMN "guildId" SET NOT NULL;
DROP INDEX "Character_gameEdition_realm_name_key";
CREATE UNIQUE INDEX "Character_guildId_gameEdition_realm_name_key" ON "Character"("guildId", "gameEdition", "realm", "name");
-- Enforce the duplicated tenant key even for scripts and direct SQL. Moving a
-- character to a member in another guild must never retain its former tenant.
CREATE FUNCTION guilded_character_scope() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  SELECT "guildId" INTO NEW."guildId" FROM "Member" WHERE id = NEW."memberId";
  IF NEW."guildId" IS NULL THEN RAISE EXCEPTION 'Character member does not exist'; END IF;
  IF NOT EXISTS (SELECT 1 FROM "Guild" WHERE id = NEW."guildId" AND "gameEdition" = NEW."gameEdition") THEN
    RAISE EXCEPTION 'Character edition does not match its guild';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER character_scope BEFORE INSERT OR UPDATE OF "memberId", "guildId", "gameEdition" ON "Character"
FOR EACH ROW EXECUTE FUNCTION guilded_character_scope();
