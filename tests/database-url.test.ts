import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CONNECTION_LIMIT, withWakeUpTimeouts } from "../src/database.js";
afterEach(() => vi.unstubAllEnvs());

describe("database URL defaults", () => {
  it("forces UTC after environment options while retaining read-only startup settings", () => {
    vi.stubEnv("PGOPTIONS", "-c TimeZone=America/Toronto -c default_transaction_read_only=on");
    const url = new URL(withWakeUpTimeouts("postgresql://u:p@localhost/test")!);
    expect(url.searchParams.get("options")).toBe("-c TimeZone=America/Toronto -c default_transaction_read_only=on -c TimeZone=UTC");
  });
  it("lets explicit URL options override the environment, then enforces UTC", () => {
    vi.stubEnv("PGOPTIONS", "-c statement_timeout=1000");
    const url = new URL("postgresql://u:p@localhost/test");
    url.searchParams.set("options", "-c TimeZone=Pacific/Chatham -c statement_timeout=9000");
    expect(new URL(withWakeUpTimeouts(url.toString())!).searchParams.get("options")).toBe("-c TimeZone=Pacific/Chatham -c statement_timeout=9000 -c TimeZone=UTC");
  });
  it("adds the wake-up timeouts and a pool larger than Prisma's default of 5", () => {
    const url = new URL(withWakeUpTimeouts("postgresql://u:p@db.example:5432/guilded?sslmode=require")!);
    expect(url.searchParams.get("connect_timeout")).toBe("30");
    expect(url.searchParams.get("pool_timeout")).toBe("30");
    expect(url.searchParams.get("connection_limit")).toBe(String(DEFAULT_CONNECTION_LIMIT));
    expect(url.searchParams.get("sslmode")).toBe("require");
  });

  it("keeps values the URL already sets", () => {
    const url = new URL(withWakeUpTimeouts("postgresql://u:p@db.example:5432/guilded?connection_limit=3&pool_timeout=10")!);
    expect(url.searchParams.get("connection_limit")).toBe("3");
    expect(url.searchParams.get("pool_timeout")).toBe("10");
  });

  it("stays within Aiven's 17 usable connections even while an old and a new process overlap", () => {
    expect(DEFAULT_CONNECTION_LIMIT * 2).toBeLessThanOrEqual(17);
  });

  it("leaves a missing or unparsable URL alone", () => {
    expect(withWakeUpTimeouts(undefined)).toBeUndefined();
    expect(withWakeUpTimeouts("not a url")).toBe("not a url");
  });
});
