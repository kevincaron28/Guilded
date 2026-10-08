// Prisma migrations take a session-level advisory lock. Through a transaction-pooling
// connection (Neon's "-pooler" host, PgBouncer) a migration that dies can leave that lock
// on a pooled connection, and every later start then times out waiting for it (P1002).
// When DIRECT_URL is set, `prisma migrate` uses that direct connection instead; the bot
// itself keeps using the pooled DATABASE_URL.
export function prismaEnv(command, args, env) {
  if (env.DIRECT_URL && command === "prisma" && args[0] === "migrate") return { ...env, DATABASE_URL: env.DIRECT_URL };
  return env;
}
