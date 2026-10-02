ALTER TABLE "CommunitySeason" ADD COLUMN "number" INTEGER;
ALTER TABLE "CommunitySeason" ADD COLUMN "announcementChannelId" TEXT;
ALTER TABLE "CommunityActivity" ADD COLUMN "postedChannelId" TEXT;

WITH numbered AS (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "guildId", "game" ORDER BY "createdAt", "id") AS n
  FROM "CommunitySeason"
)
UPDATE "CommunitySeason" s SET "number" = numbered.n FROM numbered WHERE s."id" = numbered."id";
ALTER TABLE "CommunitySeason" ALTER COLUMN "number" SET NOT NULL;
ALTER TABLE "CommunitySeason" ALTER COLUMN "number" SET DEFAULT 1;
ALTER TABLE "CommunitySeason" ADD CONSTRAINT "CommunitySeason_number_positive" CHECK ("number" > 0);
CREATE UNIQUE INDEX "CommunitySeason_guildId_game_number_key" ON "CommunitySeason"("guildId", "game", "number");

CREATE TABLE "CommunitySeasonCounter" (
  "guildId" TEXT NOT NULL,
  "game" TEXT NOT NULL,
  "nextNumber" INTEGER NOT NULL DEFAULT 1 CHECK ("nextNumber" > 0),
  PRIMARY KEY ("guildId", "game"),
  FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "CommunitySeasonCounter" ("guildId", "game", "nextNumber")
SELECT "guildId", "game", MAX("number") + 1 FROM "CommunitySeason" GROUP BY "guildId", "game";

-- Preserve the true location of existing posts before new routing is configured.
UPDATE "CommunityActivity" a SET "postedChannelId" = s."channelId"
FROM "CommunitySeason" s WHERE a."seasonId" = s."id" AND a."messageId" IS NOT NULL;
