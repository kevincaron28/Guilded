import { describe, expect, it } from "vitest";
import { DEFAULT_CONNECTION_LIMIT, withWakeUpTimeouts } from "../src/database.js";

describe("database URL defaults", () => {
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
