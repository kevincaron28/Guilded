import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const autostart = require("../companion-app/autostart.cjs");

const EXE = String.raw`"C:\Users\x\AppData\Local\Programs\Guilded Companion\Guilded Companion.exe" --hidden`;
const reg = (rows: [string, string][]) => ["", String.raw`HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Run`, ...rows.map(([name, data]) => `    ${name}    REG_SZ    ${data}`), ""].join("\r\n");

// A fake `reg` that keeps a Run key and a StartupApproved mirror, like Windows.
function fakeRegistry(initial: [string, string][]) {
  const run = new Map(initial);
  const approved = new Set(initial.map(([name]) => name));
  const calls: string[] = [];
  const exec = async (file: string, args: string[]) => {
    calls.push(`${file} ${args.join(" ")}`);
    if (args[0] === "query") return { ok: true, stdout: reg([...run.entries()]) };
    if (args[0] === "delete") {
      const key = args[1] ?? "";
      const name = args[3] ?? "";
      if (key.endsWith("StartupApproved\\Run")) { approved.delete(name); return { ok: true, stdout: "" }; }
      const had = run.delete(name);
      return { ok: had, stdout: "" };
    }
    return { ok: false, stdout: "" };
  };
  return { run, approved, calls, exec };
}

describe("Start with Windows reflects the real Run key (14 Nov second-PC finding)", () => {
  it("reads the entry Electron wrote with --hidden, which getLoginItemSettings() without args reported as off", async () => {
    const fake = fakeRegistry([["electron.app.Guilded Companion", EXE], ["OneDrive", String.raw`"C:\od.exe" /background`]]);
    expect(await autostart.isOn(fake.exec, "win32")).toBe(true);
    expect((await autostart.readEntries(fake.exec, "win32")).map((entry: { name: string }) => entry.name)).toEqual(["electron.app.Guilded Companion"]);
  });

  it("is off with no companion entry, never counts other programs, and is off outside Windows", async () => {
    const fake = fakeRegistry([["OneDrive", String.raw`"C:\od.exe"`]]);
    expect(await autostart.isOn(fake.exec, "win32")).toBe(false);
    expect(await autostart.isOn(fake.exec, "linux")).toBe(false);
  });

  it("recognises every name the companion or its installer ever wrote, and any entry that launches its exe", () => {
    const values = autostart.parseReg(reg([["Guilded Companion", EXE], ["electron.app.Guilded Companion", EXE], ["SomethingElse", EXE], ["Other", String.raw`"C:\o.exe"`]]));
    expect(autostart.ownEntries(values).map((entry: { name: string }) => entry.name)).toEqual(["Guilded Companion", "electron.app.Guilded Companion", "SomethingElse"]);
    expect(autostart.KNOWN_NAMES).toEqual(["electron.app.Guilded Companion", "Guilded Companion"]);
  });

  it("unticking removes every companion entry and its Task Manager mirror, and reports the real state", async () => {
    const fake = fakeRegistry([["electron.app.Guilded Companion", EXE], ["Guilded Companion", String.raw`"C:\old\Guilded Companion.exe"`], ["OneDrive", String.raw`"C:\od.exe"`]]);
    const electron: boolean[] = [];
    expect(await autostart.apply(false, { run: fake.exec, platform: "win32", electronSet: (v: boolean) => electron.push(v) })).toBe(false);
    expect([...fake.run.keys()]).toEqual(["OneDrive"]);
    expect(fake.approved.has("electron.app.Guilded Companion")).toBe(false);
    expect(fake.approved.has("Guilded Companion")).toBe(false);
    expect(electron).toEqual([false]);
  });

  it("ticking leaves one entry: old extras are removed and Electron writes its own", async () => {
    const fake = fakeRegistry([["Guilded Companion", String.raw`"C:\old\Guilded Companion.exe"`]]);
    const electronSet = (value: boolean) => { if (value) fake.run.set("electron.app.Guilded Companion", EXE); };
    expect(await autostart.apply(true, { run: fake.exec, platform: "win32", electronSet })).toBe(true);
    expect([...fake.run.keys()]).toEqual(["electron.app.Guilded Companion"]);
  });

  it("ticking when Electron cannot write reports off, not a wish", async () => {
    const fake = fakeRegistry([]);
    expect(await autostart.apply(true, { run: fake.exec, platform: "win32", electronSet: () => {} })).toBe(false);
  });
});

describe("wiring", () => {
  const main = readFileSync("companion-app/main.cjs", "utf8");
  it("the box and the tray read the Run key, and the fallback passes the same args the entry was written with", () => {
    expect(main).toMatch(/directStartupOn \?\? app\.getLoginItemSettings\(\{ args: autostart\.ARGS \}\)\.openAtLogin/);
    expect(main).not.toMatch(/app\.getLoginItemSettings\(\)/);
    expect(main).toMatch(/directStartupOn = await autostart\.isOn\(\);/);
    expect(main).toMatch(/directStartupOn = await autostart\.apply\(!!on, \{ electronSet: /);
    expect(main).toMatch(/await setAutostart\(false\);/);
    expect(JSON.parse(readFileSync("companion-app/package.json", "utf8")).build.files).toContain("autostart.cjs");
  });

  it("the uninstaller removes every name the companion wrote and the Task Manager mirrors", () => {
    const nsh = readFileSync("companion-app/installer.nsh", "utf8");
    const un = nsh.slice(nsh.indexOf("!macro customUnInstall"));
    for (const name of ["Guilded Companion", "electron.app.${PRODUCT_NAME}"]) {
      expect(un).toContain(`CurrentVersion\\Run" "${name}"`);
      expect(un).toContain(`StartupApproved\\Run" "${name}"`);
    }
  });
});
