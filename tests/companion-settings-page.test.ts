import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

// Companion redesign PR 3 (docs/plans/COMPANION_REDESIGN.md): one Settings page for the Discord
// account, the WoW folder and the addon, the games and how the companion runs; Tools keeps only the
// export and the imports.
const require = createRequire(import.meta.url);
const fr = require("../companion-app/locales/fr.json") as Record<string, string>;
const html = readFileSync("companion-app/renderer/index.html", "utf8");
const page = (id: string) => html.slice(html.indexOf(`<section id="page-${id}"`), html.indexOf("</section>", html.indexOf(`<section id="page-${id}"`)));

describe("Settings", () => {
  const settings = page("settings");

  it("goes Discord account, WoW folder, addon, games, how it runs, then Advanced", () => {
    const order = ["<h1>Settings</h1>", "<h2>Discord account</h2>", "<h2>Your WoW folder</h2>", 'id="addonBanner"', "<h2>Games</h2>", "<h2>How the companion runs</h2>", 'id="storeDistribution"', '<details id="advanced"'];
    const at = order.map((needle) => settings.indexOf(needle));
    for (const [i, position] of at.entries()) expect(position, order[i]).toBeGreaterThan(-1);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(settings).not.toContain("step-number");
  });

  it("folds the long explainer away, and no longer sends members to a step number", () => {
    expect(settings).toMatch(/<details class="explain"><summary>Which option is right for me\?<\/summary><p class="muted"><strong>Addon only, no Discord server\?<\/strong>[\s\S]*having both is fine\.<\/p><\/details>/);
    expect(settings).toContain("The companion finds your WoW folder by itself.");
    expect(settings).not.toContain("in step 2");
  });

  it("holds the folder buttons, the addon's Install/Update/Reinstall and the Store's Startup settings", () => {
    for (const id of ["btnWowSelect", "btnStandings", "btnFolder", "tileWatch", "wowFileState", "btnInstallAddon", "btnStoreStartup", "btnRunSetup"]) expect(settings, id).toContain(`id="${id}"`);
  });

  it("never submits the form from a moved button", () => {
    const form = settings.slice(settings.indexOf('<form id="form"'), settings.indexOf("</form>"));
    const buttons = [...form.matchAll(/<button\b[^>]*>/g)].map((match) => match[0]);
    expect(buttons.length).toBeGreaterThan(5);
    for (const button of buttons) expect(button, button).toMatch(/type="(button|submit)"/);
    expect(buttons.filter((button) => button.includes('type="submit"'))).toEqual(['<button type="submit" id="btnSave" class="primary">']);
  });
});

describe("Tools moved out (redo C4)", () => {
  it("has no Tools page: export is /officer export in Discord, GRM import is gone from the window", () => {
    const html = readFileSync("companion-app/renderer/index.html", "utf8");
    for (const id of ["page-wow", "sheetTable", "grmPanel", "btnBattleNet", "btnDeleteMyData"]) expect(html, id).not.toContain(`id="${id}"`);
  });
});

it("every new heading and line has its French", () => {
  for (const key of ["Settings", "Discord account", "Which option is right for me?", "Your WoW folder", "Games", "How the companion runs", "Tools", "EXTRAS", "WoW settings",
    "Your Discord account, your WoW folder and how the companion runs.", "Your browser opens: choose your server there and press Connect. The companion finds your WoW folder by itself.",
    "Export your guild's data to a spreadsheet, or bring it in from another addon."]) expect(fr[key], key).toBeTruthy();
});
