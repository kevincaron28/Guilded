import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateRawSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";

// Install addon / Update addon (8.5, track F3): companion-app/addon-installer.cjs.
const installer = createRequire(import.meta.url)("../companion-app/addon-installer.cjs");
const sha = (data: Buffer) => createHash("sha256").update(data).digest("hex");

// A minimal zip writer for the tests: stored or deflated entries, central directory, end record.
function zip(entries: { name: string; data?: string; deflate?: boolean }[]): Buffer {
  const locals: Buffer[] = [], centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const raw = Buffer.from(entry.data ?? "", "utf8");
    const packed = entry.deflate ? deflateRawSync(raw) : raw;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(entry.deflate ? 8 : 0, 8);
    local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(entry.deflate ? 8 : 0, 10);
    central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(raw.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(offset, 42);
    locals.push(local, name, packed); centrals.push(central, name);
    offset += 30 + name.length + packed.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
const goodZip = () => zip([
  { name: "Guilded/" },
  { name: "Guilded/Guilded.toc", data: "## Interface: 11508\n## Version: 8.5.0\n", deflate: true },
  { name: "Guilded/Core.lua", data: "local x = 1\n".repeat(50), deflate: true },
  { name: "Guilded/Locale/fr.lua", data: "-- fr\n" }
]);

const folders: string[] = [];
afterEach(() => { for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true }); });
function addOns() {
  const root = mkdtempSync(join(tmpdir(), "guilded-addon-"));
  folders.push(root);
  return join(root, "World of Warcraft", "_forever_", "Interface", "AddOns");
}

describe("addon install: what to offer", () => {
  const folder = "C:\\WoW\\_forever_\\Interface\\AddOns\\Guilded";
  const decide = (addon: object, extra: object = {}) => installer.decideAddonInstall({ addon: { folder, expected: "forever", ...addon }, companionVersion: "8.5.0", ...extra });
  it("installs when missing and updates a wrong or older build", () => {
    expect(decide({ status: "not-installed" })).toEqual({ action: "install", reason: "missing" });
    expect(decide({ status: "wrong-edition", installed: ["classic-tbc"] })).toEqual({ action: "update", reason: "wrong-edition" });
    expect(decide({ status: "ok", version: "8.4.7" })).toEqual({ action: "update", reason: "older" });
  });
  it("offers nothing when current, newer, unchecked, on hold or not Forever", () => {
    expect(decide({ status: "ok", version: "8.5.0" }).action).toBe("none");
    expect(decide({ status: "ok", version: "8.6.0" }).action).toBe("none");
    expect(decide({ status: "ok", version: null }).action).toBe("none");
    expect(decide({ status: "on-hold" }).action).toBe("none");
    expect(decide({ status: "not-installed", expected: "retail" }).reason).toBe("not-forever");
    expect(installer.decideAddonInstall({ addon: { status: "unchecked" }, companionVersion: "8.5.0" }).action).toBe("none");
    expect(decide({ status: "not-installed" }, { companionVersion: "dev" }).reason).toBe("no-release");
    expect(decide({ status: "not-installed" }, { wowEnabled: false }).reason).toBe("wow-off");
  });
  it("keeps the offer but blocks it while WoW runs", () => {
    expect(decide({ status: "not-installed" }, { wowRunning: true })).toEqual({ action: "install", reason: "missing", blocked: "wow-running" });
  });
  it("names the release files of this companion version", () => {
    expect(installer.releaseAssets("8.5.0")).toEqual({
      version: "8.5.0", zipName: "Guilded-v8.5.0-forever.zip",
      zip: "https://github.com/kevincaron28/Guilded/releases/download/v8.5.0/Guilded-v8.5.0-forever.zip",
      sums: "https://github.com/kevincaron28/Guilded/releases/download/v8.5.0/SHA256SUMS-v8.5.0.txt"
    });
    expect(installer.releaseAssets("")).toBeNull();
  });
});

describe("addon install: checksum", () => {
  const hash = "48609ffa17bb7c189146234cc3752fc5a4ece0e23240277a179c013025b0234f";
  it("reads the zip's line from SHA256SUMS, not a similar name", () => {
    const sums = `358191c01d28cf0ce7c099f9dbf133c60b8ec83941f964f2d367e44736289b8e  Guilded-v8.4.7.zip\r\n${hash.toUpperCase()}  Guilded-v8.4.7-forever.zip\r\n3eaad3e1e7b4d87dfd4e92e8a0650ad368f0e1f5fa2df0148a9d4620e7e104f2  GuildedDungeons-v8.4.7-forever.zip\r\n`;
    expect(installer.checksumFor(sums, "Guilded-v8.4.7-forever.zip")).toBe(hash);
    expect(installer.checksumFor(`${hash} *Guilded-v8.4.7-forever.zip`, "Guilded-v8.4.7-forever.zip")).toBe(hash);
    expect(installer.checksumFor(sums, "Guilded-v8.5.0-forever.zip")).toBeNull();
  });
  it("accepts only the exact bytes", () => {
    const data = goodZip();
    expect(installer.verifyChecksum(data, sha(data))).toBe(true);
    expect(() => installer.verifyChecksum(Buffer.concat([data, Buffer.from("x")]), sha(data))).toThrow(/did not match/);
    expect(() => installer.verifyChecksum(data, null)).toThrow(/no checksum/);
  });
});

describe("addon install: zip", () => {
  it("reads stored and deflated files inside Guilded/", () => {
    const files = installer.readZip(goodZip());
    expect(files.map((file: { name: string }) => file.name)).toEqual(["Guilded/Guilded.toc", "Guilded/Core.lua", "Guilded/Locale/fr.lua"]);
    expect(files[1].data.toString()).toBe("local x = 1\n".repeat(50));
  });
  it("refuses paths outside Guilded/, a zip without Guilded.toc, and junk", () => {
    expect(() => installer.readZip(zip([{ name: "Guilded/Guilded.toc" }, { name: "Guilded/../../evil.lua", data: "x" }]))).toThrow(/unexpected path/);
    expect(() => installer.readZip(zip([{ name: "Guilded/Guilded.toc" }, { name: "Other/x.lua" }]))).toThrow(/unexpected path/);
    expect(() => installer.readZip(zip([{ name: "Guilded/Guilded.toc" }, { name: "C:/Windows/x.dll" }]))).toThrow(/unexpected path/);
    expect(() => installer.readZip(zip([{ name: "Guilded/Core.lua" }]))).toThrow(/no Guilded.toc/);
    expect(() => installer.readZip(Buffer.from("not a zip at all, not a zip at all"))).toThrow(/not a zip/);
  });
});

describe("addon install: files on disk", () => {
  it("installs into an empty AddOns folder", () => {
    const target = addOns();
    const result = installer.installAddonFiles({ addOnsFolder: target, files: installer.readZip(goodZip()) });
    expect(result.backup).toBeNull();
    expect(readFileSync(join(target, "Guilded", "Guilded.toc"), "utf8")).toContain("8.5.0");
    expect(existsSync(join(target, "Guilded", "Locale", "fr.lua"))).toBe(true);
    expect(readdirSync(join(target, ".."))).toEqual(["AddOns"]);
  });
  it("moves an existing Guilded folder to a backup outside AddOns first", () => {
    const target = addOns();
    mkdirSync(join(target, "Guilded"), { recursive: true });
    writeFileSync(join(target, "Guilded", "Guilded.toc"), "## Version: 8.4.7\n");
    writeFileSync(join(target, "Guilded", "Old.lua"), "old");
    const result = installer.installAddonFiles({ addOnsFolder: target, files: installer.readZip(goodZip()), now: new Date("2026-11-06T14:20:03.120Z") });
    expect(result.backup).toBe(join(target, "..", "Guilded backups", "Guilded-2026-11-06T14-20-03Z"));
    expect(readFileSync(join(result.backup, "Old.lua"), "utf8")).toBe("old");
    expect(existsSync(join(target, "Guilded", "Old.lua"))).toBe(false);
    expect(readdirSync(target)).toEqual(["Guilded"]);
  });
});

describe("addon install: whole flow", () => {
  const data = goodZip();
  const fetchFrom = (files: Record<string, Buffer | string>) => async (url: string) => {
    const name = url.split("/").pop() as string;
    const body = files[name];
    return body === undefined
      ? { ok: false, status: 404, headers: new Map(), arrayBuffer: async () => new ArrayBuffer(0) }
      : { ok: true, status: 200, headers: new Map(), arrayBuffer: async () => { const buffer = Buffer.from(body); return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.length); } };
  };
  const addonIn = (target: string) => ({ status: "not-installed", expected: "forever", folder: join(target, "Guilded") });
  it("downloads, verifies and installs the release that matches the companion", async () => {
    const target = addOns();
    const fetchImpl = fetchFrom({ "SHA256SUMS-v8.5.0.txt": `${sha(data)}  Guilded-v8.5.0-forever.zip\n`, "Guilded-v8.5.0-forever.zip": data });
    const result = await installer.installAddon({ addon: addonIn(target), companionVersion: "8.5.0", fetchImpl });
    expect(result).toMatchObject({ action: "install", version: "8.5.0", files: 3, backup: null });
    expect(existsSync(join(target, "Guilded", "Guilded.toc"))).toBe(true);
  });
  it("installs nothing when the checksum differs or is missing", async () => {
    const target = addOns();
    const wrong = fetchFrom({ "SHA256SUMS-v8.5.0.txt": `${"0".repeat(64)}  Guilded-v8.5.0-forever.zip\n`, "Guilded-v8.5.0-forever.zip": data });
    await expect(installer.installAddon({ addon: addonIn(target), companionVersion: "8.5.0", fetchImpl: wrong })).rejects.toThrow(/did not match/);
    const none = fetchFrom({ "SHA256SUMS-v8.5.0.txt": "", "Guilded-v8.5.0-forever.zip": data });
    await expect(installer.installAddon({ addon: addonIn(target), companionVersion: "8.5.0", fetchImpl: none })).rejects.toThrow(/no checksum/);
    expect(existsSync(join(target, "Guilded"))).toBe(false);
  });
  it("refuses while WoW runs, before downloading anything", async () => {
    let calls = 0;
    const fetchImpl = async () => { calls++; throw new Error("no network in this test"); };
    await expect(installer.installAddon({ addon: addonIn(addOns()), companionVersion: "8.5.0", wowRunning: true, fetchImpl })).rejects.toThrow(/WoW is running/);
    expect(calls).toBe(0);
  });
});
