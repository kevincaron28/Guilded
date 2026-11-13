-- Poisons joins the one-name table (13 November 2026; production already held "Poisons" rows). Same steps as
-- 20270130000000_canonical_profession_names, for the spellings that migration did not list; tests/profession-names.test.ts
-- keeps the two lists together equal to src/services/profession-names.ts. Idempotent.
CREATE TEMP TABLE "_profession_names" ("spelling" TEXT PRIMARY KEY, "canonical" TEXT NOT NULL);
INSERT INTO "_profession_names" ("spelling", "canonical") VALUES
  ('poisons', 'Poisons'),
  ('gifte', 'Poisons'),
  ('venenos', 'Poisons'),
  ('veleni', 'Poisons'),
  ('яды', 'Poisons')
;

-- ProfessionSkill: one row per character and profession (highest skill kept).
CREATE TEMP TABLE "_ps" AS
SELECT ps."id", COALESCE(pn."canonical", ps."profession") AS "canonical",
  row_number() OVER (PARTITION BY ps."characterId", COALESCE(pn."canonical", ps."profession")
    ORDER BY ps."skillLevel" DESC, (ps."profession" = COALESCE(pn."canonical", ps."profession")) DESC, ps."updatedAt" DESC, ps."id") AS "rn"
FROM "ProfessionSkill" ps LEFT JOIN "_profession_names" pn ON lower(btrim(ps."profession")) = pn."spelling";
DELETE FROM "ProfessionSkill" WHERE "id" IN (SELECT "id" FROM "_ps" WHERE "rn" > 1);
UPDATE "ProfessionSkill" ps SET "profession" = _ps."canonical" FROM "_ps" _ps WHERE ps."id" = _ps."id" AND ps."profession" <> _ps."canonical";
DROP TABLE "_ps";

-- RecipeKnown: unique per character and recipe, so a rename cannot collide.
UPDATE "RecipeKnown" r SET "profession" = pn."canonical" FROM "_profession_names" pn
WHERE lower(btrim(r."profession")) = pn."spelling" AND r."profession" <> pn."canonical";

-- ProfessionCooldown: one row per character, profession and cooldown (the newest scan kept).
CREATE TEMP TABLE "_pc" AS
SELECT c."id", COALESCE(pn."canonical", c."profession") AS "canonical",
  row_number() OVER (PARTITION BY c."guildId", c."character", c."realm", COALESCE(pn."canonical", c."profession"), c."name"
    ORDER BY c."scannedAt" DESC, (c."profession" = COALESCE(pn."canonical", c."profession")) DESC, c."id") AS "rn"
FROM "ProfessionCooldown" c LEFT JOIN "_profession_names" pn ON lower(btrim(c."profession")) = pn."spelling";
DELETE FROM "ProfessionCooldown" WHERE "id" IN (SELECT "id" FROM "_pc" WHERE "rn" > 1);
UPDATE "ProfessionCooldown" c SET "profession" = _pc."canonical" FROM "_pc" _pc WHERE c."id" = _pc."id" AND c."profession" <> _pc."canonical";
DROP TABLE "_pc";

-- CraftNotify: one ping preference per member and profession.
CREATE TEMP TABLE "_cn" AS
SELECT n."id", COALESCE(pn."canonical", n."profession") AS "canonical",
  row_number() OVER (PARTITION BY n."memberId", COALESCE(pn."canonical", n."profession")
    ORDER BY n."lastPingAt" DESC NULLS LAST, (n."profession" = COALESCE(pn."canonical", n."profession")) DESC, n."id") AS "rn"
FROM "CraftNotify" n LEFT JOIN "_profession_names" pn ON lower(btrim(n."profession")) = pn."spelling";
DELETE FROM "CraftNotify" WHERE "id" IN (SELECT "id" FROM "_cn" WHERE "rn" > 1);
UPDATE "CraftNotify" n SET "profession" = _cn."canonical" FROM "_cn" _cn WHERE n."id" = _cn."id" AND n."profession" <> _cn."canonical";
DROP TABLE "_cn";

-- Craft offers, requests and completions only name a profession (no unique key on it).
UPDATE "CraftOffer" o SET "profession" = pn."canonical" FROM "_profession_names" pn
WHERE o."profession" IS NOT NULL AND lower(btrim(o."profession")) = pn."spelling" AND o."profession" <> pn."canonical";
UPDATE "CraftRequest" r SET "profession" = pn."canonical" FROM "_profession_names" pn
WHERE r."profession" IS NOT NULL AND lower(btrim(r."profession")) = pn."spelling" AND r."profession" <> pn."canonical";
UPDATE "CraftCompletion" c SET "profession" = pn."canonical" FROM "_profession_names" pn
WHERE c."profession" IS NOT NULL AND lower(btrim(c."profession")) = pn."spelling" AND c."profession" <> pn."canonical";

-- UnclaimedCharacter.professions is a JSON list of { name, skillLevel }: rename and merge duplicates by highest skill.
UPDATE "UnclaimedCharacter" u SET "professions" = (
  SELECT COALESCE(jsonb_agg(jsonb_build_object('name', merged."name", 'skillLevel', merged."skill") ORDER BY merged."name"), '[]'::jsonb)
  FROM (
    SELECT COALESCE(pn."canonical", e.elem ->> 'name') AS "name",
      max(CASE WHEN (e.elem ->> 'skillLevel') ~ '^[0-9]{1,5}$' THEN (e.elem ->> 'skillLevel')::int ELSE 0 END) AS "skill"
    FROM jsonb_array_elements(u."professions") AS e(elem)
    LEFT JOIN "_profession_names" pn ON lower(btrim(e.elem ->> 'name')) = pn."spelling"
    WHERE e.elem ->> 'name' IS NOT NULL
    GROUP BY COALESCE(pn."canonical", e.elem ->> 'name')
  ) merged
)
WHERE jsonb_typeof(u."professions") = 'array' AND EXISTS (
  SELECT 1 FROM jsonb_array_elements(u."professions") AS e(elem)
  JOIN "_profession_names" pn ON lower(btrim(e.elem ->> 'name')) = pn."spelling"
  WHERE e.elem ->> 'name' <> pn."canonical");

DROP TABLE "_profession_names";
