-- Monthly dungeon seasons a guild opted into (src/services/dungeon-season-schedule.ts).
ALTER TABLE "GuildSettings" ADD COLUMN "dungeonSeasonSchedule" JSONB;
