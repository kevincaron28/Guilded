-- Discord-only item previews: per-server opt-in, webhook URL stored encrypted.
CREATE TABLE "ItemPreviewConfig" (
    "id" TEXT NOT NULL,
    "discordGuildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "webhookId" TEXT NOT NULL,
    "webhookSealed" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "disabledReason" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ItemPreviewConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ItemPreviewConfig_discordGuildId_key" ON "ItemPreviewConfig"("discordGuildId");
