-- The faction the uploader client reported for each public run player (9.3.6); outside guilds derive their faction from it.
ALTER TABLE "PublicRunPlayer" ADD COLUMN "faction" TEXT;
