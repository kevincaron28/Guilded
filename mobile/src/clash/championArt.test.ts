import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CLASS_KEYS } from "./types";

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, "../../assets/clash/champions");
const source = readFileSync(join(here, "championArt.ts"), "utf8");

describe("Champion paintings", () => {
  it("has a full picture, an art window and a portrait for every class, all required by the registry", () => {
    for (const cls of CLASS_KEYS) {
      for (const suffix of ["", "-window", "-portrait"]) {
        const file = `${cls}${suffix}.webp`;
        expect(statSync(join(dir, file)).size, file).toBeGreaterThan(2_000);
        expect(source, file).toContain(`assets/clash/champions/${file}`);
      }
    }
  });
  it("keeps the bundle small (under 1.5 MB for the nine classes, each file under 150 KB)", () => {
    let total = 0;
    for (const cls of CLASS_KEYS) for (const suffix of ["", "-window", "-portrait"]) {
      const size = statSync(join(dir, `${cls}${suffix}.webp`)).size;
      expect(size, `${cls}${suffix}`).toBeLessThan(150_000);
      total += size;
    }
    expect(total).toBeLessThan(1_500_000);
  });
  it("is a real WebP (RIFF/WEBP header)", () => {
    for (const cls of CLASS_KEYS) {
      const head = readFileSync(join(dir, `${cls}-window.webp`)).subarray(0, 12).toString("latin1");
      expect(head.startsWith("RIFF") && head.endsWith("WEBP")).toBe(true);
    }
  });
});
