import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SET1 } from "./set1";
import { CLASS_KEYS } from "./types";

const here = dirname(fileURLToPath(import.meta.url));
const assets = join(here, "../../assets/clash");
const source = readFileSync(join(here, "cardArt.ts"), "utf8");
const ids = [...source.matchAll(/^\s+"(\d{3})": \{ full:/gm)].map((m) => m[1]!);
const painted = SET1.filter((c) => ids.includes(c.id));
const dirOf = (id: string): string => {
  const marker = `"${id}": { full: require("../../assets/clash/`;
  const at = source.indexOf(marker);
  return at < 0 ? "" : source.slice(at + marker.length).split("/")[0]!;
};

// The nine class Legendary units (L9-WoW) plus the 22 E22 paintings, owner approved 9 November 2026.
const CLASS_LEGENDARY = ["011", "022", "033", "042", "054", "066", "077", "088", "099"];
const E22 = ["010", "021", "032", "044", "055", "065", "076", "087", "098", "121", "123", "125", "130", "132", "143", "144", "145", "146", "147", "148", "149", "150"];

describe("Painted card art registry", () => {
  it("lists exactly the approved paintings, each once", () => {
    expect([...ids].sort()).toEqual([...CLASS_LEGENDARY, ...E22].sort());
    expect(new Set(ids).size).toBe(ids.length);
  });
  it("only names cards that exist in set 1", () => {
    expect(painted.map((c) => c.id).sort()).toEqual([...ids].sort());
  });
  it("covers the nine class Legendary units, one per class", () => {
    const units = SET1.filter((c) => CLASS_LEGENDARY.includes(c.id));
    expect(units.map((c) => `${c.type}/${c.rarity}`)).toEqual(Array(9).fill("unit/legendary"));
    expect(units.map((c) => c.cls).sort()).toEqual([...CLASS_KEYS].sort());
  });
  it("covers every Legendary card outside the classes and the Epics listed, with the expected types", () => {
    const e22 = SET1.filter((c) => E22.includes(c.id));
    expect(e22).toHaveLength(22);
    expect(e22.filter((c) => c.rarity === "legendary")).toHaveLength(6);
    expect(e22.filter((c) => c.rarity === "epic")).toHaveLength(16);
    expect(new Set(e22.map((c) => c.type))).toEqual(new Set(["unit", "spell", "gear", "standard"]));
  });
  it("has a full picture and an art window on disk, both required by the registry", () => {
    for (const card of painted) {
      const dir = dirOf(card.id);
      expect(["legendary", "cards"], card.id).toContain(dir);
      for (const suffix of ["", "-window"]) {
        const file = `${card.id}${suffix}.webp`;
        expect(statSync(join(assets, dir, file)).size, file).toBeGreaterThan(2_000);
        expect(source, file).toContain(`assets/clash/${dir}/${file}`);
      }
    }
  });
  it("keeps the bundle small (each file under 150 KB, all paintings under 6 MB)", () => {
    let total = 0;
    for (const card of painted) for (const suffix of ["", "-window"]) {
      const size = statSync(join(assets, dirOf(card.id), `${card.id}${suffix}.webp`)).size;
      expect(size, `${card.id}${suffix}`).toBeLessThan(150_000);
      total += size;
    }
    expect(total).toBeLessThan(6_000_000);
  });
  it("is a real WebP (RIFF/WEBP header)", () => {
    for (const card of painted) {
      const head = readFileSync(join(assets, dirOf(card.id), `${card.id}-window.webp`)).subarray(0, 12).toString("latin1");
      expect(head.startsWith("RIFF") && head.endsWith("WEBP")).toBe(true);
    }
  });
});
