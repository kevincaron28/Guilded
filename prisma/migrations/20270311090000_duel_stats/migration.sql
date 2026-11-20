-- Per-duel numbers measured by each participant's own addon; all optional.
ALTER TABLE "DuelResult"
  ADD COLUMN "durationSec" INTEGER,
  ADD COLUMN "winnerHealthLeft" INTEGER,
  ADD COLUMN "loserHealthLeft" INTEGER,
  ADD COLUMN "winnerDamageTaken" INTEGER,
  ADD COLUMN "loserDamageTaken" INTEGER,
  ADD COLUMN "winnerHealing" INTEGER,
  ADD COLUMN "loserHealing" INTEGER,
  ADD COLUMN "winnerLowestHealth" INTEGER,
  ADD COLUMN "loserLowestHealth" INTEGER;
