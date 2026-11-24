-- Phone app 0.6.0: per-phone switches for the two new push kinds (a guildmate's call for help, a raid spot opening up).
-- Additive: both default to on, so phones that already have push on keep working without sending anything new.
ALTER TABLE "MobileDevice" ADD COLUMN "helpCalls" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "MobileDevice" ADD COLUMN "raidSpots" BOOLEAN NOT NULL DEFAULT true;
