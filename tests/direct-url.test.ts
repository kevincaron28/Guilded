import { describe, expect, it } from "vitest";
import { prismaEnv } from "../scripts/direct-url.mjs";

describe("database updates over a direct connection", () => {
  const env = { DATABASE_URL: "postgresql://u:p@ep-x-pooler.neon.tech/db", DIRECT_URL: "postgresql://u:p@ep-x.neon.tech/db" };

  it("points prisma migrate at DIRECT_URL when it is set", () => {
    expect(prismaEnv("prisma", ["migrate", "deploy"], env).DATABASE_URL).toBe(env.DIRECT_URL);
  });

  it("leaves everything else, and servers without DIRECT_URL, unchanged", () => {
    expect(prismaEnv("prisma", ["generate"], env)).toBe(env);
    expect(prismaEnv("node", ["scripts/ledger-preflight.mjs"], env)).toBe(env);
    const pooledOnly = { DATABASE_URL: env.DATABASE_URL };
    expect(prismaEnv("prisma", ["migrate", "deploy"], pooledOnly)).toBe(pooledOnly);
  });
});
