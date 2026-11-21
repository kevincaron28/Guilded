import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// 9.3.7 shipped a companion whose main.cjs required ./run-log.cjs, which the electron-builder `files` list left out of
// app.asar: the app could not start ("Cannot find module './run-log.cjs'") and never came back after its self-update.
// Every local module reachable from a packaged file must itself be packaged.
describe("companion package contents", () => {
  it("packages every local .cjs module the packaged files require", () => {
    const dir = new URL("../companion-app/", import.meta.url);
    const files: string[] = JSON.parse(readFileSync(new URL("package.json", dir), "utf8")).build.files;
    const packaged = new Set(files.filter((f) => f.endsWith(".cjs")));
    const seen = new Set<string>(), missing: string[] = [];
    const walk = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      const source = readFileSync(new URL(file, dir), "utf8");
      for (const match of source.matchAll(/require\(\s*["']\.\/([^"']+\.cjs)["']\s*\)/g)) {
        const name = match[1]!;
        if (!packaged.has(name)) missing.push(`${file} -> ${name}`);
        walk(name);
      }
    };
    for (const file of packaged) walk(file);
    expect(missing).toEqual([]);
  });
});
