import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { characterLabel, cleanCharacterName, displayCharacterName, fullNameBook } from "../src/services/character-display.js";

describe("one name standard", () => {
  it("never doubles the first name or uses the realm as a last name", () => {
    expect(cleanCharacterName("Xaldin Xaldin")).toBe("Xaldin");
    expect(cleanCharacterName("Shawir Forever")).toBe("Shawir");
    expect(cleanCharacterName("Hulke Hogan")).toBe("Hulke Hogan");
    expect(cleanCharacterName("Crashing Pally", "Crashing-Realm")).toBe("Crashing Pally");
    expect(cleanCharacterName("Mira Dalaran", "Dalaran")).toBe("Mira");
    expect(cleanCharacterName("  élan   Élan ")).toBe("élan");
  });
  it("displayCharacterName applies it on every path", () => {
    expect(displayCharacterName("Xaldin Xaldin")).toBe("Xaldin");
    expect(displayCharacterName({ name: "Shawir", displayName: "Shawir Forever" })).toBe("Shawir");
    expect(displayCharacterName({ name: "Hulke", displayName: "Hulke Hogan" })).toBe("Hulke Hogan");
    expect(displayCharacterName({ name: "Crashing", displayName: null }, ["Crashing Pally", "Other One"])).toBe("Crashing Pally");
    expect(displayCharacterName("Crashing", fullNameBook([{ name: "Crashing Pally" }]))).toBe("Crashing Pally");
    // Two different full names share the first name: ambiguous, the stored name stays.
    expect(displayCharacterName("Hulke", ["Hulke Hogan", "Hulke Smith"])).toBe("Hulke");
  });
  it("characterLabel adds the member only when asked, never a Discord name alone", () => {
    expect(characterLabel({ name: "Crashing", displayName: "Crashing Pally" })).toBe("Crashing Pally");
    expect(characterLabel("Crashing Pally", { mention: "123456789012345678" })).toBe("Crashing Pally (<@123456789012345678>)");
    expect(characterLabel("Crashing Pally", { member: "Simon" })).toBe("Crashing Pally (@Simon)");
  });
});

// Guard: new raw character-name interpolation in user-facing text must go through displayCharacterName / cleanCharacterName /
// characterLabel (src/services/character-display.ts). Existing sites are listed in tests/fixtures/raw-name-baseline.json; the
// list may only shrink. Fix a site by routing it through the helper, then lower its count (or delete its entry).
const RAW = /\$\{[^}]*(?:\.character|\.characterName|\bcharacter\.name|\.charName)\}/g;
const ALLOW = new Set(["src/services/character-display.ts", "src/services/addon-name.ts", "src/services/public-score.ts", "src/services/public-runs.ts", "src/services/dungeon-bracket-season.ts"]);
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return entry === "generated" ? [] : sources(path);
    return path.endsWith(".ts") ? [path] : [];
  });
}
function scan(): Record<string, number> {
  const found: Record<string, number> = {};
  for (const file of sources("src")) {
    const name = relative(".", file).split(sep).join("/");
    if (ALLOW.has(name)) continue;
    const count = (readFileSync(file, "latin1").match(RAW) ?? []).length;
    if (count) found[name] = count;
  }
  return found;
}
describe("raw character names in user-facing builders", () => {
  const baselineFile = "tests/fixtures/raw-name-baseline.json";
  // UPDATE_NAME_BASELINE=1 rewrites the file from the current scan (only to lower it after fixing sites).
  if (process.env["UPDATE_NAME_BASELINE"]) writeFileSync(baselineFile, `${JSON.stringify(Object.fromEntries(Object.entries(scan()).sort()), null, 2)}
`);
  const baseline = JSON.parse(readFileSync(baselineFile, "utf8")) as Record<string, number>;
  const found = scan();
  it("does not grow: no file gains a raw ${x.character} / ${character.name} interpolation", () => {
    const grew = Object.entries(found).filter(([file, count]) => count > (baseline[file] ?? 0)).map(([file, count]) => `${file}: ${count} (allowed ${baseline[file] ?? 0})`);
    expect(grew, "Route the name through displayCharacterName(), cleanCharacterName() or characterLabel() from src/services/character-display.ts").toEqual([]);
  });
  it("keeps the baseline honest: fixed sites are removed from it", () => {
    const stale = Object.entries(baseline).filter(([file, count]) => (found[file] ?? 0) < count).map(([file]) => file);
    expect(stale, "A site was fixed: lower its count in tests/fixtures/raw-name-baseline.json").toEqual([]);
  });
});
