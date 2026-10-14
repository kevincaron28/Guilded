import { readFileSync } from "node:fs";
import { parse } from "dotenv";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });

describe("fresh owner configuration", () => {
  function useExample() {
    for (const [key, value] of Object.entries(parse(readFileSync(".env.example")))) vi.stubEnv(key, value);
    vi.stubEnv("DISCORD_TOKEN", "test-only-token");
    vi.stubEnv("DISCORD_CLIENT_ID", "123456789012345678");
    vi.stubEnv("DISCORD_GUILD_ID", "234567890123456789");
    vi.stubEnv("DATABASE_URL", "postgresql://test:test@localhost:5432/fresh_test");
  }

  it("loads the shipped example after filling only the four required settings", async () => {
    useExample();
    const { config } = await import("../src/config.js");
    expect(config.WCL_CLIENT_ID).toBeUndefined();
    expect(config.WCL_CLIENT_SECRET).toBeUndefined();
    expect(config.ERROR_LOG_CHANNEL_ID).toBeUndefined();
    expect(config.MESSAGE_CONTENT_INTENT).toBe(false);
    expect(config.COMPANION_API_HOST).toBe("127.0.0.1");
    expect(config.COMPANION_WEB_URL).toBeUndefined();
  });

  it("accepts an independent host's public companion address", async () => {
    useExample();
    vi.stubEnv("COMPANION_WEB_URL", "https://own-bot.example/companion/");
    expect((await import("../src/config.js")).config.COMPANION_WEB_URL).toBe("https://own-bot.example/companion/");
  });

  it("still refuses a missing required bot token", async () => {
    useExample();
    vi.stubEnv("DISCORD_TOKEN", "");
    await expect(import("../src/config.js")).rejects.toThrow();
  });
});
