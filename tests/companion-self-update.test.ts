import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

type Installer = { name: string; url: string; size: number; sha256: string };
type Shown = { version: string; installer?: Installer; unfinished?: boolean; url?: string } | null;
type Pending = { version: string; file: string; size: number; sha256: string };
const updates = createRequire(import.meta.url)("../companion-app/update-check.cjs") as {
  installerFrom: (assets: unknown, version: string) => Installer | null;
  fetchLatestRelease: (fetchImpl: unknown) => Promise<{ version: string; installer?: Installer } | null>;
  pickUpdate: (current: string, latest: unknown, bot?: string | null) => { version: string; installer?: Installer } | null;
  downloadInstaller: (installer: Installer, target: string, options: { fetchImpl: unknown }) => Promise<string>;
  INSTALLER_ARGS: string[];
  launchInstaller: (file: string, options: { spawnImpl: unknown }) => Promise<void>;
  checkInstaller: (file: string, expected: { size: number; sha256: string }, tempDir: string) => Promise<boolean>;
  unfinishedUpdate: (pending: Pending | undefined, current: string) => Pending | null;
  updateToShow: (next: Shown, pending: Pending | undefined, current: string) => Shown;
};

const bytes = Buffer.from("MZ installer bytes");
const sha256 = createHash("sha256").update(bytes).digest("hex");
const asset = { name: "Guilded.Companion.Setup.7.2.0.exe", size: bytes.length, digest: `sha256:${sha256}`, browser_download_url: "https://github.com/kevincaron28/Guilded/releases/download/v7.2.0/Guilded.Companion.Setup.7.2.0.exe" };
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const folder = () => { const dir = mkdtempSync(join(tmpdir(), "qg-update-")); dirs.push(dir); return dir; };
const serve = (body: Buffer, status = 200) => async () => ({ ok: status < 300, status, body: (async function* () { yield body.subarray(0, 5); yield body.subarray(5); })() });

describe("companion one-click update", () => {
  it("only accepts this repository's installer with GitHub's checksum", () => {
    expect(updates.installerFrom([asset], "7.2.0")).toEqual({ name: asset.name, url: asset.browser_download_url, size: bytes.length, sha256 });
    expect(updates.installerFrom([{ ...asset, digest: undefined }], "7.2.0")).toBeNull();
    expect(updates.installerFrom([{ ...asset, browser_download_url: "https://evil.example/Guilded.Companion.Setup.7.2.0.exe" }], "7.2.0")).toBeNull();
    expect(updates.installerFrom([asset], "7.3.0")).toBeNull();
  });

  it("carries the installer from the latest release, not from a bot version alone", async () => {
    const latest = await updates.fetchLatestRelease(async () => ({ ok: true, json: async () => ({ tag_name: "v7.2.0", html_url: "https://github.com/kevincaron28/Guilded/releases/tag/v7.2.0", assets: [asset] }) }));
    expect(updates.pickUpdate("7.1.0", latest)?.installer?.sha256).toBe(sha256);
    expect(updates.pickUpdate("7.1.0", null, "7.2.0")?.installer).toBeUndefined();
  });

  it("downloads and checks the installer, and removes a file that does not match", async () => {
    const dir = folder();
    const installer = updates.installerFrom([asset], "7.2.0")!;
    const target = join(dir, installer.name);
    expect(await updates.downloadInstaller(installer, target, { fetchImpl: serve(bytes) })).toBe(target);
    expect(readFileSync(target)).toEqual(bytes);
    const bad = join(dir, "bad.exe");
    await expect(updates.downloadInstaller(installer, bad, { fetchImpl: serve(Buffer.from("MZ tampered bytes!")) })).rejects.toThrow("checksum");
    await expect(updates.downloadInstaller(installer, bad, { fetchImpl: serve(Buffer.concat([bytes, bytes])) })).rejects.toThrow("larger");
    await expect(updates.downloadInstaller(installer, bad, { fetchImpl: serve(bytes, 404) })).rejects.toThrow("404");
    expect(existsSync(bad) || existsSync(`${bad}.part`)).toBe(false);
  });

  it("keeps Start with Windows when an upgrade runs the old uninstaller", () => {
    expect(readFileSync("companion-app/installer.nsh", "utf8")).toMatch(/\$\{ifNot\} \$\{isUpdated\}\s+DeleteRegValue/);
  });
});

// October 2026: the hidden (/S) installer failed without a word and the app closed anyway, so
// players stayed on 7.2.0 through 7.2.1 and 7.3.0.
describe("starting the installer", () => {
  const fakeSpawn = (event: "spawn" | "error") => {
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
    const spawnImpl = vi.fn(() => { setTimeout(() => event === "spawn" ? child.emit("spawn") : child.emit("error", new Error("spawn UNKNOWN")), 0); return child; });
    return { child, spawnImpl };
  };

  it("shows the installer (no /S) as an upgrade that starts the new version, and waits until Windows started it", async () => {
    const { child, spawnImpl } = fakeSpawn("spawn");
    await updates.launchInstaller("C:\\Temp\\Guilded.Companion.Setup.7.4.0.exe", { spawnImpl });
    expect(spawnImpl).toHaveBeenCalledWith("C:\\Temp\\Guilded.Companion.Setup.7.4.0.exe", ["--updated", "--force-run"], { detached: true, stdio: "ignore" });
    expect(updates.INSTALLER_ARGS).not.toContain("/S");
    expect(child.unref).toHaveBeenCalledOnce();
  });

  it("reports a refused start instead of letting the companion close", async () => {
    await expect(updates.launchInstaller("x.exe", { spawnImpl: fakeSpawn("error").spawnImpl })).rejects.toThrow("spawn UNKNOWN");
    await expect(updates.launchInstaller("x.exe", { spawnImpl: () => { throw new Error("EACCES"); } })).rejects.toThrow("EACCES");
  });

  it("closes the app only after the installer started, and never runs it hidden", () => {
    const main = readFileSync("companion-app/main.cjs", "utf8");
    expect(main).not.toContain('"/S"');
    expect(main).toMatch(/await updates\.launchInstaller\(target\);\s+quitting = true;\s+setTimeout\(\(\) => app\.quit\(\), 500\)/);
    // The note is saved before the installer runs, so a failed install is remembered.
    expect(main.indexOf("config.pendingUpdate = {")).toBeLessThan(main.indexOf("await updates.launchInstaller(target)"));
  });
});

describe("an update that did not finish", () => {
  const pending = (version: string, file = "C:\\Temp\\x.exe"): Pending => ({ version, file, size: bytes.length, sha256 });

  it("is offered again until the new version runs", () => {
    expect(updates.unfinishedUpdate(pending("7.4.0"), "7.3.0")?.version).toBe("7.4.0");
    expect(updates.unfinishedUpdate(pending("7.4.0"), "7.4.0")).toBeNull();
    expect(updates.unfinishedUpdate(undefined, "7.3.0")).toBeNull();
    // The banner: the unfinished one first, with GitHub's fresh installer when it is the same version.
    const github = updates.installerFrom([asset], "7.2.0")!;
    expect(updates.updateToShow({ version: "7.4.0", installer: github }, pending("7.4.0"), "7.3.0")).toMatchObject({ version: "7.4.0", unfinished: true, installer: github });
    expect(updates.updateToShow(null, pending("7.4.0"), "7.3.0")).toMatchObject({ version: "7.4.0", unfinished: true, url: "https://github.com/kevincaron28/Guilded/releases/latest" });
    // A newer release replaces it; once updated, the normal banner (or none) is back.
    expect(updates.updateToShow({ version: "7.5.0" }, pending("7.4.0"), "7.3.0")).toEqual({ version: "7.5.0" });
    expect(updates.updateToShow(null, pending("7.4.0"), "7.4.0")).toBeNull();
  });

  it("reruns the kept installer only while it is in the temp folder and unchanged", async () => {
    const dir = folder();
    const file = join(dir, "Guilded.Companion.Setup.7.2.0.exe");
    writeFileSync(file, bytes);
    expect(await updates.checkInstaller(file, { size: bytes.length, sha256 }, dir)).toBe(true);
    // Somewhere else, or not named like a release installer: refused, and left alone.
    expect(await updates.checkInstaller(file, { size: bytes.length, sha256 }, folder())).toBe(false);
    const other = join(dir, "setup.exe");
    writeFileSync(other, bytes);
    expect(await updates.checkInstaller(other, { size: bytes.length, sha256 }, dir)).toBe(false);
    expect(existsSync(other)).toBe(true);
    // Changed since the download: refused and removed, so the next try downloads it again.
    writeFileSync(file, Buffer.from("MZ changed bytes!!"));
    expect(await updates.checkInstaller(file, { size: bytes.length, sha256 }, dir)).toBe(false);
    expect(existsSync(file)).toBe(false);
    expect(await updates.checkInstaller(file, { size: bytes.length, sha256 }, dir)).toBe(false);
  });
});
