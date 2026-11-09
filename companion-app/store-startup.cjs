"use strict";
// Start with Windows for the Microsoft Store build (9.0.8). A Store package cannot use the
// registry Run entry the direct download uses; it has a package startup task instead
// (build/store-startup.xml, TaskId GuildedCompanionStartup), shipped disabled. Electron has no
// API for it, so a hidden Windows PowerShell (a child of the packaged app, so it runs with the
// package's identity) asks Windows through Windows.ApplicationModel.StartupTask.
//
// Windows decides: a task the member turned off in Settings > Apps > Startup or Task Manager
// ("DisabledByUser") stays off, and so does one a policy controls. Only the member can turn
// those back on, in Windows settings (openStartupSettings).
const { execFile } = require("node:child_process");

const TASK_ID = "GuildedCompanionStartup";
const STATES = new Set(["Disabled", "DisabledByUser", "Enabled", "DisabledByPolicy", "EnabledByPolicy"]);

// One PowerShell script: get the task, then optionally enable or disable it, and print its state.
function script(action) {
  const change = action === "enable"
    ? "if ($task.State -eq 'Disabled') { $null = Await ($task.RequestEnableAsync()) ([Windows.ApplicationModel.StartupTaskState]) }"
    : action === "disable" ? "if ($task.State -eq 'Enabled') { $task.Disable() }" : "";
  return [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -AssemblyName System.Runtime.WindowsRuntime",
    "$null = [Windows.ApplicationModel.StartupTask, Windows.ApplicationModel, ContentType = WindowsRuntime]",
    "$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]",
    "function Await($operation, $type) { $t = $asTask.MakeGenericMethod($type).Invoke($null, @($operation)); $null = $t.Wait(-1); $t.Result }",
    `$task = Await ([Windows.ApplicationModel.StartupTask]::GetAsync('${TASK_ID}')) ([Windows.ApplicationModel.StartupTask])`,
    change,
    "$task = Await ([Windows.ApplicationModel.StartupTask]::GetAsync('" + TASK_ID + "')) ([Windows.ApplicationModel.StartupTask])",
    "Write-Output ([string]$task.State)"
  ].filter(Boolean).join("; ");
}

// Resolves to the task's state ("Enabled", "DisabledByUser", ...) or null when Windows could not say.
function run(action, exec = execFile) {
  return new Promise((resolve) => {
    exec("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script(action)],
      { windowsHide: true, timeout: 20_000 }, (error, stdout) => {
        const state = String(stdout ?? "").trim().split(/\r?\n/).pop()?.trim();
        resolve(!error && state && STATES.has(state) ? state : null);
      });
  });
}

const isOn = (state) => state === "Enabled" || state === "EnabledByPolicy";

/** The startup task's state, or null when unknown. */
function startupState(exec) { return run("query", exec); }

/**
 * Turns starting with Windows on or off. Returns { on, state, needsSettings }: `needsSettings`
 * when Windows keeps the choice (the member turned it off in Windows, a policy, or no answer),
 * so the app should point to Settings > Apps > Startup.
 */
async function setStoreStartup(on, exec) {
  const state = await run(on ? "enable" : "disable", exec);
  return { on: isOn(state), state, needsSettings: state === null || (on ? !isOn(state) : state === "EnabledByPolicy") };
}

/** Opens Windows' own startup apps page, where the member can switch Guilded Companion on. */
function openStartupSettings(shell) {
  return shell.openExternal("ms-settings:startupapps");
}

module.exports = { TASK_ID, script, startupState, setStoreStartup, openStartupSettings, isOn };
