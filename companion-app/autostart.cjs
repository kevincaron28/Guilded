"use strict";
// Start with Windows for the direct-download build: what Windows really has in the Run key, not a guess.
//
// Why this module exists (14 November 2026, second PC): the "Start with Windows" box showed unticked while the
// Run entry `electron.app.Guilded Companion` = `"...\Guilded Companion.exe" --hidden` existed and started the
// companion. Electron's app.getLoginItemSettings() only reports openAtLogin when the registered command line
// matches the path AND args it is asked about; it was asked with no args, the entry has `--hidden`, so it said false.
//
// This code deletes Windows startup entries, so it is strict about what is "ours":
//   - a value with one of the two names the companion or its installer ever wrote under
//     HKCU\Software\Microsoft\Windows\CurrentVersion\Run:
//       `electron.app.Guilded Companion`  Electron's setLoginItemSettings (every release since the desktop app)
//       `Guilded Companion`               the plain name older installers/uninstallers handled
//   - or a value whose command launches exactly THIS install's executable (process.execPath).
// A copy of the program in another folder, or another product, is never read as ours and never deleted.
//
// Windows keeps a mirror per name under ...\Explorer\StartupApproved\Run (the Task Manager switch): the first byte
// is odd (03) when the member disabled the entry there. Such an entry does not start and counts as OFF; ticking the
// box clears the mirror so the entry really runs.
// A failed `reg query` is "unknown", never "off": the caller keeps what it knew.
const path = require("node:path");
const { execFile } = require("node:child_process");

const RUN_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const APPROVED_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run";
const CANONICAL_NAME = "electron.app.Guilded Companion";
const KNOWN_NAMES = [CANONICAL_NAME, "Guilded Companion"];
const ARGS = ["--hidden"];

/** reg.exe by absolute path, never through PATH. */
function regExe(env = process.env) {
  const root = env.SystemRoot || env.windir || "C:\\Windows";
  return path.win32.join(root, "System32", "reg.exe");
}

/** `reg query` output -> [{ name, type, data }]. Value names and types are not translated; only the key header is. */
function parseReg(stdout) {
  const values = [];
  for (const line of String(stdout ?? "").split(/\r?\n/)) {
    const match = /^ {4}(.+?) {4}(REG_[A-Z_]+)(?: {4}(.*))?$/.exec(line) ?? /^ {4}(.+?)\s+(REG_[A-Z_]+)(?:\s+(.*))?$/.exec(line);
    if (match) values.push({ name: match[1], type: match[2], data: (match[3] ?? "").trim() });
  }
  return values;
}

const normalize = (text) => String(text).trim().replace(/\//g, "\\").toLowerCase();
const expand = (text, env) => String(text).replace(/%([^%]+)%/g, (whole, name) => env[Object.keys(env).find((key) => key.toLowerCase() === name.toLowerCase()) ?? ""] ?? whole);

/** Whether a Run command launches exactly `exePath` (quoted or not, environment variables expanded, case-insensitive). */
function launches(command, exePath, env = process.env) {
  if (!exePath) return false;
  const target = normalize(exePath);
  const text = expand(String(command).trim(), env);
  if (text.startsWith('"')) {
    const end = text.indexOf('"', 1);
    return end > 0 && normalize(text.slice(1, end)) === target;
  }
  const lower = normalize(text);
  return lower === target || (lower.startsWith(target) && /\s/.test(lower.charAt(target.length)));
}

/** The Run values that are ours: a known name, or a command that launches this install's executable. */
function ownEntries(values, exePath, env = process.env) {
  return values.filter((value) => KNOWN_NAMES.some((name) => name.toLowerCase() === value.name.toLowerCase()) || launches(value.data, exePath, env));
}

/** StartupApproved data (hex text) -> true when the member disabled the entry (first byte odd). */
function disabledByUser(data) {
  const byte = Number.parseInt(String(data ?? "").trim().slice(0, 2), 16);
  return Number.isFinite(byte) && byte % 2 === 1;
}

function defaultRun(file, args) {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, timeout: 15_000, encoding: "utf8" }, (error, stdout) => resolve({ ok: !error, stdout: String(stdout ?? "") }));
  });
}

/**
 * What Windows has for the companion, or null when it could not be read (failed or timed-out reg query).
 * { entries: [{ name, data, disabled }], on } where `on` means an entry exists that Windows will really start.
 */
async function readState({ run = defaultRun, platform = process.platform, exePath = process.execPath, env = process.env } = {}) {
  if (platform !== "win32") return { entries: [], on: false };
  const reg = regExe(env);
  let runKey = await run(reg, ["query", RUN_KEY]);
  if (!runKey.ok) runKey = await run(reg, ["query", RUN_KEY]); // one retry: a first reg.exe call can fail right after start
  if (!runKey.ok) return null;
  // The approval key is often absent for an entry the member never touched: no answer means enabled.
  const approved = await run(reg, ["query", APPROVED_KEY]);
  const mirror = new Map(approved.ok ? parseReg(approved.stdout).map((value) => [value.name.toLowerCase(), disabledByUser(value.data)]) : []);
  const entries = ownEntries(parseReg(runKey.stdout), exePath, env).map((value) => ({ name: value.name, data: value.data, disabled: mirror.get(value.name.toLowerCase()) === true }));
  return { entries, on: entries.some((entry) => !entry.disabled) };
}

async function deleteValue(run, reg, key, name) { return run(reg, ["delete", key, "/v", name, "/f"]); }

/**
 * Applies the member's choice and returns what Windows really has afterwards (true/false), or null when that could
 * not be read (nothing is changed when the first read fails).
 * `electronSet(value)` is app.setLoginItemSettings with the canonical arguments.
 */
async function apply(on, { run = defaultRun, platform = process.platform, exePath = process.execPath, env = process.env, electronSet } = {}) {
  if (platform !== "win32") return false;
  const reg = regExe(env);
  const before = await readState({ run, platform, exePath, env });
  if (!before) return null;
  if (!on) {
    for (const entry of before.entries) {
      await deleteValue(run, reg, RUN_KEY, entry.name);
      await deleteValue(run, reg, APPROVED_KEY, entry.name);
    }
    electronSet?.(false);
    // Electron's own name once more, in case it registers differently from what was read.
    await deleteValue(run, reg, RUN_KEY, CANONICAL_NAME);
    await deleteValue(run, reg, APPROVED_KEY, CANONICAL_NAME);
  } else {
    // One entry only: stray names go; the canonical one is written by Electron and its Task Manager switch is cleared.
    for (const entry of before.entries.filter((item) => item.name !== CANONICAL_NAME)) {
      await deleteValue(run, reg, RUN_KEY, entry.name);
      await deleteValue(run, reg, APPROVED_KEY, entry.name);
    }
    electronSet?.(true);
    await deleteValue(run, reg, APPROVED_KEY, CANONICAL_NAME);
  }
  const after = await readState({ run, platform, exePath, env });
  return after ? after.on : null;
}

/**
 * Keeps exactly one Run entry (the canonical one). A leftover such as `electron.app.Electron` (written by an
 * unpackaged/dev Electron run, pointing at this exe) is deleted with its Task Manager mirror. When only a stray
 * entry exists and Windows would start it, the canonical one is written first so start-up is never lost.
 * Returns { removed: [names], on } or null when the Run key could not be read (nothing is changed then).
 */
async function tidy({ run = defaultRun, platform = process.platform, exePath = process.execPath, env = process.env, electronSet } = {}) {
  if (platform !== "win32") return { removed: [], on: false };
  const reg = regExe(env);
  const state = await readState({ run, platform, exePath, env });
  if (!state) return null;
  const strays = state.entries.filter((entry) => entry.name !== CANONICAL_NAME);
  if (!strays.length) return { removed: [], on: state.on };
  const hasCanonical = state.entries.some((entry) => entry.name === CANONICAL_NAME);
  if (!hasCanonical && strays.some((entry) => !entry.disabled)) {
    electronSet?.(true);
    await deleteValue(run, reg, APPROVED_KEY, CANONICAL_NAME);
  }
  for (const entry of strays) {
    await deleteValue(run, reg, RUN_KEY, entry.name);
    await deleteValue(run, reg, APPROVED_KEY, entry.name);
  }
  const after = await readState({ run, platform, exePath, env });
  return { removed: strays.map((entry) => entry.name), on: after ? after.on : state.on };
}

module.exports = { tidy, RUN_KEY, APPROVED_KEY, CANONICAL_NAME, KNOWN_NAMES, ARGS, regExe, parseReg, launches, ownEntries, disabledByUser, readState, apply };
