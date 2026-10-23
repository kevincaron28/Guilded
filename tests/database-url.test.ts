import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CONNECTION_LIMIT, poolSettings } from "../src/database.js";

describe("database URL to node-postgres pool settings", () => {
  afterEach(() => vi.unstubAllEnvs());
  const dir = mkdtempSync(join(tmpdir(), "guilded-ca-"));
  const ca = join(dir, "aiven-ca.pem");
  writeFileSync(ca, "-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----\n");
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("reads the production Aiven URL the way Prisma 6 did", () => {
    const url = `postgres://bot:secret@guilded-example.aivencloud.com:22690/defaultdb?sslmode=require&sslcert=${encodeURIComponent(ca)}&sslaccept=strict&connection_limit=5&connect_timeout=30&pool_timeout=30`;
    const settings = poolSettings(url);
    expect(settings.max).toBe(5);
    expect(settings.connectionTimeoutMillis).toBe(30_000);
    expect(settings.ssl).toEqual({ rejectUnauthorized: true, ca: expect.stringContaining("BEGIN CERTIFICATE") });
    // node-postgres would let these override `ssl` (its sslcert is a client certificate).
    expect(settings.connectionString).toBe("postgres://bot:secret@guilded-example.aivencloud.com:22690/defaultdb");
  });

  it("uses a pool larger than Prisma 6's default of 5 and 30s timeouts when the URL sets none", () => {
    const settings = poolSettings("postgresql://postgres:postgres@127.0.0.1:5432/guilded_release_test");
    expect(settings).toEqual({
      connectionString: "postgresql://postgres:postgres@127.0.0.1:5432/guilded_release_test",
      max: DEFAULT_CONNECTION_LIMIT,
      connectionTimeoutMillis: 30_000,
      idleTimeoutMillis: 300_000,
      allowExitOnIdle: true,
      options: "-c TimeZone=UTC",
      ssl: false
    });
  });

  it("keeps Prisma 6's TLS meanings", () => {
    expect(poolSettings("postgresql://u:p@db.example/x?sslmode=require").ssl).toEqual({ rejectUnauthorized: false });
    expect(poolSettings("postgresql://u:p@db.example/x?sslmode=verify-full").ssl).toEqual({ rejectUnauthorized: true });
    expect(poolSettings("postgresql://u:p@db.example/x?sslmode=disable").ssl).toBe(false);
    expect(poolSettings("postgresql://u:p@db.example/x?sslmode=prefer").ssl).toBe(false);
  });

  it("reads a relative certificate path from the prisma folder, as Prisma 6 did", () => {
    expect(() => poolSettings("postgresql://u:p@db.example/x?sslmode=require&sslcert=missing-ca.pem")).toThrow(/prisma[\\/]missing-ca\.pem/);
  });

  it("keeps a smaller pool or shorter timeouts the URL already sets, and other parameters", () => {
    const settings = poolSettings("postgresql://u:p@db.example/x?connection_limit=3&pool_timeout=10&connect_timeout=5&application_name=guilded");
    expect(settings.max).toBe(3);
    expect(settings.connectionTimeoutMillis).toBe(10_000);
    expect(settings.connectionString).toBe("postgresql://u:p@db.example/x?application_name=guilded");
  });

  it("stays within Aiven's 17 usable connections even while an old and a new process overlap", () => {
    expect(DEFAULT_CONNECTION_LIMIT * 2).toBeLessThanOrEqual(17);
  });

  it("leaves a missing or unparsable URL to node-postgres", () => {
    expect(poolSettings(undefined).connectionString).toBeUndefined();
    expect(poolSettings("not a url").connectionString).toBe("not a url");
  });

  it("forces UTC after URL or environment options without dropping other startup settings", () => {
    vi.stubEnv("PGOPTIONS", "-c statement_timeout=9000 -c timezone=America/Toronto");
    expect(poolSettings(undefined).options).toBe("-c statement_timeout=9000 -c timezone=America/Toronto -c TimeZone=UTC");
    const settings = poolSettings("postgresql://u:p@localhost/x?options=-c%20timezone%3DAsia%2FKolkata%20-c%20default_transaction_read_only%3Don");
    expect(settings.options).toBe("-c timezone=Asia/Kolkata -c default_transaction_read_only=on -c TimeZone=UTC");
    expect(new URL(settings.connectionString!).searchParams.has("options")).toBe(false);
    expect(poolSettings("postgresql://u:p@localhost/x?options=").options).toBe("-c TimeZone=UTC");
  });
});
