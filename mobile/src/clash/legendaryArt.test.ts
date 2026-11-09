import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SET1 } from "./set1";
import { CLASS_KEYS } from "./types";

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, "../../assets/clash/legendary");
const source = readFileSync(join(here, "legendaryArt.ts"), "utf8");
const legendaryUnits = SET1.filter((c) => c.rarity === "legendary" && c.type === "unit" && c.cls !== "neutral");

describe("Legendary paintings", () => {
  it("covers exactly the nine class Legendary units, one per class", () => {
    expect(legendaryUnits.map((c) => c.cls).sort()).toEqual([...CLASS_KEYS].sort());
    const registered = [...source.matchAll(/^\s+"(\d{3})": \{ full:/gm)].map((m) => m[1]);
    expect(registered.sort()).toEqual(legendaryUnits.map((c) => c.id).sort());
  });
  it("has a full picture and an art window on disk, both required by the registry", () => {
    for (const card of legendaryUnits) {
      for (const suffix of ["", "-window"]) {
        const file = `${card.id}${suffix}.webp`;
        expect(statSync(join(dir, file)).size, file).toBeGreaterThan(2_000);
        expect(source, file).toContain(`assets/clash/legendary/${file}`);
      }
    }
  });
  it("keeps the bundle small (under 1.2 MB in all, each file under 150 KB)", () => {
    let total = 0;
    for (const card of legendaryUnits) for (const suffix of ["", "-window"]) {
      const size = statSync(join(dir, `${card.id}${suffix}.webp`)).size;
      expect(size, `${card.id}${suffix}`).toBeLessThan(150_000);
      total += size;
    }
    expect(total).toBeLessThan(1_200_000);
  });
  it("is a real WebP (RIFF/WEBP header)", () => {
    for (const card of legendaryUnits) {
      const head = readFileSync(join(dir, `${card.id}-window.webp`)).subarray(0, 12).toString("latin1");
      expect(head.startsWith("RIFF") && head.endsWith("WEBP")).toBe(true);
    }
  });
});
