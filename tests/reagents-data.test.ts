import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildReagents, luaString, OUTPUT } from "../scripts/build-reagents.mjs";

// The reagent data the addon ships (addon/Guilded/Data/Reagents.lua) is generated from data/recipes/*.csv. docs/RECIPE_REAGENTS.md.

const HEADER = "key,profession,spell,count,name,reagents,reagent_names\n";
function project(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "reagents-"));
  mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
}

describe("Reagents.lua", () => {
  it("is exactly what data/recipes/*.csv give (run npm run reagents:build after editing them)", () => {
    const built = buildReagents();
    expect(readFileSync(OUTPUT, "utf8").replace(/\r\n/g, "\n")).toBe(built.text);
  });

  it("covers every profession window, is plain ASCII and has a name fallback for the reagents it uses", () => {
    const built = buildReagents();
    expect(built.count).toBeGreaterThan(2000);
    for (const profession of ["Alchemy", "Blacksmithing", "Cooking", "Enchanting", "Engineering", "First Aid", "Leatherworking", "Poisons", "Tailoring", "Mining"]) {
      expect((built.perProfession as Record<string, number>)[profession], profession).toBeGreaterThan(5);
    }
    // eslint-disable-next-line no-control-regex
    expect(/[^\x09\x0a\x20-\x7e]/.test(built.text)).toBe(false);
    expect(built.text).toContain("[2454]={1,2449,1,765,1,3371,1},");
    expect(built.text).toMatch(/\n\[-\d+\]=\{1,/); // an enchant, keyed by minus its spell id
  });
});

describe("adding or changing a recipe", () => {
  const base = HEADER + "100,Alchemy,1,1,Potion A,10:2;11:1,\n200,Cooking,2,2,Stew B,20:1,\n";

  it("an overrides line replaces a recipe, adds a new one and removes one with profession -", () => {
    const dir = project({
      "recipes.csv": base, "items.csv": "id,name\n10,Herb\n11,Vial\n20,Meat\n",
      "overrides.csv": "# a comment\n" + HEADER + "100,Alchemy,1,3,Potion A,10:5\n300,Tailoring,3,1,New Cloak,30:4;31:1\n200,-,,,,\n",
      "items-extra.csv": "id,name\n30,Silk\n"
    });
    const built = buildReagents(dir);
    expect(built.replaced).toBe(1);
    expect(built.added).toBe(1);
    expect(built.removed).toBe(1);
    expect(built.text).toContain("[100]={3,10,5},");
    expect(built.text).toContain("[300]={1,30,4,31,1},");
    expect(built.text).not.toContain("[200]");
    expect(built.text).toContain('[30]="Silk"');
    expect(built.text).not.toContain('[11]="Vial"'); // reagent 11 is no longer used by any recipe
  });

  it("refuses a malformed line with the file and line number instead of writing bad data", () => {
    const bad = (line: string, message: RegExp) => expect(() => buildReagents(project({ "recipes.csv": HEADER + line + "\n", "items.csv": "id,name\n" }))).toThrow(message);
    bad("abc,Alchemy,1,1,X,10:1", /recipes\.csv line 2: key "abc"/);
    bad("100,Alchemy,1,0,X,10:1", /count "0"/);
    bad("100,Alchemy,1,1,X,10", /itemId:count/);
    bad("100,Alchemy,1,1,X,", /1 to 8 reagents/);
    bad("100,Alchemy,1,1,X,10:1;10:2", /listed twice/);
    expect(() => buildReagents(project({ "recipes.csv": HEADER + "100,A,1,1,X,10:1\n100,A,1,1,Y,10:1\n", "items.csv": "id,name\n" }))).toThrow(/appears twice/);
  });

  it("writes accents and quotes as plain ASCII escapes, the way Locale.lua does", () => {
    expect(luaString("Chasse-bébé \"X\"")).toBe('"Chasse-b\\195\\169b\\195\\169 \\"X\\""');
  });
});
