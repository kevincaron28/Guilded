-- Duel scoring by level difference: the two players' levels when the duel was imported (null for older duels, which score the base amount).
ALTER TABLE "DuelResult" ADD COLUMN "winnerLevel" INTEGER, ADD COLUMN "loserLevel" INTEGER;
