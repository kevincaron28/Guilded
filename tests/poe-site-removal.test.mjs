import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => {
  rmSync("dist/site", { recursive: true, force: true });
  execFileSync(process.execPath, ["scripts/build-site.mjs"], { stdio: "pipe" });
}, 30_000);

describe("PoE2 and Diablo leave the public site", () => {
  it("drops the PoE2 page from the build and the sitemap", () => {
    expect(existsSync("dist/site/quebec-gold/poe2/index.html")).toBe(false);
    expect(existsSync("dist/site/quebec-gold/diablo/index.html")).toBe(false);
    const sitemap = readFileSync("dist/site/sitemap.xml", "utf8");
    expect(sitemap).not.toMatch(/poe2|diablo/i);
    const quebec = readFileSync("dist/site/quebec-gold/index.html", "utf8");
    expect(quebec).not.toMatch(/Path of Exile|PoE2|Diablo/i);
    expect(readFileSync("scripts/build-site.mjs", "utf8")).not.toContain("Path of Exile 2");
  });
});
