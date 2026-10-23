import { PrismaClient } from "@prisma/client";
import { config as loadDotenv } from "dotenv";

// Same files config.ts loads. Done here too because this module can be
// evaluated before config.ts, and DATABASE_URL is read below at import time.
loadDotenv({ path: ".env.local", quiet: true });
loadDotenv({ quiet: true });

// Neon suspends the database after a few idle minutes and needs several
// seconds to wake up. Prisma's default 5s connect timeout is shorter than
// that, so the first query after a quiet spell failed with "Can't reach
// database server". Allow 30s unless the URL already sets its own values.
//
// Prisma's default pool is 2 x CPU cores + 1, which is 5 on the Oracle VM. The startup
// burst (every server's jobs plus the daily backup's long transaction) ran out of it on
// 19 October 2026. The recorded Aiven budget is 20 connections with 3 reserved. Two
// full pools of 8 leave only ONE maintenance connection, not both pg_dump and bugs.
// Account for every process separately; the existing production URL's limit of 5 wins.
export const DEFAULT_CONNECTION_LIMIT = 8;

export function withWakeUpTimeouts(url: string | undefined): string | undefined {
  if (!url) return url;
  try {
    const parsed = new URL(url);
    if (!parsed.searchParams.has("connect_timeout")) parsed.searchParams.set("connect_timeout", "30");
    if (!parsed.searchParams.has("pool_timeout")) parsed.searchParams.set("pool_timeout", "30");
    if (!parsed.searchParams.has("connection_limit")) parsed.searchParams.set("connection_limit", String(DEFAULT_CONNECTION_LIMIT));
    // Keep the same UTC invariant as the candidate, including fresh pooled connections.
    const options = parsed.searchParams.get("options") ?? process.env["PGOPTIONS"] ?? "";
    parsed.searchParams.set("options", options.trim() ? options.trim() + " -c TimeZone=UTC" : "-c TimeZone=UTC");
    return parsed.toString();
  } catch {
    return url;
  }
}

export function createPrismaClient(url = process.env["DATABASE_URL"]): PrismaClient {
  const datasourceUrl = withWakeUpTimeouts(url);
  return datasourceUrl ? new PrismaClient({ datasourceUrl }) : new PrismaClient();
}
export const prisma = createPrismaClient();

export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
}
