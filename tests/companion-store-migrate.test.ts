import { mkdirSync, mkdtempSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { migrateStoreSettings } = require("../companion-app/store-migrate.cjs");

function setup() {
  const root = mkdtempSync(path.join(tmpdir(), "gc-store-"));
  const localAppData = path.join(root, "Local");
  const appData = path.join(root, "Roaming");
  const userData = path.join(appData, "Guilded Companion");
  const store = path.join(localAppData, "Packages", "Kcaron.GuildedCompanion_abc123", "LocalCache", "Roaming", "Guilded Companion Store");
  mkdirSync(store, { recursive: true });
  writeFileSync(path.join(store, "config.secure"), "signed-in");
  writeFileSync(path.join(store, "Local State"), "key");
  writeFileSync(path.join(store, "Cache.bin"), "noise");
  return { localAppData, appData, userData, store };
}

describe("Store to direct-download settings migration", () => {
  it("copies the sign-in and settings once, logs it, and leaves the Store copy", () => {
    const t = setup();
    const logs: unknown[] = [];
    const result = migrateStoreSettings({ ...t, log: (...a: unknown[]) => logs.push(a) });
    expect(result.migrated).toBe(true);
    expect(readFileSync(path.join(t.userData, "config.secure"), "utf8")).toBe("signed-in");
    expect(existsSync(path.join(t.userData, "Local State"))).toBe(true);
    expect(existsSync(path.join(t.userData, "Cache.bin"))).toBe(false);
    expect(existsSync(path.join(t.store, "config.secure"))).toBe(true);
    expect(logs).toHaveLength(1);
    expect(migrateStoreSettings({ ...t }).migrated).toBe(false);
  });

  it("never overwrites settings the direct-download build already has", () => {
    const t = setup();
    mkdirSync(t.userData, { recursive: true });
    writeFileSync(path.join(t.userData, "config.secure"), "mine");
    expect(migrateStoreSettings({ ...t }).migrated).toBe(false);
    expect(readFileSync(path.join(t.userData, "config.secure"), "utf8")).toBe("mine");
  });

  it("does nothing when there is no Store copy", () => {
    const t = setup();
    expect(migrateStoreSettings({ userData: t.userData, localAppData: path.join(t.userData, "nowhere"), appData: t.userData }).migrated).toBe(false);
  });
});

describe("uninstaller", () => {
  const nsis = readFileSync("companion-app/installer.nsh", "utf8");
  const uninstall = /!macro customUnInstall\b([\s\S]*?)!macroend/.exec(nsis)?.[1] ?? "";
  it("removes Electron's startup entry and keeps data unless the member agrees", () => {
    expect(uninstall).toContain('"electron.app.${PRODUCT_NAME}"');
    expect(JSON.parse(readFileSync("companion-app/package.json", "utf8")).build.nsis.deleteAppDataOnUninstall).toBe(false);
    expect(uninstall).toContain("/SD IDNO");
    expect(uninstall).toContain("${if} ${Silent}");
    const wipe = 'RMDir /r "$APPDATA\\${PRODUCT_NAME}"';
    expect(uninstall).toContain(wipe);
    expect(uninstall.indexOf("${if} ${Silent}")).toBeLessThan(uninstall.indexOf(wipe));
  });
});
