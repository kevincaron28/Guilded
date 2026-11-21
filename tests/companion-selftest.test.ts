import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const { collectLocalModules, collectEngineModules, REQUIRED_FILES } = createRequire(import.meta.url)("../companion-app/selftest.cjs");
const dir = new URL("../companion-app/", import.meta.url);

describe("companion --self-test", () => {
  it("collects the local module graph, following nested requires once", () => {
    const sources: Record<string, string> = {
      "main.cjs": 'const a = require("./a.cjs"); const b = () => require("./b.cjs"); require("node:fs");',
      "a.cjs": 'require("./b.cjs"); require("./main.cjs");',
      "b.cjs": "module.exports = 1;",
    };
    expect(collectLocalModules("main.cjs", (f: string) => sources[f]).sort()).toEqual(["a.cjs", "b.cjs", "main.cjs"]);
  });

  it("collects the engine modules main.cjs imports", () => {
    expect(collectEngineModules('import(url("engine.mjs")), await import(url("a.mjs")), url("engine.mjs")').sort()).toEqual(["a.mjs", "engine.mjs"]);
  });

  it("real main.cjs: self-test is wired, packaged, and every local module is found", () => {
    const main = readFileSync(new URL("main.cjs", dir), "utf8");
    // The guard lives in the entry point, before main.cjs (and its single-instance lock) is even loaded.
    const entry = readFileSync(new URL("entry.cjs", dir), "utf8");
    expect(entry.indexOf('"--self-test"')).toBeGreaterThan(-1);
    expect(entry.indexOf('"--self-test"')).toBeLessThan(entry.indexOf('require("./main.cjs")'));
    expect(JSON.parse(readFileSync(new URL("package.json", dir), "utf8")).main).toBe("entry.cjs");
    expect(main).not.toContain('"--self-test"');
    const files: string[] = JSON.parse(readFileSync(new URL("package.json", dir), "utf8")).build.files;
    expect(files).toContain("selftest.cjs");
    expect(files).toContain("entry.cjs");
    const found: string[] = collectLocalModules("main.cjs", (f: string) => readFileSync(new URL(f, dir), "utf8"));
    expect(found).toContain("run-log.cjs");
    expect(collectEngineModules(main)).toContain("engine.mjs");
    expect(REQUIRED_FILES).toContain("preload.cjs");
  });
});
