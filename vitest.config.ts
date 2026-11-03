import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  // The phone app's own config extends the Expo package, which the root
  // install does not include. Tests still compile mobile/src/api.test.ts;
  // they use this config so that extend is not loaded.
  tsconfig: "./tsconfig.vitest.json",
  test: {
    // Bound concurrent Lua VMs on Windows without sharing their module state.
    ...(process.platform === "win32" ? { pool: "forks" as const, maxWorkers: 2 } : {}),
    // Never let a local owner's live pilot allowlist change unrelated offline fixtures.
    // Admission tests explicitly mock a hosted configuration.
    env: { HOSTED_PILOT: "false", HOSTED_GUILD_IDS: "" },
    // Local recovery snapshots are incomplete historical copies, not test sources.
    exclude: [...configDefaults.exclude, "backups/**", ".claude/**"]
  }
});
