import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
import { companionProblems, problemReport } from "../companion/problems.mjs";

// Free disk space before an update or an addon install (9.0): a second PC with 26 MB free on C:
// failed partway through an update. Under about 600 MB nothing starts and Problems says why.
const require = createRequire(import.meta.url);
const { checkDiskSpace, driveOf, DISK_SPACE_NEEDED_MB, LOW_DISK_MESSAGE } = require("../companion-app/disk-space.cjs");
const { runRepair } = require("../companion-app/repair.cjs");
const fr = require("../companion-app/locales/fr.json") as Record<string, string>;

const MB = 1024 * 1024;
// A fake statfs: free megabytes per drive letter.
const drives = (free: Record<string, number>) => (target: string) => {
  const mb = free[driveOf(target)];
  if (mb === undefined) throw new Error("ENOENT");
  return { bavail: BigInt(mb * 256), bsize: 4096 };
};

describe("checkDiskSpace", () => {
  it("needs about 600 MB", () => {
    expect(DISK_SPACE_NEEDED_MB).toBe(600);
  });

  it("refuses under the threshold and allows at or above it", () => {
    const paths = ["C:\\Users\\Pat\\AppData\\Local\\Programs\\Guilded Companion"];
    expect(checkDiskSpace({ paths, statfs: drives({ "C:\\": 26 }) })).toEqual({ ok: false, freeMb: 26, neededMb: 600, drive: "C:\\" });
    expect(checkDiskSpace({ paths, statfs: drives({ "C:\\": 599 }) }).ok).toBe(false);
    expect(checkDiskSpace({ paths, statfs: drives({ "C:\\": 600 }) }).ok).toBe(true);
    expect(checkDiskSpace({ paths, statfs: drives({ "C:\\": 50_000 }) }).ok).toBe(true);
  });

  it("checks every drive involved and reports the fullest one", () => {
    const paths = ["D:\\Games\\World of Warcraft\\_forever_\\Interface\\AddOns", "C:\\Users\\Pat\\AppData\\Local\\Temp", "c:\\Users\\Pat\\AppData\\Roaming\\Guilded Companion"];
    const statfs = vi.fn(drives({ "C:\\": 120, "D:\\": 90_000 }));
    expect(checkDiskSpace({ paths, statfs })).toMatchObject({ ok: false, freeMb: 120, drive: "C:\\" });
    expect(statfs).toHaveBeenCalledTimes(2); // C: and c: are one drive
    expect(checkDiskSpace({ paths, statfs: drives({ "C:\\": 9_000, "D:\\": 300 }) })).toMatchObject({ ok: false, freeMb: 300, drive: "D:\\" });
  });

  it("never blocks on a drive it cannot measure", () => {
    expect(checkDiskSpace({ paths: ["Z:\\Nowhere"], statfs: drives({}) })).toEqual({ ok: true, freeMb: null, neededMb: 600, drive: null });
    expect(checkDiskSpace({ paths: [null, "", undefined], statfs: drives({}) }).ok).toBe(true);
  });

  it("reads real numbers from statfs", () => {
    expect(checkDiskSpace({ paths: ["C:\\"], statfs: () => ({ bavail: 700 * MB / 4096, bsize: 4096 }) })).toMatchObject({ ok: true, freeMb: 700 });
  });

  it("names drives and network shares", () => {
    expect(driveOf("c:\\Program Files")).toBe("C:\\");
    expect(driveOf("\\\\nas\\games\\WoW")).toBe("\\\\NAS\\GAMES\\");
  });
});

describe("the low disk space problem", () => {
  const low = { ok: false, freeMb: 26, neededMb: 600, drive: "C:\\" };

  it("comes first in Problems, with only the two numbers", () => {
    const found = companionProblems({ config: { companionCredential: "x", watchFile: "C:\\x\\Guilded.lua" }, diskSpace: low, update: { version: "9.0.0", installer: {} }, version: "8.4.7", autoUpdate: false });
    expect(found[0]).toEqual({ id: "disk-space-low", data: { freeMb: 26, neededMb: 600 } });
    expect(companionProblems({ diskSpace: { ok: true, freeMb: 9000, neededMb: 600 } }).some((p) => p.id === "disk-space-low")).toBe(false);
    expect(companionProblems({ diskSpace: null }).some((p) => p.id === "disk-space-low")).toBe(false);
  });

  it("goes into the developer report without the drive", () => {
    const report = problemReport({ problems: companionProblems({ diskSpace: low }), reference: "ABCDEFGH" });
    expect(report.text).toContain("disk-space-low");
    expect(report.text).toContain("26");
    expect(report.text).not.toContain("C:\\");
  });

  it("is worded in English and French", () => {
    expect(LOW_DISK_MESSAGE).toBe("Not enough disk space: {0} MB free, about {1} MB needed. Free space with Windows Settings > Storage, then retry.");
    expect(fr[LOW_DISK_MESSAGE]).toContain("Stockage");
    const page = readFileSync("companion-app/renderer/problems.js", "utf8");
    expect(page).toContain("case 'disk-space-low'");
    for (const key of ["Open Storage settings", "Check again", "There is enough free disk space now. Try again.", "Removed an old copy of the companion installer to free disk space."]) expect(fr[key], key).toBeTruthy();
  });
});

describe("Repair with a full disk", () => {
  const base = {
    wowEnabled: true,
    watchFile: () => "C:\\WoW\\_forever_\\WTF\\Account\\A\\SavedVariables\\Guilded.lua",
    watchedFileExists: async () => true,
    searchWow: () => ({ entries: [], installs: [] }),
    pick: () => null,
    setWatchFile: async () => {},
    addonDecision: async () => ({ action: "update", reason: "older" }),
    signedIn: () => true,
    me: async () => ({ ok: true, personal: false, account: { username: "pat" } }),
    syncConfigured: () => true,
    syncRunning: () => true,
    restartSync: async () => {}
  };

  it("says how much space is missing and does not start the addon install", async () => {
    const installAddon = vi.fn(async () => ({ version: "9.0.0", backup: null }));
    const results = await runRepair({ ...base, installAddon, diskSpace: () => ({ ok: false, freeMb: 26, neededMb: 600 }) });
    expect(results[0]).toEqual({ id: "disk", status: "needs-you", text: [LOW_DISK_MESSAGE, 26, 600] });
    expect(results.find((item: { id: string }) => item.id === "addon")).toMatchObject({ status: "needs-you" });
    expect(installAddon).not.toHaveBeenCalled();
    for (const item of results) expect(fr[item.text[0]], item.text[0]).toBeTruthy();
  });

  it("goes on as usual with enough space", async () => {
    const installAddon = vi.fn(async () => ({ version: "9.0.0", backup: null }));
    const results = await runRepair({ ...base, installAddon, diskSpace: () => ({ ok: true, freeMb: 5000, neededMb: 600 }) });
    expect(results[0]).toMatchObject({ id: "disk", status: "ok" });
    expect(installAddon).toHaveBeenCalledOnce();
  });
});

describe("the updater's installer copy", () => {
  it("is removed after every install and update, and on start", () => {
    const nsis = readFileSync("companion-app/installer.nsh", "utf8");
    const install = nsis.slice(nsis.indexOf("!macro customInstall"));
    expect(install).toContain('RMDir /r "$LOCALAPPDATA\\guilded-companion-updater"');
    const main = readFileSync("companion-app/main.cjs", "utf8");
    expect(main).toMatch(/function removeStaleUpdaterCopy\(\)[\s\S]*"guilded-companion-updater"/);
    expect(main).toMatch(/config\.lastRunVersion = current;\s*removeStaleUpdaterCopy\(\);/);
  });

  it("is checked before every update and addon install", () => {
    const main = readFileSync("companion-app/main.cjs", "utf8");
    expect(main).toMatch(/async function stageUpdate\(\)[\s\S]{0,300}checkDisk\(\)/);
    expect(main).toMatch(/async function installAddonNow[\s\S]{0,400}checkDisk\(\)/);
    expect(main).toMatch(/launchInstallerOnExit/);
    expect(main).toMatch(/checkDisk\(\)\.ok && updates\.launchInstallerOnExit/);
    const pkg = JSON.parse(readFileSync("companion-app/package.json", "utf8"));
    expect(pkg.build.files).toContain("disk-space.cjs");
  });
});
