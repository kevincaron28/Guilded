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
  ...literals(read("companion-app/renderer/main.js")),
  ...[...read("companion/link-everything.mjs").matchAll(/(?:label|next): '([^']*)'/g)].map((match) => match[1]),
  ...[...read("companion/status-card.mjs").matchAll(/\["([^"]+)"/g)].map((match) => match[1])
];

describe("plain words on the member's path", () => {
  it("never says saved data, upload, Guilded.lua or SavedVariables", () => {
    expect(memberPath.length).toBeGreaterThan(30);
    for (const text of memberPath) expect(text, text).not.toMatch(/saved data|\bupload|Guilded\.lua|SavedVariables/i);
  });

  it("no longer names the Tools page or the old World of Warcraft page", () => {
    const html = read("companion-app/renderer/main.html");
    expect(html).not.toContain("World of Warcraft page");
    expect(html).not.toContain("in Tools");
  });

  it("drops the old wordings from the French catalog", () => {
    for (const old of ["Find my saved data", "Guilded.lua was not updated by your last /reload.", "The bot refused your last upload.", "Your WoW saved data is not chosen yet."]) expect(fr[old], old).toBeUndefined();
  });

  it("points officers to Discord for exports, and members to their Guilded page", () => {
    const html = read("companion-app/renderer/main.html");
    expect(html).toContain("/officer export");
    for (const path of ["/me/", "/me/battlenet", "/me/data", "/docs/PRIVACY.html", "/companion/"]) expect(html).toContain(`https://guildedwow.com${path}"`);
    // Delete my data on the website erases server data only: the window says so and points to Reset.
    expect(html).toContain("on the server only. Afterwards press Reset this companion");
    // Local export and GRM import stay reachable from Advanced.
    for (const id of ["btnExport", "btnGRM", "grmGuild", "grmRealm", "grmPrivate"]) expect(html, id).toContain(`id="${id}"`);
    const script = read("companion-app/renderer/main.js");
    expect(script).toContain("api.exportSheets(");
    expect(script).toContain("api.convertGRM(");
  });
});
