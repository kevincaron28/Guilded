-- Owner test-server mark: test servers stay out of public surfaces. Seeded for the owner's two test servers.
ALTER TABLE "Guild" ADD COLUMN "isTestServer" BOOLEAN NOT NULL DEFAULT false;
UPDATE "Guild" SET "isTestServer" = true WHERE "discordId" IN ('1563959517337747556', '1560962282178093169');
