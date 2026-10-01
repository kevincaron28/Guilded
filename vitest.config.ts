import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Local recovery snapshots are incomplete historical copies, not test sources.
    exclude: [...configDefaults.exclude, "backups/**"]
  }
});
