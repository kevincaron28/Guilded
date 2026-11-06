-- WoW Forever characters are keyed by their full "First Last" name (8.5). Before, the addon sent
-- only the first name, so alts sharing a first name shared one row. This renames a first-name row
-- to the full name its own display name already carries, only when no other character of that
-- guild shares the first name. Ambiguous rows are left as they are (the bot still matches them
-- while unique, and the member's own next upload renames them; docs/FOREVER_NAMES.md lists the
-- query that shows what is left). No row is deleted, merged or moved to another member.

CREATE TEMP TABLE "_forever_rename" ("source" TEXT, "id" TEXT, "guildId" TEXT, "oldKey" TEXT, "newName" TEXT);

INSERT INTO "_forever_rename"
SELECT 'character', c."id", c."guildId", lower(trim(c."name")), regexp_replace(trim(c."displayName"), '\s+', ' ', 'g')
FROM "Character" c
WHERE c."gameEdition" = 'forever'
  AND position(' ' in trim(c."name")) = 0
  AND trim(c."displayName") ~ '^\S+\s+\S+$'
  AND lower(split_part(regexp_replace(trim(c."displayName"), '\s+', ' ', 'g'), ' ', 1)) = lower(trim(c."name"))
  AND NOT EXISTS (
    SELECT 1 FROM "Character" o
    WHERE o."guildId" = c."guildId" AND o."gameEdition" = 'forever' AND o."id" <> c."id"
      AND (lower(trim(o."name")) = lower(trim(c."name")) OR lower(trim(o."name")) LIKE lower(trim(c."name")) || ' %'));

INSERT INTO "_forever_rename"
SELECT 'unclaimed', u."id", u."guildId", u."nameKey", regexp_replace(trim(u."displayName"), '\s+', ' ', 'g')
FROM "UnclaimedCharacter" u
WHERE u."gameEdition" = 'forever'
  AND position(' ' in trim(u."name")) = 0
  AND trim(u."displayName") ~ '^\S+\s+\S+$'
  AND lower(split_part(regexp_replace(trim(u."displayName"), '\s+', ' ', 'g'), ' ', 1)) = u."nameKey"
  AND NOT EXISTS (
    SELECT 1 FROM "UnclaimedCharacter" o
    WHERE o."guildId" = u."guildId" AND o."id" <> u."id"
      AND (o."nameKey" = u."nameKey" OR o."nameKey" LIKE u."nameKey" || ' %'))
  AND NOT EXISTS (
    SELECT 1 FROM "Character" o
    WHERE o."guildId" = u."guildId" AND o."gameEdition" = 'forever'
      AND lower(trim(o."name")) LIKE u."nameKey" || ' %'
      AND lower(trim(o."name")) <> lower(regexp_replace(trim(u."displayName"), '\s+', ' ', 'g')));

-- Keys that follow the character's name.
UPDATE "CharacterVerifyClaim" v SET "nameKey" = lower(r."newName")
FROM "_forever_rename" r
WHERE r."source" = 'character' AND v."guildId" = r."guildId" AND v."nameKey" = r."oldKey"
  AND NOT EXISTS (SELECT 1 FROM "CharacterVerifyClaim" x WHERE x."guildId" = v."guildId" AND x."memberId" = v."memberId" AND x."nameKey" = lower(r."newName"));

UPDATE "LevelRaceEntry" e SET "nameKey" = lower(r."newName"), "name" = r."newName"
FROM (SELECT DISTINCT ON ("guildId", "oldKey") * FROM "_forever_rename" ORDER BY "guildId", "oldKey", "source") r
WHERE e."guildId" = r."guildId" AND e."nameKey" = r."oldKey"
  AND NOT EXISTS (SELECT 1 FROM "LevelRaceEntry" x WHERE x."guildId" = e."guildId" AND x."nameKey" = lower(r."newName"));

UPDATE "RaceHallEntry" e SET "nameKey" = lower(r."newName"), "name" = r."newName"
FROM (SELECT DISTINCT ON ("guildId", "oldKey") * FROM "_forever_rename" ORDER BY "guildId", "oldKey", "source") r
WHERE e."guildId" = r."guildId" AND e."nameKey" = r."oldKey"
  AND NOT EXISTS (SELECT 1 FROM "RaceHallEntry" x WHERE x."guildId" = e."guildId" AND x."nameKey" = lower(r."newName"));

UPDATE "UnclaimedCharacter" u SET "nameKey" = lower(r."newName"), "name" = r."newName"
FROM "_forever_rename" r
WHERE r."source" = 'unclaimed' AND u."id" = r."id"
  AND NOT EXISTS (SELECT 1 FROM "UnclaimedCharacter" x WHERE x."guildId" = u."guildId" AND x."nameKey" = lower(r."newName"));

UPDATE "Character" c SET "name" = r."newName"
FROM "_forever_rename" r
WHERE r."source" = 'character' AND c."id" = r."id"
  AND NOT EXISTS (SELECT 1 FROM "Character" x WHERE x."guildId" = c."guildId" AND x."gameEdition" = c."gameEdition" AND x."realm" = c."realm" AND x."name" = r."newName");

DROP TABLE "_forever_rename";
