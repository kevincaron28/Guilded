import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The installed companion loads companion/*.mjs from resources/engine, outside
// the app's own node_modules, so every package those files import has to be
// copied next to them by extraResources. A missing one makes the app die at
// startup with no window and no tray icon.
describe("companion installer packaging", () => {
  const appPackage = JSON.parse(readFileSync("companion-app/package.json", "utf8")) as {
    dependencies?: Record<string, string>;
    build: { extraResources: { from: string; to: string; filter?: string[] }[] };
  };
  const engineEntry = appPackage.build.extraResources.find((entry) => entry.to === "engine");
  const shippedFiles = engineEntry?.filter ?? [];

  const barePackages = new Set<string>();
  for (const file of shippedFiles) {
    const source = readFileSync(`companion/${file}`, "utf8");
    for (const match of source.matchAll(/^import\s[^"']*["']([^"']+)["']/gm)) {
      const specifier = match[1] ?? "";
      if (specifier.startsWith(".") || specifier.startsWith("node:")) continue;
      barePackages.add(specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0] ?? specifier);
    }
  }

  it("ships every engine module an engine file imports", () => {
    for (const file of shippedFiles) {
      const source = readFileSync(`companion/${file}`, "utf8");
      for (const match of source.matchAll(/from\s+["']\.\/([^"']+)["']/g)) expect(shippedFiles).toContain(match[1]);
    }
  });

  it("ships every package the engine imports into resources/engine/node_modules", () => {
    expect([...barePackages]).toContain("luaparse");
    for (const name of barePackages) {
      expect(appPackage.dependencies?.[name], `${name} in companion-app dependencies`).toBeTruthy();
      expect(appPackage.build.extraResources).toContainEqual(expect.objectContaining({
        from: `node_modules/${name}`,
        to: `engine/node_modules/${name}`
      }));
    }
  });
});
