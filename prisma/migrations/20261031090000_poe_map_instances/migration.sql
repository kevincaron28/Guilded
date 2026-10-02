-- Optional: companions before 5.0 instance grouping send no instanceRef.
ALTER TABLE "PoeMapVisit" ADD COLUMN "instanceRef" TEXT;
ALTER TABLE "PoeMapVisit" ADD CONSTRAINT "PoeMapVisit_instanceRef_check" CHECK ("instanceRef" IS NULL OR "instanceRef" ~ '^[a-f0-9]{64}$');
