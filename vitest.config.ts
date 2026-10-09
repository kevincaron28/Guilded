import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Never let a local owner's live pilot allowlist change unrelated offline fixtures.
    // Admission tests explicitly mock a hosted configuration.
    env: { HOSTED_PILOT: "false", HOSTED_GUILD_IDS: "" },
    // Local recovery snapshots are incomplete historical copies, not test sources.
    exclude: [...configDefaults.exclude, "backups/**"]
  }
});
