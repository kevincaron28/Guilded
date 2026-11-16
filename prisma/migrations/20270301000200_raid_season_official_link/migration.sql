-- A raid attendance season can follow the owner-only official season calendar (owner decision, 16 November 2026): the number of the official season it was started for, null for seasons an officer started by hand.
ALTER TABLE "RaidSeason" ADD COLUMN "officialSeasonNumber" INTEGER;
