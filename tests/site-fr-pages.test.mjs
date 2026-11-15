import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

describe("French site pages", () => {
  it("builds every *.fr.md page: each one is named as a sourceFr in pages.json", () => {
    const pages = JSON.parse(readFileSync("site/pages.json", "utf8"));
    const used = new Set(pages.map(page => page.sourceFr).filter(Boolean));
    const orphans = readdirSync("site/pages").filter(name => name.endsWith(".fr.md") && !used.has(name));
    expect(orphans).toEqual([]);
  });
  it("has the French twin on every guide entry that names one, and the file exists", () => {
    const pages = JSON.parse(readFileSync("site/pages.json", "utf8"));
    for (const page of pages.filter(p => p.sourceFr)) expect(() => readFileSync(`site/pages/${page.sourceFr}`, "utf8")).not.toThrow();
  });
});
