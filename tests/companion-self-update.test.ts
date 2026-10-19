import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

type Installer = { name: string; url: string; size: number; sha256: string };
const updates = createRequire(import.meta.url)("../companion-app/update-check.cjs") as {
  installerFrom: (assets: unknown, version: string) => Installer | null;
  fetchLatestRelease: (fetchImpl: unknown) => Promise<{ version: string; installer?: Installer } | null>;
  pickUpdate: (current: string, latest: unknown, bot?: string | null) => { version: string; installer?: Installer } | null;
  downloadInstaller: (installer: Installer, target: string, options: { fetchImpl: unknown }) => Promise<string>;
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
