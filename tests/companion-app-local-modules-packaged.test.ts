import { existsSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { describe, expect, it } from "vitest";

// 9.3.7 shipped without run-log.cjs in the asar: the updated companion crashed at start and never came back.
// Every local module required (transitively) from the entry files must be listed in the electron-builder "files".
const APP = "companion-app";
const pkg = JSON.parse(readFileSync(join(APP, "package.json"), "utf8"));
const files: string[] = pkg.build.files;

function included(rel: string): boolean {
  const path = rel.split("\\").join("/");
  return files.some((pattern) => (pattern.endsWith("/**") ? path.startsWith(pattern.slice(0, -2)) : pattern === path));
}

function localRequires(file: string): string[] {
  const text = readFileSync(join(APP, file), "utf8");
  const found = new Set<string>();
  for (const match of text.matchAll(/require\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g)) {
    const target = normalize(join(dirname(file), match[1]!)).split("\\").join("/");
    found.add(target);
  }
  return [...found];
}

describe("companion-app packaging lists every local module the app requires", () => {
  it("covers the transitive local requires of main.cjs and preload.cjs", () => {
    const seen = new Set<string>();
    const missing: string[] = [];
    const queue = ["main.cjs", "preload.cjs"];
    while (queue.length) {
      const file = queue.pop()!;
      if (seen.has(file)) continue;
      seen.add(file);
      for (const target of localRequires(file)) {
        if (target.startsWith("..")) continue; // outside the app folder: shipped through extraResources
        if (!/\.(cjs|js|json)$/.test(target) || !existsSync(join(APP, target))) continue;
        if (!included(target)) missing.push(`${file} requires ${target}`);
        if (target.endsWith(".cjs")) queue.push(target);
      }
    }
    expect(missing).toEqual([]);
  });
  it("lists run-log.cjs", () => { expect(included("run-log.cjs")).toBe(true); });
});
