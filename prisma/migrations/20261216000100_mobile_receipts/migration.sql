ALTER TABLE "MobileDevice" ADD COLUMN "generation" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "MobileDevice" ADD COLUMN "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "MobileDelivery" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 ADD COLUMN "expiresAt" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP + interval '1 day'),
 ADD COLUMN "generation" INTEGER NOT NULL DEFAULT 0,
 ADD COLUMN "receiptId" TEXT,
 ADD COLUMN "receiptCheckAt" TIMESTAMP(3),
 ADD COLUMN "tokenHash" TEXT;
CREATE INDEX "MobileDelivery_receiptCheckAt_idx" ON "MobileDelivery"("receiptCheckAt");
CREATE INDEX "MobileDelivery_status_expiresAt_idx" ON "MobileDelivery"("status", "expiresAt");
CREATE INDEX "MobileDelivery_createdAt_idx" ON "MobileDelivery"("createdAt");
CREATE INDEX "MobileDevice_enabled_checkedAt_idx" ON "MobileDevice"("enabled", "checkedAt");
