import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Owner request (8 November 2026): links members click to get the companion or the addon go to the
// website (guilded.kcaron.top), never straight to GitHub. GitHub stays only as a deliberate fallback
// inside the companion updater, the Worker, releases.json and release notes.
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const GITHUB_DOWNLOAD = /github\.com\/kevincaron28\/Guilded\/releases\/(?:latest|download)/;

describe("member-facing download links point at the website", () => {
  it("the addon's companion copy box", () => {
    const lua = read("addon/Guilded/Modules/CompanionLink.lua");
    expect(lua).toContain('module.DIRECT = "https://guilded.kcaron.top/downloads/Guilded.Companion.Setup.exe"');
    expect(lua).not.toMatch(GITHUB_DOWNLOAD);
  });

  it.each([
    "src/i18n.ts",
    "README.md",
    "companion/README.md",
    "site/pages/start.md",
    "site/pages/start.fr.md",
    "site/pages/guide-install.md",
    "site/pages/guide-install.fr.md",
    "site/pages/reference.md",
    "site/pages/reference.fr.md",
    "site/pages/features.md",
    "site/pages/features.fr.md",
    "companion-app/renderer/main.html"
  ])("%s has no GitHub download link or wording", (path) => {
    const text = read(path);
    expect(text).not.toMatch(GITHUB_DOWNLOAD);
    expect(text).not.toMatch(/(direct (GitHub )?download (from|on) GitHub|direct GitHub download|téléchargement direct (sur|depuis) GitHub)/);
  });
});
