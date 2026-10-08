import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parse } from "dotenv";
import { describe, expect, it } from "vitest";

// Each run starts tsx in a fresh process. On a busy machine (the whole suite in
// parallel) that can take well over the 5s default, so give it room; the test
// still fails if the CLI hangs.
const SPAWN_TIMEOUT = 120_000;

function runPreflight(values: Record<string, string>) {
  const folder = mkdtempSync(join(tmpdir(), "guilded-setup-"));
  try {
    const example = parse(readFileSync(".env.example"));
    const env = { ...process.env };
    // The rehearsal must never fall through to a developer's actual credentials.
    for (const key of Object.keys(example)) delete env[key];
    writeFileSync(join(folder, ".env.local"), Object.entries({ ...example, ...values })
      .map(([key, value]) => `${key}=${value}`).join("\n"));
    return spawnSync(process.execPath, [resolve("node_modules/tsx/dist/cli.mjs"), resolve("scripts/check-setup.ts")],
      { cwd: folder, env, encoding: "utf8", timeout: SPAWN_TIMEOUT });
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

const valid = {
  DISCORD_TOKEN: "offline-test-token-never-authenticate",
  DISCORD_CLIENT_ID: "123456789012345678", DISCORD_GUILD_ID: "234567890123456789",
  DATABASE_URL: "postgresql://test:private-test-password@localhost:5432/setup_test"
};

describe("owner setup preflight CLI", { timeout: SPAWN_TIMEOUT + 10_000 }, () => {
  it("loads a fresh four-value configuration without printing its secrets", () => {
    const result = runPreflight(valid);
    expect(result.error).toBeUndefined();
    expect(result.stdout).toContain("PASS Bot token supplied");
    expect(result.stdout).toContain("PASS PostgreSQL connection string");
    expect(result.stdout).not.toContain("FAIL Configuration loads");
    expect(result.stdout + result.stderr).not.toContain(valid.DISCORD_TOKEN);
    expect(result.stdout + result.stderr).not.toContain("private-test-password");
  });

  it("reports missing required settings with a failing exit code", () => {
    const result = runPreflight({});
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("FAIL Configuration loads");
    expect(result.stdout).toContain("DISCORD_TOKEN");
  });

  it("rejects incorrect IDs and proxy settings without attempting a connection", () => {
    const result = runPreflight({ ...valid, DISCORD_GUILD_ID: "My Guild", COMPANION_API_PORT: "9999" });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("FAIL DISCORD_GUILD_ID");
    expect(result.stdout).toContain("FAIL Included Caddy proxy matches API settings");
    expect(result.stdout).toContain("Offline check only");
  });
});
