-- Existing weekly teams retain their behavior; BG planning is opt-in.
ALTER TABLE "ActivityCore" ADD COLUMN "battlegroundPlan" JSONB;
