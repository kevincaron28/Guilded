import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

// Companion redesign PR 4 (docs/plans/COMPANION_REDESIGN.md §3 "Words"): on the member's path the
// companion says "your addon data", "sync" and "Tools", not "saved data", "upload", "Guilded.lua"
// or "the World of Warcraft page". Officer tools (GRM, loot import, Advanced) keep exact file words.
const require = createRequire(import.meta.url);
const fr = require("../companion-app/locales/fr.json") as Record<string, string>;
const read = (file: string) => readFileSync(file, "utf8");
// Every string a member reads on the main path: Problems, Link everything, the status card, the wizard.
const literals = (text: string) => [...text.matchAll(/T\((['"])((?:\\.|(?!\1).)*)\1/g)].map((match) => match[2]);
const memberPath = [
  ...literals(read("companion-app/renderer/problems.js")),
  ...[...read("companion/link-everything.mjs").matchAll(/(?:label|next): '([^']*)'/g)].map((match) => match[1]),
  ...[...read("companion/status-card.mjs").matchAll(/\["([^"]+)"/g)].map((match) => match[1])
];

describe("plain words on the member's path", () => {
  it("never says saved data, upload, Guilded.lua or SavedVariables", () => {
    expect(memberPath.length).toBeGreaterThan(40);
    for (const text of memberPath) expect(text, text).not.toMatch(/saved data|\bupload|Guilded\.lua|SavedVariables/i);
  });

  it("points to Tools, not the old World of Warcraft page", () => {
    const html = read("companion-app/renderer/index.html");
    expect(html).not.toContain("World of Warcraft page");
    expect(html).toContain("and Export to spreadsheet in Tools still works.");
    expect(html).toContain("In Tools, Export to spreadsheet turns your Guilded addon data into CSV files");
  });

  it("has the French for every renamed sentence, and drops the old keys", () => {
    for (const key of ["Find my addon data", "Your last /reload did not save the Guilded addon's data.", "Your WoW folder is not chosen yet.", "Your addon data seems to be in another WoW folder now.",
      "Your settings and addon data stay as they are.", "Your sync was received but could not be applied.", "Guilded refused your last sync.", "Your addon data file",
      "Signed in. Your addon data was found; the companion is checking your characters.", "Press Find my addon data, then log in to WoW once and we will find your characters."]) expect(fr[key], key).toBeTruthy();
    for (const old of ["Find my saved data", "Guilded.lua was not updated by your last /reload.", "The bot refused your last upload.", "Your WoW saved data is not chosen yet."]) expect(fr[old], old).toBeUndefined();
  });

  it("keeps the exact file words where officers need them", () => {
    const html = read("companion-app/renderer/index.html");
    expect(html).toContain("Convert a GRM SavedVariables backup into a local Guilded archive.");
  });
});
