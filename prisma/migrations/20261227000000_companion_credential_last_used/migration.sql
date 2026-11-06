-- When each companion device last synced: the website's "Last synced" line (src/services/link-status.ts).
ALTER TABLE "CompanionCredential" ADD COLUMN "lastUsedAt" TIMESTAMP(3);
ALTER TABLE "WebCompanionCredential" ADD COLUMN "lastUsedAt" TIMESTAMP(3);
