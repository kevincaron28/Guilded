import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateRawSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";

// Roadmap "Companion updates itself from the website too" (8 November 2026: GitHub release downloads
// timed out for hours). The update check, the installer download and the addon download use the
// website first and GitHub second, with the same size and SHA-256 checks either way.
type Installer = { name: string; url: string; size: number | null; sha256: string };
const require = createRequire(import.meta.url);
const updates = require("../companion-app/update-check.cjs") as {
  fetchLatestRelease: (fetchImpl: unknown) => Promise<{ version: string; url: string; installer?: Installer } | null>;
  downloadInstaller: (installer: Installer, target: string, options: { fetchImpl: unknown }) => Promise<string>;
  installerSources: (installer: Partial<Installer>) => string[];
  SITE_RELEASES: string;
};
const addons = require("../companion-app/addon-installer.cjs") as {
  installAddon: (input: Record<string, unknown>) => Promise<{ version: string; files: number }>;
  siteChecksumFor: (guilded: unknown, name: string) => string | null;
};

const sha = (data: Buffer) => createHash("sha256").update(data).digest("hex");
const bytes = Buffer.from("MZ installer bytes from the website");
const siteJson = (more: Record<string, unknown> = {}) => ({
  guilded: {
    github: { version: "9.1.0", url: "https://github.com/kevincaron28/Guilded/releases/tag/v9.1.0" },
    companionDirect: { version: "9.1.0", url: "https://github.com/kevincaron28/Guilded/releases/latest/download/Guilded.Companion.Setup.exe", siteUrl: "https://guilded.kcaron.top/downloads/Guilded.Companion.Setup.exe", size: bytes.length, sha256: sha(bytes) },
    ...more
  }
});
const githubRelease = { tag_name: "v9.1.0", html_url: "https://github.com/kevincaron28/Guilded/releases/tag/v9.1.0", assets: [{ name: "Guilded.Companion.Setup.9.1.0.exe", size: bytes.length, digest: `sha256:${sha(bytes)}`, browser_download_url: "https://github.com/kevincaron28/Guilded/releases/download/v9.1.0/Guilded.Companion.Setup.9.1.0.exe" }] };

type Route = (url: string) => unknown;
const calls: string[] = [];
const fetchVia = (route: Route) => async (url: string) => { calls.push(url); const answer = route(url); if (answer instanceof Error) throw answer; return answer; };
const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const missing = { ok: false, status: 504, headers: new Map(), json: async () => ({}), arrayBuffer: async () => new ArrayBuffer(0) };
const stream = (body: Buffer, headers: Record<string, string> = {}) => ({
  ok: true, status: 200, headers: new Map(Object.entries(headers)),
  body: (async function* () { yield body.subarray(0, 4); yield body.subarray(4); })()
});

const dirs: string[] = [];
afterEach(() => { calls.length = 0; for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const folder = () => { const dir = mkdtempSync(join(tmpdir(), "qg-site-")); dirs.push(dir); return dir; };

describe("update check: website first", () => {
  it("reads the version, size and SHA-256 from the website and downloads the versioned installer from it", async () => {
    const latest = await updates.fetchLatestRelease(fetchVia((url) => url === updates.SITE_RELEASES ? json(siteJson()) : new Error("GitHub not needed")));
    expect(latest).toEqual({
      version: "9.1.0", url: "https://github.com/kevincaron28/Guilded/releases/tag/v9.1.0",
      installer: { name: "Guilded.Companion.Setup.9.1.0.exe", url: "https://guilded.kcaron.top/downloads/Guilded.Companion.Setup.9.1.0.exe", size: bytes.length, sha256: sha(bytes) }
    });
    expect(calls).toEqual([updates.SITE_RELEASES]);
  });

  it("asks GitHub when the website fails, times out or answers oddly", async () => {
    for (const site of [new Error("timeout"), missing, json({}), json(siteJson({ companionDirect: { version: "9.1.0", sha256: "nope" } })), json({ guilded: { companionDirect: { version: "beta", sha256: sha(bytes) } } })]) {
      const latest = await updates.fetchLatestRelease(fetchVia((url) => url === updates.SITE_RELEASES ? site : json(githubRelease)));
      expect(latest?.installer?.url).toBe(githubRelease.assets[0]!.browser_download_url);
    }
    expect(await updates.fetchLatestRelease(fetchVia(() => new Error("offline")))).toBeNull();
  });

  it("never sends the member to a release page outside this repository", async () => {
    const odd = siteJson({ github: { version: "9.1.0", url: "https://evil.example/" } });
    expect((await updates.fetchLatestRelease(fetchVia(() => json(odd))))?.url).toBe("https://github.com/kevincaron28/Guilded/releases/latest");
  });
});

describe("installer download: website, then GitHub, one checksum", () => {
  const installer: Installer = { name: "Guilded.Companion.Setup.9.1.0.exe", url: "https://guilded.kcaron.top/downloads/Guilded.Companion.Setup.9.1.0.exe", size: bytes.length, sha256: sha(bytes) };
  const github = "https://github.com/kevincaron28/Guilded/releases/download/v9.1.0/Guilded.Companion.Setup.9.1.0.exe";

  it("tries the website copy first and the GitHub asset second, for either kind of update", () => {
    expect(updates.installerSources(installer)).toEqual([installer.url, github]);
    expect(updates.installerSources({ ...installer, url: github })).toEqual([installer.url, github]);
    expect(updates.installerSources({ ...installer, url: "https://evil.example/x.exe", name: "x.exe" })).toEqual([]);
  });

  it("falls back to GitHub when the website does not answer or serves other bytes", async () => {
    for (const site of [new Error("timeout"), missing, stream(Buffer.from("MZ some other installer bytes!!!!!!!")), stream(bytes, { "x-sha256": "0".repeat(64) })]) {
      const target = join(folder(), installer.name);
      await updates.downloadInstaller(installer, target, { fetchImpl: fetchVia((url) => url === github ? stream(bytes) : site) });
      expect(readFileSync(target)).toEqual(bytes);
    }
  });

  it("uses the server's length when releases.json gives no size, and keeps nothing that fails everywhere", async () => {
    const target = join(folder(), installer.name);
    await updates.downloadInstaller({ ...installer, size: null }, target, { fetchImpl: fetchVia(() => stream(bytes, { "content-length": String(bytes.length) })) });
    expect(calls).toEqual([installer.url]);
    const bad = join(folder(), installer.name);
    await expect(updates.downloadInstaller({ ...installer, size: null }, bad, { fetchImpl: fetchVia(() => stream(bytes)) })).rejects.toThrow("no known size");
    await expect(updates.downloadInstaller(installer, bad, { fetchImpl: fetchVia(() => stream(Buffer.from("MZ tampered bytes, same length!!!!!"))) })).rejects.toThrow("checksum");
    expect(existsSync(bad) || existsSync(`${bad}.part`)).toBe(false);
  });
});

describe("addon download: website, then GitHub", () => {
  // A minimal stored zip with Guilded/Guilded.toc.
  function zipOf(files: Record<string, string>) {
    const locals: Buffer[] = [], centrals: Buffer[] = [];
    let offset = 0;
    for (const [name, text] of Object.entries(files)) {
      const data = Buffer.from(text), packed = deflateRawSync(data), nameBytes = Buffer.from(name);
      const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBytes.length, 26);
      const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(8, 10); central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBytes.length, 28); central.writeUInt32LE(offset, 42);
      locals.push(local, nameBytes, packed); centrals.push(central, nameBytes);
      offset += 30 + nameBytes.length + packed.length;
    }
    const directory = Buffer.concat(centrals), end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, directory, end]);
  }
  const zip = zipOf({ "Guilded/Guilded.toc": "## Version: 9.1.0\n", "Guilded/Core.lua": "-- core\n" });
  const name = "Guilded-v9.1.0-forever.zip";
  const site = `https://guilded.kcaron.top/downloads/${name}`, github = `https://github.com/kevincaron28/Guilded/releases/download/v9.1.0/${name}`;
  const sums = "https://github.com/kevincaron28/Guilded/releases/download/v9.1.0/SHA256SUMS-v9.1.0.txt";
  const body = (data: Buffer) => ({ ok: true, status: 200, headers: new Map(), arrayBuffer: async () => data.buffer.slice(data.byteOffset, data.byteOffset + data.length) });
  const addon = () => ({ status: "not-installed", expected: "forever", folder: join(folder(), "Interface", "AddOns", "Guilded") });

  it("reads the zip's hash from releases.json (addonZips) and installs the website's copy, without GitHub", async () => {
    const result = await addons.installAddon({ addon: addon(), companionVersion: "9.1.0", fetchImpl: fetchVia((url) => url === updates.SITE_RELEASES ? json(siteJson({ addonZips: { [name]: sha(zip) } })) : url === site ? body(zip) : new Error(`not expected: ${url}`)) });
    expect(result).toMatchObject({ version: "9.1.0", files: 2 });
    expect(calls).toEqual([updates.SITE_RELEASES, site]);
  });

  it("falls back to GitHub's zip when the website does not have it or serves other bytes", async () => {
    for (const siteZip of [missing, new Error("timeout"), body(zipOf({ "Guilded/Guilded.toc": "## Version: 9.0.0\n" }))]) {
      const result = await addons.installAddon({ addon: addon(), companionVersion: "9.1.0", fetchImpl: fetchVia((url) => url === updates.SITE_RELEASES ? json(siteJson({ addonZips: { [name]: sha(zip) } })) : url === site ? siteZip : url === github ? body(zip) : new Error(`not expected: ${url}`)) });
      expect(result.files).toBe(2);
    }
  });

  it("uses GitHub's SHA256SUMS when the website does not list this zip", async () => {
    const result = await addons.installAddon({ addon: addon(), companionVersion: "9.1.0", fetchImpl: fetchVia((url) => url === updates.SITE_RELEASES ? missing : url === sums ? body(Buffer.from(`${sha(zip)} *${name}\n`)) : url === site ? body(zip) : new Error(`not expected: ${url}`)) });
    expect(result.files).toBe(2);
    expect(calls).toEqual([updates.SITE_RELEASES, sums, site]);
  });

  it("only takes a well-formed hash from releases.json", () => {
    expect(addons.siteChecksumFor({ addonZips: { [name]: sha(zip) } }, name)).toBe(sha(zip));
    expect(addons.siteChecksumFor({ addonZips: { [name]: "abc" } }, name)).toBeNull();
    expect(addons.siteChecksumFor(null, name)).toBeNull();
  });

  it("Get the addon opens the website's zip when it is there, otherwise GitHub's", () => {
    const main = readFileSync("companion-app/main.cjs", "utf8");
    expect(main).toContain("const mirror = engineModules.addonDownloadMirror?.(edition, version) ?? primary;");
    expect(main).toContain('fetch(primary, { method: "HEAD"');
  });
});
