-- Guilded Clash live match clock (owner, 10 November 2026): milliseconds left per seat; null for asynchronous duels.
ALTER TABLE "TcgDuel" ADD COLUMN "clockA" INTEGER;
ALTER TABLE "TcgDuel" ADD COLUMN "clockB" INTEGER;
