import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const autostart = require("../companion-app/autostart.cjs");

const OWN = String.raw`C:\Users\x\AppData\Local\Programs\Guilded Companion\Guilded Companion.exe`;
const OWN_CMD = `"${OWN}" --hidden`;
const OTHER_FOLDER = String.raw`"D:\Portable\Guilded Companion\Guilded Companion.exe" --hidden`;
const ENV = { SystemRoot: String.raw`C:\Windows`, LOCALAPPDATA: String.raw`C:\Users\x\AppData\Local` };

const header = (key: string) => ["", key, ""];
const row = ([name, type, data]: [string, string, string]) => `    ${name}    ${type}    ${data}`;
const out = (key: string, rows: [string, string, string][]) => [...header(key), ...rows.map(row), ""].join("\r\n");

// A fake reg.exe over a Run key and a StartupApproved mirror, like Windows. `fail` makes every call fail.
function fakeRegistry(initial: [string, string][], mirror: [string, string][] = [], options: { fail?: boolean; failApproved?: boolean } = {}) {
  const run = new Map(initial);
  const approved = new Map(mirror);
  const calls: { file: string; args: string[] }[] = [];
  const exec = async (file: string, args: string[]) => {
    calls.push({ file, args });
    if (options.fail) return { ok: false, stdout: "" };
    const key = args[1] ?? "";
    const isApproved = key.endsWith("StartupApproved\\Run");
    if (args[0] === "query") {
      if (isApproved) return options.failApproved ? { ok: false, stdout: "" } : { ok: true, stdout: out(key, [...approved.entries()].map(([n, d]) => [n, "REG_BINARY", d] as [string, string, string])) };
      return { ok: true, stdout: out(key, [...run.entries()].map(([n, d]) => [n, "REG_SZ", d] as [string, string, string])) };
    }
    if (args[0] === "delete") {
      const name = args[3] ?? "";
      const map = isApproved ? approved : run;
      return { ok: map.delete(name), stdout: "" };
    }
    return { ok: false, stdout: "" };
  };
  return { run, approved, calls, exec };
}
const base = { platform: "win32", exePath: OWN, env: ENV };

describe("Start with Windows reflects the real Run key (14 Nov second-PC finding)", () => {
  it("reads the entry Electron wrote with --hidden, which getLoginItemSettings() without args reported as off", async () => {
    const fake = fakeRegistry([["electron.app.Guilded Companion", OWN_CMD], ["OneDrive", String.raw`"C:\od.exe" /background`]]);
    const state = await autostart.readState({ ...base, run: fake.exec });
    expect(state.on).toBe(true);
    expect(state.entries.map((entry: { name: string }) => entry.name)).toEqual(["electron.app.Guilded Companion"]);
  });

  it("is off with no companion entry, and off outside Windows", async () => {
    expect((await autostart.readState({ ...base, run: fakeRegistry([["OneDrive", String.raw`"C:\od.exe"`]]).exec })).on).toBe(false);
    expect(await autostart.readState({ ...base, platform: "linux" })).toEqual({ entries: [], on: false });
  });
});

describe("only this install's own entries are ever touched", () => {
  it("never reads a copy in another folder, or another product with the same exe name, as ours", async () => {
    const fake = fakeRegistry([["SomethingElse", OTHER_FOLDER], ["PortableCopy", String.raw`"C:\Other\Guilded Companion.exe"`]]);
    expect((await autostart.readState({ ...base, run: fake.exec })).entries).toEqual([]);
    // Unticking and ticking never delete them.
    expect(await autostart.apply(false, { ...base, run: fake.exec, electronSet: () => {} })).toBe(false);
    const withOthers = fakeRegistry([["SomethingElse", OTHER_FOLDER], ["electron.app.Guilded Companion", OWN_CMD]]);
    await autostart.apply(true, { ...base, run: withOthers.exec, electronSet: () => {} });
    await autostart.apply(false, { ...base, run: withOthers.exec, electronSet: () => {} });
    expect([...withOthers.run.keys()]).toEqual(["SomethingElse"]);
    for (const call of [...fake.calls, ...withOthers.calls]) if (call.args[0] === "delete") expect(call.args[3]).not.toBe("SomethingElse");
  });

  it("matches this install's executable quoted, unquoted, with variables expanded and in any letter case", () => {
    const exe = OWN;
    expect(autostart.launches(`"${exe}" --hidden`, exe, ENV)).toBe(true);
    expect(autostart.launches(`${exe} --hidden`, exe, ENV)).toBe(true);
    expect(autostart.launches(exe.toUpperCase(), exe, ENV)).toBe(true);
    expect(autostart.launches(String.raw`"%LOCALAPPDATA%\Programs\Guilded Companion\Guilded Companion.exe" --hidden`, exe, ENV)).toBe(true);
    expect(autostart.launches(String.raw`"C:\Users\x\AppData\Local\Programs\Guilded Companion\Guilded Companion.exe.bak"`, exe, ENV)).toBe(false);
    expect(autostart.launches(`${exe}.old`, exe, ENV)).toBe(false);
    expect(autostart.launches(OTHER_FOLDER, exe, ENV)).toBe(false);
    expect(autostart.launches("", exe, ENV)).toBe(false);
  });

  it("recognises the two known names, including a plain-name entry written by an older version", async () => {
    const fake = fakeRegistry([["Guilded Companion", String.raw`"C:\old\place\Guilded Companion.exe"`], ["electron.app.Guilded Companion", OWN_CMD]]);
    expect((await autostart.readState({ ...base, run: fake.exec })).entries.map((entry: { name: string }) => entry.name)).toEqual(["Guilded Companion", "electron.app.Guilded Companion"]);
    expect(autostart.KNOWN_NAMES).toEqual(["electron.app.Guilded Companion", "Guilded Companion"]);
  });

  it("handles paths with spaces, quotes, accents and French-locale output", async () => {
    const accented = String.raw`C:\Users\Élodie Tremblay\AppData\Local\Programs\Guilded Companion\Guilded Companion.exe`;
    // French Windows prints the same value names and REG_ types; only the key header text may differ.
    const french = ["", String.raw`HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Run`, `    electron.app.Guilded Companion    REG_SZ    "${accented}" --hidden`, `    Mon programme    REG_SZ    "C:\\Program Files\\Mon Programme\\app.exe" "un argument"`, "", "La opération s'est terminée correctement.", ""].join("\r\n");
    const values = autostart.parseReg(french);
    expect(values.map((value: { name: string }) => value.name)).toEqual(["electron.app.Guilded Companion", "Mon programme"]);
    expect(autostart.ownEntries(values, accented, ENV).map((value: { name: string }) => value.name)).toEqual(["electron.app.Guilded Companion"]);
    expect(autostart.launches(`"${accented}" "extra arg"`, accented, ENV)).toBe(true);
  });
});

describe("a failed reg query is unknown, never off", () => {
  it("readState and apply return null and change nothing", async () => {
    const fake = fakeRegistry([["electron.app.Guilded Companion", OWN_CMD]], [], { fail: true });
    expect(await autostart.readState({ ...base, run: fake.exec })).toBeNull();
    expect(await autostart.apply(false, { ...base, run: fake.exec, electronSet: () => { throw new Error("must not be called"); } })).toBeNull();
    expect(fake.calls.every((call) => call.args[0] === "query")).toBe(true);
    expect([...fake.run.keys()]).toEqual(["electron.app.Guilded Companion"]);
  });

  it("a missing approval key is normal (entry enabled), not a failure", async () => {
    const fake = fakeRegistry([["electron.app.Guilded Companion", OWN_CMD]], [], { failApproved: true });
    expect((await autostart.readState({ ...base, run: fake.exec })).on).toBe(true);
  });

  it("main.cjs keeps the last known state when the key cannot be read, and logs it once", () => {
    const main = readFileSync("companion-app/main.cjs", "utf8");
    expect(main).toMatch(/if \(state\) \{ directStartupOn = state\.on; autostartReadWarned = false; return; \}/);
    expect(main).toMatch(/if \(!autostartReadWarned\) \{\s+autostartReadWarned = true;\s+updateLine\(/);
    expect(main).toMatch(/if \(result !== null\) directStartupOn = result;/);
    expect(main).not.toMatch(/directStartupOn = await autostart/);
  });
});

describe("Task Manager switch (StartupApproved)", () => {
  it("an entry disabled there (first byte 03) reads as off", async () => {
    const fake = fakeRegistry([["electron.app.Guilded Companion", OWN_CMD]], [["electron.app.Guilded Companion", "030000000000000000000000"]]);
    const state = await autostart.readState({ ...base, run: fake.exec });
    expect(state.entries[0]).toMatchObject({ disabled: true });
    expect(state.on).toBe(false);
    const enabled = fakeRegistry([["electron.app.Guilded Companion", OWN_CMD]], [["electron.app.Guilded Companion", "020000000000000000000000"]]);
    expect((await autostart.readState({ ...base, run: enabled.exec })).on).toBe(true);
    expect(autostart.disabledByUser("03")).toBe(true);
    expect(autostart.disabledByUser("02")).toBe(false);
  });

  it("ticking clears that mirror so the entry really runs", async () => {
    const fake = fakeRegistry([["electron.app.Guilded Companion", OWN_CMD]], [["electron.app.Guilded Companion", "030000000000000000000000"]]);
    expect(await autostart.apply(true, { ...base, run: fake.exec, electronSet: () => {} })).toBe(true);
    expect(fake.approved.has("electron.app.Guilded Companion")).toBe(false);
  });

  it("unticking removes every own entry and its mirror, and ticking leaves one", async () => {
    const fake = fakeRegistry([["electron.app.Guilded Companion", OWN_CMD], ["Guilded Companion", String.raw`"C:\old\Guilded Companion.exe"`], ["OneDrive", String.raw`"C:\od.exe"`]],
      [["electron.app.Guilded Companion", "02"], ["Guilded Companion", "03"]]);
    const electron: boolean[] = [];
    expect(await autostart.apply(false, { ...base, run: fake.exec, electronSet: (v: boolean) => electron.push(v) })).toBe(false);
    expect([...fake.run.keys()]).toEqual(["OneDrive"]);
    expect(fake.approved.size).toBe(0);
    expect(electron).toEqual([false]);
    const stray = fakeRegistry([["Guilded Companion", String.raw`"C:\old\Guilded Companion.exe"`]]);
    const electronSet = (value: boolean) => { if (value) stray.run.set("electron.app.Guilded Companion", OWN_CMD); };
    expect(await autostart.apply(true, { ...base, run: stray.exec, electronSet })).toBe(true);
    expect([...stray.run.keys()]).toEqual(["electron.app.Guilded Companion"]);
  });

  it("ticking when Electron cannot write reports off, not a wish", async () => {
    expect(await autostart.apply(true, { ...base, run: fakeRegistry([]).exec, electronSet: () => {} })).toBe(false);
  });
});

describe("reg.exe is called by absolute path", () => {
  it("uses %SystemRoot%\\System32\\reg.exe with a fallback, never PATH", async () => {
    expect(autostart.regExe({ SystemRoot: String.raw`D:\WINNT` })).toBe(String.raw`D:\WINNT\System32\reg.exe`);
    expect(autostart.regExe({})).toBe(String.raw`C:\Windows\System32\reg.exe`);
    const fake = fakeRegistry([["electron.app.Guilded Companion", OWN_CMD]]);
    await autostart.apply(false, { ...base, run: fake.exec, electronSet: () => {} });
    expect(fake.calls.length).toBeGreaterThan(3);
    for (const call of fake.calls) expect(call.file).toBe(String.raw`C:\Windows\System32\reg.exe`);
    expect(readFileSync("companion-app/autostart.cjs", "utf8")).not.toMatch(/\brun\("reg"|exec\("reg"/);
  });
});

describe("wiring", () => {
  const main = readFileSync("companion-app/main.cjs", "utf8");
  it("the box and tray read the Run key, and the fallback passes the same args the entry was written with", () => {
    expect(main).toMatch(/directStartupOn \?\? app\.getLoginItemSettings\(\{ args: autostart\.ARGS \}\)\.openAtLogin/);
    expect(main).not.toMatch(/app\.getLoginItemSettings\(\)/);
    expect(main).toMatch(/await refreshAutostart\(\);/);
    expect(main).toMatch(/setInterval\(\(\) => void refreshAutostart\(\), 5 \* 60 \* 1000\)/);
    expect(main).toMatch(/autostart\.apply\(!!on, \{ exePath: process\.execPath, electronSet: /);
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
