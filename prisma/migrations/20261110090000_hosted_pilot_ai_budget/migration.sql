CREATE TABLE "AiDailyUsage" (
    "day" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "AiDailyUsage_pkey" PRIMARY KEY ("day", "scope"),
    CONSTRAINT "AiDailyUsage_attempts_nonnegative" CHECK ("attempts" >= 0)
);
