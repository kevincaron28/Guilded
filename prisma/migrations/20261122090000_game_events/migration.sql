CREATE TABLE "OfficialGameEvent" (
  "id" TEXT PRIMARY KEY,
  "game" TEXT NOT NULL CHECK ("game" IN ('WOW_FOREVER', 'POE2')),
  "region" TEXT NOT NULL DEFAULT 'GLOBAL' CHECK ("region" IN ('GLOBAL', 'NA', 'EU', 'KR', 'TW')),
  "titleEn" TEXT NOT NULL, "titleFr" TEXT NOT NULL,
  "dateLabelEn" TEXT NOT NULL DEFAULT '', "dateLabelFr" TEXT NOT NULL DEFAULT '',
  "sourceUrl" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'TBA' CHECK ("state" IN ('SCHEDULED', 'TBA', 'POSTPONED', 'CANCELLED', 'REACHED')),
  "startsAt" TIMESTAMPTZ(3),
  "scheduleVersion" INTEGER NOT NULL DEFAULT 1,
  "archived" BOOLEAN NOT NULL DEFAULT false,
  "updatedBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OfficialGameEvent_time_check" CHECK (
    ("state" IN ('SCHEDULED', 'REACHED') AND "startsAt" IS NOT NULL) OR
    ("state" IN ('TBA', 'POSTPONED', 'CANCELLED') AND "startsAt" IS NULL))
);
CREATE TABLE "GameEventBoard" (
  "id" TEXT PRIMARY KEY, "guildId" TEXT NOT NULL, "channelId" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "games" TEXT[] NOT NULL, "region" TEXT NOT NULL,
  "messageId" TEXT, "contentHash" TEXT, "wowRoleId" TEXT, "poeRoleId" TEXT,
  "wowReminders" INTEGER[] NOT NULL DEFAULT '{}', "poeReminders" INTEGER[] NOT NULL DEFAULT '{}',
  "wowRemindersEnabledAt" TIMESTAMPTZ(3), "poeRemindersEnabledAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GameEventBoard_guildId_fkey" FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "GameEventBoard_guildId_channelId_key" ON "GameEventBoard"("guildId", "channelId");

-- Sources verified 2026-10-21; regions differ. Dates without hours never get midnight placeholders.
INSERT INTO "OfficialGameEvent" ("id", "game", "region", "titleEn", "titleFr", "sourceUrl", "state", "startsAt", "updatedBy", "updatedAt") VALUES
('wow-forever-names-na', 'WOW_FOREVER', 'NA', 'Name reservation · North America', 'Réservation des noms · Amérique du Nord', 'https://news.blizzard.com/en-us/article/24303866/claim-your-world-of-warcraft-forever-character-names', 'SCHEDULED', '2026-10-27T20:00:00Z', 'official-source-seed', CURRENT_TIMESTAMP),
('wow-forever-names-eu', 'WOW_FOREVER', 'EU', 'Name reservation · Europe', 'Réservation des noms · Europe', 'https://news.blizzard.com/en-us/article/24303866/claim-your-world-of-warcraft-forever-character-names', 'SCHEDULED', '2026-10-27T17:00:00Z', 'official-source-seed', CURRENT_TIMESTAMP),
('wow-forever-names-kr', 'WOW_FOREVER', 'KR', 'Name reservation · Korea', 'Réservation des noms · Corée', 'https://news.blizzard.com/en-us/article/24303866/claim-your-world-of-warcraft-forever-character-names', 'SCHEDULED', '2026-10-27T22:00:00Z', 'official-source-seed', CURRENT_TIMESTAMP),
('wow-forever-names-tw', 'WOW_FOREVER', 'TW', 'Name reservation · Taiwan', 'Réservation des noms · Taïwan', 'https://news.blizzard.com/en-us/article/24303866/claim-your-world-of-warcraft-forever-character-names', 'SCHEDULED', '2026-10-27T23:00:00Z', 'official-source-seed', CURRENT_TIMESTAMP),
('wow-forever-launch', 'WOW_FOREVER', 'GLOBAL', 'Global launch', 'Lancement mondial', 'https://news.blizzard.com/en-us/article/24303862/world-of-warcraft-forever-whats-next-panel-recap', 'SCHEDULED', '2026-11-04T23:00:00Z', 'official-source-seed', CURRENT_TIMESTAMP);
INSERT INTO "OfficialGameEvent" ("id", "game", "titleEn", "titleFr", "dateLabelEn", "dateLabelFr", "sourceUrl", "updatedBy", "updatedAt") VALUES
('poe2-full-release', 'POE2', 'Full release (1.0)', 'Sortie complète (1.0)', '11 December 2026 (PST) · time TBA', '11 décembre 2026 (PST) · heure à confirmer', 'https://www.pathofexile.com/forum/view-thread/3999366', 'official-source-seed', CURRENT_TIMESTAMP);
