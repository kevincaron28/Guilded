import { config as loadDotenv } from "dotenv";
import { defineConfig } from "prisma/config";

// Prisma 7 reads no .env file by itself; Prisma 6 read .env. The npm scripts run the CLI through
// scripts/with-env.mjs, which loads .env.local then .env (and uses DIRECT_URL for migrations), so
// this only keeps a bare `npx prisma ...` working as it did. Existing variables are never replaced.
loadDotenv({ quiet: true });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  // The migration engine reads this URL itself, with Prisma 6's parameters (sslcert, sslaccept,
  // connect_timeout...). The bot's own connection is built from the same URL in src/database.ts.
  // `prisma generate` needs no database, so a missing DATABASE_URL must not stop it.
  datasource: { url: process.env["DATABASE_URL"] ?? "" }
});
