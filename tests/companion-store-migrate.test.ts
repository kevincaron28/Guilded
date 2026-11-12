import { createCipheriv, randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const { migrateStoreSettings, importStoreCredential } = require("../companion-app/store-migrate.cjs");
const { readStoreSettings } = require("../companion-app/store-decrypt.cjs");

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

const CREDENTIAL = "c".repeat(40);

describe("Store sign-in taken over by a device-only install (9.1.4)", () => {
  const read = (settings: Record<string, unknown> | null) => async () => settings;
  it("brings the credential over and keeps the device key and WoW folder", async () => {
    const t = setup();
    const found = await importStoreCredential({ ...t, config: { device: true, deviceSecret: "dk", watchFile: "x" }, readSettings: read({ companionCredential: CREDENTIAL, guildDiscordId: "123", wowGuild: "Quebec Gold" }) });
    expect(found?.from).toBe(t.store);
    expect(found?.patch).toEqual({ companionCredential: CREDENTIAL, guildDiscordId: "123", wowGuild: "Quebec Gold" });
    expect(found?.patch).not.toHaveProperty("deviceSecret");
  });
  it("happens once: a second start, or a sign-out and restart, does not import again", async () => {
    const t = setup();
    const first = await importStoreCredential({ ...t, config: { deviceSecret: "dk" }, readSettings: read({ companionCredential: CREDENTIAL }) });
    expect(first?.patch.companionCredential).toBe(CREDENTIAL);
    // Device-only again (signed out, new account or reset), the Store copy still holds the old credential.
    const spy = vi.fn(read({ companionCredential: CREDENTIAL }));
    expect(await importStoreCredential({ ...t, config: { deviceSecret: "dk" }, readSettings: spy })).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });
  it("counts a failed or empty attempt too, and waits for a device key before trying", async () => {
    const t = setup();
    expect(await importStoreCredential({ ...t, config: {}, readSettings: read({ companionCredential: CREDENTIAL }) })).toBeNull();
    expect(existsSync(path.join(t.userData, "store-signin-import.done"))).toBe(false);
    expect(await importStoreCredential({ ...t, config: { deviceSecret: "dk" }, readSettings: read(null) })).toBeNull();
    expect(await importStoreCredential({ ...t, config: { deviceSecret: "dk" }, readSettings: read({ companionCredential: CREDENTIAL }) })).toBeNull();
  });
  it("never replaces a credential the install already has (the newer one wins)", async () => {
    const t = setup();
    expect(await importStoreCredential({ ...t, config: { deviceSecret: "dk", companionCredential: "n".repeat(40) }, readSettings: read({ companionCredential: CREDENTIAL }) })).toBeNull();
  });
  it("does nothing without a device key, or when the Store copy has no sign-in", async () => {
    const t = setup();
    expect(await importStoreCredential({ ...t, config: {}, readSettings: read({ companionCredential: CREDENTIAL }) })).toBeNull();
    expect(await importStoreCredential({ ...t, config: { deviceSecret: "dk" }, readSettings: read({ deviceSecret: "other" }) })).toBeNull();
    expect(await importStoreCredential({ ...t, config: { deviceSecret: "dk" }, readSettings: async () => { throw new Error("locked"); } })).toBeNull();
  });
  it("also looks in the store-settings-backup the installer leaves", async () => {
    const t = setup();
    const backup = path.join(t.userData, "store-settings-backup");
    mkdirSync(backup, { recursive: true });
    writeFileSync(path.join(backup, "config.secure"), "x");
    const seen: string[] = [];
    await importStoreCredential({ ...t, config: { deviceSecret: "dk" }, readSettings: async (dir: string) => { seen.push(dir); return null; } });
    expect(seen).toEqual([t.store, backup]);
  });
  it("opens a Store settings file with the Store's own key", async () => {
    const t = setup();
    const key = randomBytes(32), nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, nonce);
    const body = Buffer.concat([cipher.update(JSON.stringify({ companionCredential: CREDENTIAL }), "utf8"), cipher.final()]);
    writeFileSync(path.join(t.store, "config.secure"), Buffer.concat([Buffer.from("v10"), nonce, body, cipher.getAuthTag()]));
    writeFileSync(path.join(t.store, "Local State"), JSON.stringify({ os_crypt: { encrypted_key: Buffer.concat([Buffer.from("DPAPI"), Buffer.from("wrapped")]).toString("base64") } }));
    const settings = await readStoreSettings(t.store, { unprotect: async (blob: Buffer) => { expect(blob.toString()).toBe("wrapped"); return key; } });
    expect(settings).toEqual({ companionCredential: CREDENTIAL });
    await expect(readStoreSettings(t.store, { unprotect: async () => randomBytes(32) })).rejects.toThrow();
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
