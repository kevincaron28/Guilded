import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

// 9.0.8: the Microsoft Store companion starts with Windows by default too (the owner's Store
// install never did, so an hour of dungeon runs never reached Discord). Windows' package startup
// task is asked through PowerShell; a member's own "off" in Windows settings is never overridden.
const startup = createRequire(import.meta.url)("../companion-app/store-startup.cjs");

type Exec = (file: string, args: string[], options: unknown, done: (error: Error | null, stdout: string) => void) => void;
const answering = (stdout: string, error: Error | null = null) => vi.fn<Exec>((_file, _args, _options, done) => done(error, stdout));

describe("Store startup task", () => {
  it("asks Windows for the package's own task and enables it only from the plain Disabled state", () => {
    const enable = startup.script("enable");
    expect(enable).toContain("StartupTask]::GetAsync('GuildedCompanionStartup')");
    expect(enable).toContain("if ($task.State -eq 'Disabled') { $null = Await ($task.RequestEnableAsync())");
    expect(startup.script("disable")).toContain("if ($task.State -eq 'Enabled') { $task.Disable() }");
    expect(startup.script("query")).not.toMatch(/RequestEnableAsync|Disable\(\)/);
    // The id matches the manifest extension.
    expect(readFileSync("companion-app/build/store-startup.xml", "utf8")).toContain(`TaskId="${startup.TASK_ID}"`);
  });

  it("reports on, and the cases where only Windows settings can decide", async () => {
    const run = answering("Enabled\r\n");
    expect(await startup.setStoreStartup(true, run)).toEqual({ on: true, state: "Enabled", needsSettings: false });
    expect(run.mock.calls[0]![0]).toBe("powershell.exe");
    expect(run.mock.calls[0]![2]).toMatchObject({ windowsHide: true });
    expect(await startup.setStoreStartup(true, answering("DisabledByUser"))).toEqual({ on: false, state: "DisabledByUser", needsSettings: true });
    expect(await startup.setStoreStartup(true, answering("", new Error("no package identity")))).toEqual({ on: false, state: null, needsSettings: true });
    expect(await startup.setStoreStartup(false, answering("Disabled"))).toEqual({ on: false, state: "Disabled", needsSettings: false });
    expect(await startup.setStoreStartup(false, answering("EnabledByPolicy"))).toEqual({ on: true, state: "EnabledByPolicy", needsSettings: true });
    expect(await startup.startupState(answering("garbage"))).toBeNull();
  });

  it("opens Windows' startup apps page", async () => {
    const shell = { openExternal: vi.fn().mockResolvedValue(undefined) };
    await startup.openStartupSettings(shell);
    expect(shell.openExternal).toHaveBeenCalledWith("ms-settings:startupapps");
  });

  it("ships in the app, asks once per Store install with its own flag, and shows the switch", () => {
    expect(JSON.parse(readFileSync("companion-app/package.json", "utf8")).build.files).toContain("store-startup.cjs");
    const main = readFileSync("companion-app/main.cjs", "utf8");
    expect(main).toContain("if (!config.storeStartupAsked) {");
    expect(main).toContain("if (!STORE_PACKAGE) await setAutostart(true);");
    expect(main).not.toContain("enabled: !STORE_PACKAGE");
    expect(readFileSync("companion-app/renderer/app.js", "utf8")).not.toContain("$('autostartLabel').hidden = true");
    // The manifest still ships the task disabled: the app asks Windows, the package never forces it.
    expect(readFileSync("companion-app/build/store-startup.xml", "utf8")).toContain('Enabled="false"');
  });
});
