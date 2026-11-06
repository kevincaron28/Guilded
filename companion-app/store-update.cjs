// Microsoft Store build updates itself (8.5, track F5). The Store's own auto-update can take hours;
// this asks Windows.Services.Store.StoreContext directly from the packaged app.
//
// Bridge: a hidden Windows PowerShell 5.1 child process (present on every Windows 10/11) calling the
// WinRT API, with the script on stdin. No native module, no new build step, nothing to sign: a child of
// a packaged full-trust app keeps the package identity, so StoreContext.GetDefault() answers for this
// package. The prompt path also needs the window handle (IInitializeWithWindow), compiled from a few
// lines of C# by Add-Type at run time. Every failure ends in the existing "Store updates" button.
//
//   Windows 11 and Windows 10 2004+ : TrySilentDownloadAndInstallStorePackageUpdatesAsync (no UI)
//   Windows 10 1607-1909           : RequestDownloadAndInstallStorePackageUpdatesAsync (one Store prompt)
//   anything else, or any failure  : the Store page button (ms-windows-store://downloadsandupdates)
// Chosen by API presence (ApiInformation.IsMethodPresent), never by version number.
//
// Installing an update closes the running companion. Just before installing, a one-time scheduled
// task (outside the package, so it survives the update) starts the companion again if it is not
// running; the app sees the marker file and starts in the tray without opening its window.

const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;
const RETRY_AFTER_FAILURE_MS = 60 * 60 * 1000;
const APP_ID = "GuildedCompanion"; // build-msix.cjs applicationId
const RESTART_MARKER_MS = 15 * 60 * 1000;

/** "silent", "prompt" or "page", from what this Windows offers. */
function chooseStoreUpdateMethod({ silentPresent, requestPresent } = {}) {
  if (silentPresent === true) return "silent";
  if (requestPresent === true) return "prompt";
  return "page";
}

/**
 * Whether to look for a Store update now.
 * @returns {{ action: "check" | "skip", reason: string }}
 */
function decideStoreCheck({ store, platform, enabled = true, wowRunning = false, lastCheckAt = null, lastFailedAt = null, busy = false, now = Date.now() } = {}) {
  if (store !== true) return { action: "skip", reason: "not-store" };
  if (platform !== "win32") return { action: "skip", reason: "not-windows" };
  if (enabled === false) return { action: "skip", reason: "disabled" };
  if (busy) return { action: "skip", reason: "busy" };
  // A Store install closes the game's companion mid-raid otherwise; WoW also locks nothing of ours,
  // but the member may be relying on live standings.
  if (wowRunning) return { action: "skip", reason: "wow-running" };
  const last = Date.parse(lastCheckAt ?? "");
  if (Number.isFinite(last) && now - last < CHECK_EVERY_MS) return { action: "skip", reason: "checked-recently" };
  const failed = Date.parse(lastFailedAt ?? "");
  if (Number.isFinite(failed) && now - failed < RETRY_AFTER_FAILURE_MS) return { action: "skip", reason: "failed-recently" };
  return { action: "check", reason: "due" };
}

/**
 * After the check: what to do with what the Store said.
 * @returns {{ action: "none" | "install" | "button", method?: string, reason: string }}
 */
function decideStoreInstall(check, { windowVisible = false, wowRunning = false } = {}) {
  if (!check || check.ok !== true) return { action: "button", reason: "check-failed" };
  if (!(check.updates > 0)) return { action: "none", reason: "up-to-date" };
  if (wowRunning) return { action: "none", reason: "wow-running" };
  const method = chooseStoreUpdateMethod(check);
  if (method === "page") return { action: "button", reason: "api-unavailable" };
  // The Windows 10 1607-1909 prompt needs a window the member can see; otherwise wait for one.
  if (method === "prompt" && !windowVisible) return { action: "none", method, reason: "prompt-needs-window" };
  return { action: "install", method, reason: "update-available" };
}

/** True when Windows' task list (tasklist /FO CSV /NH) shows a WoW game client (not WowVoiceProxy.exe). */
function wowRunningFrom(tasklist) {
  return String(tasklist ?? "").split(/\r?\n/).some((line) => {
    const name = /^"([^"]+)"/.exec(line.trim())?.[1] ?? "";
    return /^wow[a-z0-9]*\.exe$/i.test(name) && !/voiceproxy/i.test(name);
  });
}

/** True when this start follows a Store update restart (marker written less than 15 minutes ago). */
function restartedAfterUpdate(marker, now = Date.now()) {
  const at = Date.parse(marker?.at ?? "");
  return Number.isFinite(at) && now - at >= 0 && now - at < RESTART_MARKER_MS;
}

const AWAIT = String.raw`
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$extensions = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 }
function Await($operation, [Type]$resultType, [Type]$progressType) {
  if ($progressType) { $generic = $extensions | Where-Object { $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperationWithProgress` + "`" + String.raw`2' } | Select-Object -First 1; $method = $generic.MakeGenericMethod($resultType, $progressType) }
  else { $generic = $extensions | Where-Object { $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation` + "`" + String.raw`1' } | Select-Object -First 1; $method = $generic.MakeGenericMethod($resultType) }
  $task = $method.Invoke($null, @($operation)); [void]$task.Wait(-1); return $task.Result
}
function Say($value) { [Console]::Out.WriteLine(($value | ConvertTo-Json -Compress)) }
[void][Windows.Services.Store.StoreContext, Windows.Services.Store, ContentType = WindowsRuntime]
[void][Windows.Foundation.Metadata.ApiInformation, Windows.Foundation, ContentType = WindowsRuntime]
[void][Windows.ApplicationModel.Package, Windows.ApplicationModel, ContentType = WindowsRuntime]
$store = 'Windows.Services.Store.StoreContext'
$context = [Windows.Services.Store.StoreContext]::GetDefault()
$updateList = [System.Collections.Generic.IReadOnlyList[Windows.Services.Store.StorePackageUpdate]]
`;

/** The check: API presence, how many updates (and how many mandatory), the newest version offered. */
function checkScript() {
  return AWAIT + String.raw`
try {
  $silent = [Windows.Foundation.Metadata.ApiInformation]::IsMethodPresent($store, 'TrySilentDownloadAndInstallStorePackageUpdatesAsync')
  $request = [Windows.Foundation.Metadata.ApiInformation]::IsMethodPresent($store, 'RequestDownloadAndInstallStorePackageUpdatesAsync')
  $updates = Await ($context.GetAppAndOptionalStorePackageUpdatesAsync()) $updateList $null
  $version = $null
  foreach ($update in $updates) { $v = $update.Package.Id.Version; $version = "$($v.Major).$($v.Minor).$($v.Build)" }
  Say @{ ok = $true; silentPresent = $silent; requestPresent = $request; updates = $updates.Count; mandatory = @($updates | Where-Object { $_.Mandatory }).Count; version = $version }
} catch { Say @{ ok = $false; error = $_.Exception.GetBaseException().Message } }
`;
}


/**
 * The install. `method` is "silent" or "prompt"; `hwnd` the window handle (prompt only); `exe` this
 * app's process name for the restart guard. Downloads first (the app keeps running), then registers
 * the one-time restart task, then installs (Windows closes the app).
 */
function installScript({ method, hwnd = "0", exe = "Guilded Companion" }) {
  if (!["silent", "prompt"].includes(method)) throw new Error("Unknown Store update method.");
  if (!/^\d{1,20}$/.test(String(hwnd))) throw new Error("Bad window handle.");
  if (!/^[\w .-]{1,60}$/.test(String(exe))) throw new Error("Bad process name.");
  // The launcher starts the companion only if it is not running (an update that was declined or
  // failed leaves it running), and is passed base64-encoded so no quoting can break it.
  const restart = String.raw`
  $family = [Windows.ApplicationModel.Package]::Current.Id.FamilyName
  $launch = "if (-not (Get-Process -Name '${exe}' -ErrorAction SilentlyContinue)) { Start-Process 'shell:AppsFolder\$family!${APP_ID}' }"
  $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($launch))
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ('-NoProfile -WindowStyle Hidden -EncodedCommand ' + $encoded)
  $triggers = @(2, 5, 10) | ForEach-Object { $t = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes($_); $t.EndBoundary = (Get-Date).AddMinutes($_ + 1).ToString('s'); $t }
  $settings = New-ScheduledTaskSettingsSet -DeleteExpiredTaskAfter (New-TimeSpan -Minutes 5) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
  Register-ScheduledTask -TaskName 'Guilded Companion restart after update' -Action $action -Trigger $triggers -Settings $settings -Force | Out-Null
`;
  const silent = String.raw`
  $downloaded = Await ($context.TrySilentDownloadStorePackageUpdatesAsync($updates)) ([Windows.Services.Store.StorePackageUpdateResult]) ([Windows.Services.Store.StorePackageUpdateStatus])
  if ($downloaded.OverallState.ToString() -ne 'Completed') { Say @{ ok = $false; state = $downloaded.OverallState.ToString(); stage = 'download' }; exit }
  Say @{ ok = $true; state = 'Downloaded'; stage = 'download' }
  ${restart}
  $result = Await ($context.TrySilentDownloadAndInstallStorePackageUpdatesAsync($updates)) ([Windows.Services.Store.StorePackageUpdateResult]) ([Windows.Services.Store.StorePackageUpdateStatus])
`;
  const prompt = String.raw`
  Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; [ComImport, Guid("3E68D4BD-7135-4D10-8018-9FB6D9F33FA1"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] public interface IInitializeWithWindow { void Initialize(IntPtr hwnd); } public static class GuildedWindow { public static void Attach(object target, long hwnd) { ((IInitializeWithWindow)target).Initialize(new IntPtr(hwnd)); } }'
  [GuildedWindow]::Attach($context, ${hwnd})
  ${restart}
  $result = Await ($context.RequestDownloadAndInstallStorePackageUpdatesAsync($updates)) ([Windows.Services.Store.StorePackageUpdateResult]) ([Windows.Services.Store.StorePackageUpdateStatus])
`;
  return AWAIT + String.raw`
try {
  $updates = Await ($context.GetAppAndOptionalStorePackageUpdatesAsync()) $updateList $null
  if ($updates.Count -eq 0) { Say @{ ok = $true; state = 'NoUpdates'; stage = 'check' }; exit }
  ${method === "silent" ? silent : prompt}
  Say @{ ok = ($result.OverallState.ToString() -eq 'Completed'); state = $result.OverallState.ToString(); stage = 'install' }
} catch { Say @{ ok = $false; error = $_.Exception.GetBaseException().Message } }
`;
}

/** The last JSON line the script printed, or a failure. */
function parseScriptOutput(stdout) {
  const lines = String(stdout ?? "").split(/\r?\n/).map((line) => line.trim()).filter((line) => line.startsWith("{"));
  for (let index = lines.length - 1; index >= 0; index--) {
    try { const value = JSON.parse(lines[index]); if (value && typeof value === "object") return value; } catch { /* try the line before */ }
  }
  return { ok: false, error: "No answer from the Store check." };
}

/**
 * Runs a script with hidden Windows PowerShell; resolves with its parsed answer, never rejects.
 * The script goes through a temporary .ps1 file (-File): "-Command -" reads stdin line by line and
 * silently drops multi-line blocks. The file is removed afterwards.
 */
function runScript(spawn, script, { timeoutMs = 30 * 60 * 1000, fs = require("node:fs"), directory = require("node:os").tmpdir() } = {}) {
  return new Promise((resolve) => {
    const file = require("node:path").join(directory, `guilded-store-update-${process.pid}-${Date.now()}.ps1`);
    const done = (value) => { try { fs.rmSync(file, { force: true }); } catch { /* temp folder */ } resolve(value); };
    let child;
    try {
      // UTF-8 with a byte-order mark so Windows PowerShell 5.1 reads it as UTF-8.
      fs.writeFileSync(file, "\uFEFF" + script, "utf8");
      child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", file], { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) { done({ ok: false, error: error instanceof Error ? error.message : String(error) }); return; }
    let stdout = "";
    const timer = setTimeout(() => { try { child.kill(); } catch { /* already gone */ } }, timeoutMs);
    child.stdout?.on("data", (chunk) => { stdout += chunk; });
    child.on("error", (error) => { clearTimeout(timer); done({ ok: false, error: error.message }); });
    child.on("close", () => { clearTimeout(timer); done(parseScriptOutput(stdout)); });
  });
}

module.exports = { CHECK_EVERY_MS, RETRY_AFTER_FAILURE_MS, APP_ID, wowRunningFrom, chooseStoreUpdateMethod, decideStoreCheck, decideStoreInstall, restartedAfterUpdate, checkScript, installScript, parseScriptOutput, runScript };
