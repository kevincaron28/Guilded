-- 9.1: "Reported, not verified" label (docs/JEEVES_COMPARISON.md idea 1). Null = only reported.
ALTER TABLE "Character" ADD COLUMN "confirmedAt" TIMESTAMP(3);
