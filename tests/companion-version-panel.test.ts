import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

// Owner request (7 November): see clearly which version is installed, which is out and what to do,
// update with one click, and for Store installs land straight on the Guilded listing.
const require = createRequire(import.meta.url);
const { versionStatus, STORE_LISTING } = require("../companion-app/update-check.cjs");
const fr = require("../companion-app/locales/fr.json") as Record<string, string>;

describe("the version panel's state", () => {
  const latest = (version: string) => ({ version, url: "https://github.com/kevincaron28/Guilded/releases/latest" });

  it("direct download: up to date, update available, ready to install, installing, unknown", () => {
    expect(versionStatus({ current: "9.0.1", latest: latest("9.0.1"), checkedAt: "2026-11-07T12:00:00.000Z" }))
      .toMatchObject({ installed: "9.0.1", latest: "9.0.1", status: "up-to-date", action: null, checkedAt: "2026-11-07T12:00:00.000Z" });
    expect(versionStatus({ current: "9.0.0", latest: latest("v9.0.1") })).toMatchObject({ latest: "9.0.1", status: "update-available", action: "update-now" });
    // Downloaded and checked already: one click installs it, no second download.
    expect(versionStatus({ current: "9.0.0", latest: latest("9.0.1"), pending: { version: "9.0.1" }, pendingReady: true })).toMatchObject({ status: "update-ready", action: "install-now" });
    // A staged file that no longer checks out does not count.
    expect(versionStatus({ current: "9.0.0", latest: latest("9.0.1"), pending: { version: "9.0.1" }, pendingReady: false }).status).toBe("update-available");
    expect(versionStatus({ current: "9.0.0", latest: latest("9.0.1"), installing: true }).status).toBe("installing");
    expect(versionStatus({ current: "9.0.0", latest: null, checkFailed: true })).toMatchObject({ status: "unknown", action: "check", checkFailed: true });
    expect(versionStatus({ current: "9.0.0", latest: null, autoUpdate: false })).toMatchObject({ status: "unknown", autoUpdate: false });
    // An older release than the installed one is not an update.
    expect(versionStatus({ current: "9.1.0", latest: latest("9.0.1") }).status).toBe("up-to-date");
  });

  it("Microsoft Store: always the button to the Guilded listing", () => {
    expect(versionStatus({ current: "9.0.0", latest: latest("9.0.1"), store: true })).toMatchObject({ status: "store-update", action: "open-store" });
    expect(versionStatus({ current: "9.0.0", store: true, storeUpdate: { version: "" } }).status).toBe("store-update");
    expect(versionStatus({ current: "9.0.1", latest: latest("9.0.1"), store: true })).toMatchObject({ status: "store-up-to-date", action: "open-store" });
    expect(versionStatus({ current: "9.0.1", store: true })).toMatchObject({ status: "store-unknown", action: "open-store" });
    expect(STORE_LISTING).toBe("ms-windows-store://pdp/?ProductId=9N680XX3QFL9");
  });
});

describe("the companion wiring", () => {
  const main = readFileSync("companion-app/main.cjs", "utf8");

  it("serves the panel and opens the Store listing, not the general Downloads page", () => {
    expect(main).toContain('registerIpc("version-info"');
    expect(main).toContain('registerIpc("open-store-listing", () => shell.openExternal(updates.STORE_LISTING));');
    expect(main).toMatch(/registerIpc\("install-update", async \(\) => \{\s*if \(STORE_PACKAGE\) \{\s*await shell\.openExternal\(updates\.STORE_LISTING\);/);
    expect(main).toMatch(/registerIpc\("open-update", \(\) => shell\.openExternal\(STORE_PACKAGE \? updates\.STORE_LISTING/);
    expect(readFileSync("companion-app/ipc-security.cjs", "utf8")).toMatch(/"version-info", "open-store-listing"/);
    const preload = readFileSync("companion-app/preload.cjs", "utf8");
    expect(preload).toContain('versionInfo: () => ipcRenderer.invoke("version-info")');
    expect(preload).toContain('openStoreListing: () => ipcRenderer.invoke("open-store-listing")');
  });

  it("Update now installs an update already downloaded in the background at once", () => {
    const install = main.slice(main.indexOf('registerIpc("install-update"'));
    expect(install).toMatch(/const staged = app\.isPackaged \? updates\.inspectPending\([\s\S]{0,200}if \(staged\.action === "install"\) \{[\s\S]{0,400}await updates\.launchInstaller\(staged\.file, spawn\);/);
    // Before any second download.
    expect(install.indexOf("staged.action")).toBeLessThan(install.indexOf("downloadInstaller"));
    // The silent auto-update is untouched.
    expect(main).toContain("async function stageUpdate()");
    expect(main).toContain('app.on("will-quit"');
  });

  it("shows the panel on Home, in French too", () => {
    const html = readFileSync("companion-app/renderer/index.html", "utf8");
    expect(html).toContain('<article id="versionPanel" class="panel version-panel"');
    const app = readFileSync("companion-app/renderer/app.js", "utf8");
    expect(app).toContain("function versionTexts(info)");
    expect(app).toContain("api.openStoreListing()");
    for (const key of ["COMPANION VERSION", "Check now", "Guilded Companion {0} is up to date", "Version {0} is ready to install", "Install now", "Version {0} is available",
      "Open Microsoft Store", "Microsoft Store installs it: choose Open Microsoft Store, then Update on the Guilded Companion page.",
      "Microsoft Store opened at Guilded Companion. Choose Update there (or Get updates in the Library).", "Downloading and checking the update: {0}%"]) expect(fr[key], key).toBeTruthy();
  });
});

describe("the same update guidance everywhere", () => {
  it("the site says how each version updates and where the button is", () => {
    const en = readFileSync("site/pages/companion.md", "utf8");
    const frPage = readFileSync("site/pages/companion.fr.md", "utf8");
    expect(en).toContain("choose **Open Microsoft Store** on the companion's Home");
    expect(en).toContain("or at once with **Update now** on its Home page");
    expect(frPage).toContain("choisissez **Ouvrir Microsoft Store** dans l’Accueil du compagnon");
    expect(frPage).toContain("ou tout de suite avec **Mettre à jour** dans son Accueil");
  });

  it("the companion's Help says the same", () => {
    const html = readFileSync("companion-app/renderer/main.html", "utf8");
    expect(html).toContain("The Microsoft Store keeps this app up to date.");
    expect(html).not.toContain("A direct download from GitHub is the fallback");
  });
});
