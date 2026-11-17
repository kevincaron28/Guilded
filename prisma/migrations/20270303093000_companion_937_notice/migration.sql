-- (9.3.8) One-DM-per-user notice marker (companion-937-notice.ts).
CREATE TABLE "CompanionNotice" (
    "id" TEXT NOT NULL,
    "discordUserId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "outcome" TEXT NOT NULL DEFAULT 'sending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanionNotice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CompanionNotice_discordUserId_kind_key" ON "CompanionNotice"("discordUserId", "kind");
