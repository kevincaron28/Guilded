ALTER TABLE "OfficialGameEvent" DROP CONSTRAINT "OfficialGameEvent_game_check";
ALTER TABLE "OfficialGameEvent" ADD CONSTRAINT "OfficialGameEvent_game_check"
  CHECK ("game" IN ('WOW_FOREVER', 'WOW_CLASSIC_ERA', 'WOW_CLASSIC_TBC', 'WOW_CLASSIC_MISTS', 'WOW_RETAIL', 'POE2'));
-- Existing Forever / PoE opt-ins are retained. New edition reminders start off.
ALTER TABLE "GameEventBoard" ADD COLUMN "editionReminders" JSONB NOT NULL DEFAULT '{}';
