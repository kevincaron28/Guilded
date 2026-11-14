-- Records a companion carried for another player: applied once per record key, counted per carrier per day.
-- Undo: DROP TABLE "CarriedRecord";
CREATE TABLE "CarriedRecord" (
  "id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "author" TEXT NOT NULL,
  "carrier" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CarriedRecord_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CarriedRecord_kind_key_key" ON "CarriedRecord"("kind", "key");
CREATE INDEX "CarriedRecord_carrier_createdAt_idx" ON "CarriedRecord"("carrier", "createdAt");
