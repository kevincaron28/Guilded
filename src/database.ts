import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.js";
import { config as loadDotenv } from "dotenv";

// Same files config.ts loads. Done here too because this module can be
// evaluated before config.ts, and DATABASE_URL is read below at import time.
loadDotenv({ path: ".env.local", quiet: true });
loadDotenv({ quiet: true });

// Prisma 6's default pool was 2 x CPU cores + 1, which is 5 on the Oracle VM. The startup
// burst (every server's jobs plus the daily backup's long transaction) ran out of it on
// 19 October 2026. Aiven's plan allows 20 connections with 3 reserved, so 8 still leaves
// room for an old and a new process during a restart, pg_dump and `npm run bugs`.
export const DEFAULT_CONNECTION_LIMIT = 8;

// Neon suspended the database after a few idle minutes and needed several seconds to wake
// up; Prisma 6's 5s connect timeout failed the first query after a quiet spell ("Can't reach
// database server"). node-postgres has no timeout at all by default, so keep 30s.
const DEFAULT_TIMEOUT_SECONDS = 30;
// Prisma 6 closed idle connections after 5 minutes; node-postgres would after 10 seconds,
// paying a new TLS handshake to Aiven for most queries.
const IDLE_TIMEOUT_MS = 300_000;

// The node-postgres pool settings set here (a subset of pg's PoolConfig).
export interface PoolSettings {
  connectionString?: string;
  options: string;
  max: number;
  connectionTimeoutMillis: number;
  idleTimeoutMillis: number;
  allowExitOnIdle: boolean;
  ssl?: false | { ca?: string; rejectUnauthorized: boolean };
}

// Prisma 7 reaches PostgreSQL through node-postgres, which reads DATABASE_URL differently
// from Prisma 6: it ignores connection_limit/pool_timeout/connect_timeout, reads `sslcert` as
// a client certificate, and treats `sslmode=require` as "verify against public CAs" (Aiven's
// certificate is signed by Aiven's own CA). The URL the servers already use is translated here
// so .env.local needs no change; `prisma migrate` still reads it with Prisma 6's meanings.
//   connection_limit           -> pool size (default 8)
//   connect_timeout/pool_timeout -> connect and wait-for-a-connection timeout (default 30s)
//   sslmode=disable, or none   -> no TLS (Prisma 6's "prefer" fell back to plain connections)
//   sslmode=require            -> TLS; certificate checked only with sslaccept=strict
//   sslcert or sslrootcert     -> CA certificate to trust (relative paths from prisma/, as before)
// Other ssl* parameters (client certificates) are not carried over.
export function poolSettings(url: string | undefined): PoolSettings {
  // adapter-pg 7.10.1 replaces a timestamptz offset with +00:00 without converting
  // its clock time. Every connection (including replacements) must therefore use UTC.
  // Preserve other startup settings; the final -c wins over an earlier TimeZone.
  const utcOptions = (options: string | undefined | null) => `${options?.trim() ? `${options.trim()} ` : ""}-c TimeZone=UTC`;
  const settings: PoolSettings = { options: utcOptions(process.env["PGOPTIONS"]), max: DEFAULT_CONNECTION_LIMIT, connectionTimeoutMillis: DEFAULT_TIMEOUT_SECONDS * 1000, idleTimeoutMillis: IDLE_TIMEOUT_MS, allowExitOnIdle: true };
  if (!url) return settings;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ...settings, connectionString: url };
  }
  const params = parsed.searchParams;
  settings.options = utcOptions(params.get("options") ?? process.env["PGOPTIONS"]);
  // pg lets URL options override PoolConfig.options, so remove the original.
  params.delete("options");
  const seconds = (name: string) => {
    const value = Number(params.get(name) ?? DEFAULT_TIMEOUT_SECONDS);
    return Number.isFinite(value) && value >= 0 ? value : DEFAULT_TIMEOUT_SECONDS;
  };
  const limit = Number(params.get("connection_limit"));
  if (Number.isInteger(limit) && limit > 0) settings.max = limit;
  settings.connectionTimeoutMillis = Math.max(seconds("connect_timeout"), seconds("pool_timeout")) * 1000;

  const mode = params.get("sslmode");
  const certificate = params.get("sslcert") ?? params.get("sslrootcert");
  if (mode && mode !== "disable" && mode !== "prefer") {
    const strict = params.get("sslaccept") === "strict" || mode === "verify-ca" || mode === "verify-full";
    settings.ssl = { rejectUnauthorized: strict };
    if (certificate) settings.ssl.ca = readFileSync(isAbsolute(certificate) ? certificate : resolve("prisma", certificate), "utf8");
  } else {
    settings.ssl = false;
  }
  // node-postgres lets the connection string override `ssl`, so no ssl* parameter may stay in it.
  for (const name of [...params.keys()]) {
    if (name.startsWith("ssl") || ["uselibpqcompat", "connection_limit", "connect_timeout", "pool_timeout"].includes(name)) params.delete(name);
  }
  return { ...settings, connectionString: parsed.toString() };
}

export function createPrismaClient(url = process.env["DATABASE_URL"]): PrismaClient {
  const adapter = new PrismaPg(poolSettings(url), {
    // A connection the server closed while idle; the pool replaces it on the next query.
    onPoolError: (error) => console.warn(`Database connection closed while idle: ${error.message}`)
  });
  return new PrismaClient({ adapter });
}

export const prisma = createPrismaClient();

export async function disconnectDatabase(): Promise<void> {
  await prisma.$disconnect();
}
