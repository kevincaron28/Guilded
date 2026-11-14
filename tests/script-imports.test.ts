import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// scripts/ is not type-checked, so a script can import a name its module does not export and only fail when run on the server.
// For the owner-run scripts below, every named value import from ../src must exist in that module.
const SCRIPTS = ["scripts/recover-drowned-city-runs.ts", "scripts/season-rules-change.ts"];

describe("owner-run scripts import only names that exist", () => {
  for (const script of SCRIPTS) {
    it(script, async () => {
      const source = readFileSync(script, "utf8");
      const imports = [...source.matchAll(/^import\s+(?!type\b)\{([^}]+)\}\s+from\s+"(\.\.\/src\/[^"]+)\.js";/gm)];
      expect(imports.length).toBeGreaterThan(0);
      for (const [, names, path] of imports) {
        const mod = await import(/* @vite-ignore */ `../${path!.slice(3)}.ts`) as Record<string, unknown>;
        for (const raw of names!.split(",")) {
          const name = raw.trim().replace(/^type\s.*/, "").split(/\s+as\s+/)[0]!.trim();
          if (name) expect(Object.keys(mod), `${script}: ${path} must export ${name}`).toContain(name);
        }
      }
    }, 60_000);
  }
});
