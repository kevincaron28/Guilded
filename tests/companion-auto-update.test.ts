import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

type Installer = { name: string; url: string; size: number; sha256: string };
type Latest = { version: string; url: string; installer?: Installer };
const updates = createRequire(import.meta.url)("../companion-app/update-check.cjs") as {
  isStoreInstall: (input: { windowsStore?: boolean; execPath?: string }) => boolean;
  decideAutoUpdate: (input: Record<string, unknown>) => { action: string; reason?: string; update?: { version: string } };
  inspectPending: (input: { pending: unknown; current: string; directory: string }) => { action: string; reason?: string; file?: string; version?: string };
  launchInstallerOnExit: (target: string, spawn: unknown) => boolean;
  isNewer: (candidate: string, current: string) => boolean;
  DIRECT_DOWNLOAD_URL: string;
  CHECK_INTERVAL_MS: number;
};

const bytes = Buffer.from("MZ pretend installer");
const sha256 = createHash("sha256").update(bytes).digest("hex");
const installer: Installer = { name: "Guilded.Companion.Setup.8.5.0.exe", size: bytes.length, sha256, url: "https://github.com/kevincaron28/Guilded/releases/download/v8.5.0/Guilded.Companion.Setup.8.5.0.exe" };
const latest: Latest = { version: "8.5.0", url: "https://github.com/kevincaron28/Guilded/releases/tag/v8.5.0", installer };
const direct = { store: false, packaged: true, platform: "win32", enabled: true, current: "8.4.6", latest };

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const folder = () => { const dir = mkdtempSync(join(tmpdir(), "qg-autoupdate-")); dirs.push(dir); return dir; };

describe("automatic update decision", () => {
  it("downloads a newer, checked release on the direct-download build", () => {
    expect(updates.decideAutoUpdate(direct)).toMatchObject({ action: "download", update: { version: "8.5.0" } });
  });

  it("compares versions numerically and does nothing when current or ahead", () => {
    expect(updates.decideAutoUpdate({ ...direct, current: "8.5.0" })).toEqual({ action: "none" });
    expect(updates.decideAutoUpdate({ ...direct, current: "8.10.0" })).toEqual({ action: "none" });
    expect(updates.decideAutoUpdate({ ...direct, current: "8.4.6", latest: { ...latest, version: "8.4.10" } })).toMatchObject({ action: "download" });
    expect(updates.decideAutoUpdate({ ...direct, latest: null })).toEqual({ action: "none" });
    expect(updates.isNewer("8.4.10", "8.4.9")).toBe(true);
  });

  it("never self-updates the Microsoft Store build", () => {
    expect(updates.isStoreInstall({ windowsStore: true })).toBe(true);
    expect(updates.isStoreInstall({ execPath: "C:\\Program Files\\WindowsApps\\Guilded_8.4.6.0_x64__abc\\Guilded.exe" })).toBe(true);
    expect(updates.isStoreInstall({ execPath: "C:\\Users\\Kev\\AppData\\Local\\Programs\\guilded-companion\\Guilded Companion.exe" })).toBe(false);
    expect(updates.decideAutoUpdate({ ...direct, store: true })).toEqual({ action: "skip", reason: "store" });
  });

  it("respects the opt-out and never updates a development checkout", () => {
    expect(updates.decideAutoUpdate({ ...direct, enabled: false })).toEqual({ action: "skip", reason: "disabled" });
    expect(updates.decideAutoUpdate({ ...direct, packaged: false })).toEqual({ action: "skip", reason: "unpackaged" });
    expect(updates.decideAutoUpdate({ ...direct, platform: "darwin" })).toEqual({ action: "skip", reason: "unpackaged" });
  });

  it("needs a checksummed installer and does not download twice", () => {
    expect(updates.decideAutoUpdate({ ...direct, latest: { ...latest, installer: undefined } })).toEqual({ action: "skip", reason: "no-checked-installer" });
    expect(updates.decideAutoUpdate({ ...direct, pending: { version: "8.5.0", sha256 } })).toMatchObject({ action: "staged" });
  });

  it("checks every few hours, well inside GitHub's anonymous rate limit", () => {
    expect(updates.CHECK_INTERVAL_MS).toBeGreaterThanOrEqual(3 * 3600_000);
    expect(updates.CHECK_INTERVAL_MS).toBeLessThanOrEqual(12 * 3600_000);
  });
});

describe("installing a downloaded update", () => {
  function staged(content: Buffer = bytes) {
    const directory = join(folder(), "updates");
    mkdirSync(directory);
    const file = join(directory, installer.name);
    writeFileSync(file, content);
    return { directory, file, pending: { version: "8.5.0", file, sha256, attempts: 0 } };
  }

  it("installs a staged file whose checksum still matches", () => {
    const { directory, file, pending } = staged();
    expect(updates.inspectPending({ pending, current: "8.4.6", directory })).toMatchObject({ action: "install", file, version: "8.5.0" });
  });

  it("rejects a file that no longer matches the release checksum", () => {
    const { directory, pending } = staged(Buffer.from("MZ tampered installer"));
    expect(updates.inspectPending({ pending, current: "8.4.6", directory })).toEqual({ action: "clear", reason: "checksum" });
  });

  it("drops stale, missing, relocated and over-tried downloads", () => {
    const { directory, file, pending } = staged();
    expect(updates.inspectPending({ pending, current: "8.5.0", directory })).toEqual({ action: "clear", reason: "installed" });
    expect(updates.inspectPending({ pending: { ...pending, attempts: 2 }, current: "8.4.6", directory })).toEqual({ action: "clear", reason: "attempts" });
    expect(updates.inspectPending({ pending: { ...pending, file: join(folder(), installer.name) }, current: "8.4.6", directory })).toEqual({ action: "clear", reason: "location" });
    expect(updates.inspectPending({ pending: { ...pending, file: join(directory, "evil.exe") }, current: "8.4.6", directory })).toEqual({ action: "clear", reason: "location" });
    rmSync(file);
    expect(updates.inspectPending({ pending, current: "8.4.6", directory })).toEqual({ action: "clear", reason: "missing" });
    expect(updates.inspectPending({ pending: { version: "x" }, current: "8.4.6", directory })).toEqual({ action: "clear", reason: "invalid" });
    expect(updates.inspectPending({ pending: undefined, current: "8.4.6", directory })).toEqual({ action: "none" });
    expect(existsSync(directory)).toBe(true);
  });

  it("starts the quiet installer on exit without restarting the app, and survives a spawn failure", () => {
    const unref = vi.fn();
    const spawn = vi.fn(() => ({ unref }));
    expect(updates.launchInstallerOnExit("C:\\x\\setup.exe", spawn)).toBe(true);
    expect(spawn).toHaveBeenCalledWith("C:\\x\\setup.exe", ["/S", "--updated"], expect.objectContaining({ detached: true }));
    expect(unref).toHaveBeenCalledOnce();
    expect(updates.launchInstallerOnExit("C:\\x\\setup.exe", () => { throw new Error("EACCES"); })).toBe(false);
  });
});

describe("direct-download page and release process", () => {
  const pages = ["site/pages/companion.md", "site/pages/companion.fr.md"].map(path => readFileSync(path, "utf8"));
  const guilded = JSON.parse(readFileSync("site/releases.json", "utf8")).guilded;
  const published = guilded.companionDirect as { url: string; siteUrl: string; sha256: string; version: string; size: number };

  it("uses one stable URL that always serves the newest installer: the website's, GitHub's for older companions", () => {
    // 8 November 2026: GitHub release downloads timed out for hours, so the website copy leads.
    expect(published.siteUrl).toBe(updates.DIRECT_DOWNLOAD_URL);
    expect(published.siteUrl).toBe("https://guilded.kcaron.top/downloads/Guilded.Companion.Setup.exe");
    // Kept for links and companions from before the website copy.
    expect(published.url).toBe("https://github.com/kevincaron28/Guilded/releases/latest/download/Guilded.Companion.Setup.exe");
    expect(published.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(Number.isInteger(published.size) && published.size > 1_000_000).toBe(true);
  });

  it("lists the SHA-256 of every addon zip the website serves, for this release", () => {
    const zips = readdirSync("site/downloads").filter((name) => name.endsWith(".zip")).sort();
    expect(Object.keys(guilded.addonZips).sort()).toEqual(zips);
    for (const name of zips) {
      expect(name).toContain(`-v${published.version}-forever.zip`);
      expect(guilded.addonZips[name]).toBe(createHash("sha256").update(readFileSync(`site/downloads/${name}`)).digest("hex"));
    }
  });

  it("publishes releases.json with the website", () => {
    expect(readFileSync("scripts/build-site.mjs", "utf8")).toContain('copyFileSync("site/releases.json", `${out}/releases.json`)');
  });

  it.each([0, 1])("offers Store and direct download with the SmartScreen note and SHA-256 (page %i)", (index) => {
    const page = pages[index]!;
    expect(page).toContain("apps.microsoft.com/detail/9N680XX3QFL9");
    expect(page.match(/\{\{COMPANION_DIRECT_URL\}\}/g)!.length).toBeGreaterThanOrEqual(2);
    expect(page).toContain("{{COMPANION_DIRECT_SHA256}}");
    expect(page).toContain(index === 0 ? "More info → Run anyway" : "Exécuter quand même");
    // The plug-and-play download leads (owner, 7 November); the Store stays one click away.
    expect(page).toContain(index === 0 ? "Download for Windows" : "Télécharger pour Windows");
    expect(page).toContain(index === 0 ? "Already have Guilded Companion from the Microsoft Store?" : "Vous avez déjà Guilded Companion du Microsoft Store ?");
  });

  it("makes every release carry a fixed-name copy of the installer", () => {
    expect(readFileSync("scripts/verify-release-artifacts.mjs", "utf8")).toContain('name: "Guilded.Companion.Setup.exe"');
  });
});
