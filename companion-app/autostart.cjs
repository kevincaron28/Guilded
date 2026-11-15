"use strict";
// Start with Windows for the direct-download build: what Windows really has in the Run key, not a guess.
//
// Why this module exists (14 November 2026, second PC): the "Start with Windows" box showed unticked while the
// Run entry `electron.app.Guilded Companion` = `"...\Guilded Companion.exe" --hidden` existed and started the
// companion. Electron's app.getLoginItemSettings() only reports openAtLogin when the registered command line
// matches the path AND args it is asked about; it was asked with no args, the entry has `--hidden`, so it said false.
// The state is now read from the Run key itself, and turning it off removes every entry the companion or its
// installer ever created.
//
// Names ever written under HKCU\Software\Microsoft\Windows\CurrentVersion\Run:
//   - `electron.app.Guilded Companion`  Electron's setLoginItemSettings (every release since the desktop app)
//   - `Guilded Companion`               the plain name older installers/uninstallers handled (the NSIS uninstaller removes it)
// Windows also keeps a mirror under ...\Explorer\StartupApproved\Run (the Task Manager on/off switch) per name.
const { execFile } = require("node:child_process");

const RUN_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const APPROVED_KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run";
const CANONICAL_NAME = "electron.app.Guilded Companion";
const KNOWN_NAMES = [CANONICAL_NAME, "Guilded Companion"];
const EXE_NAME = "Guilded Companion.exe";
const ARGS = ["--hidden"];

/** `reg query` output -> [{ name, type, data }]. */
function parseReg(stdout) {
  const values = [];
  for (const line of String(stdout ?? "").split(/\r?\n/)) {
    const match = /^\s{4}(.+?)\s{4}(REG_[A-Z_]+)\s{4}(.*)$/.exec(line) ?? /^\s{4}(.+?)\s+(REG_[A-Z_]+)\s+(.*)$/.exec(line);
    if (match) values.push({ name: match[1], type: match[2], data: match[3].trim() });
  }
  return values;
}

/** The Run values that belong to the companion: a known name, or a command that starts this program. */
function ownEntries(values) {
  return values.filter((value) => KNOWN_NAMES.some((name) => name.toLowerCase() === value.name.toLowerCase())
    || /^electron\.app\.guilded companion/i.test(value.name)
    || value.data.toLowerCase().includes(EXE_NAME.toLowerCase()));
}

/** Pure: the box state and the names to remove for each wish. */
function plan(values, on) {
  const own = ownEntries(values);
  if (!on) return { remove: own.map((entry) => entry.name), keep: null };
  const canonical = own.find((entry) => entry.name === CANONICAL_NAME);
  return { remove: own.filter((entry) => entry.name !== CANONICAL_NAME).map((entry) => entry.name), keep: canonical ? CANONICAL_NAME : null };
}

function defaultRun(file, args) {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, timeout: 15_000 }, (error, stdout) => resolve({ ok: !error, stdout: String(stdout ?? "") }));
  });
}

/** The companion's Run entries on this PC (empty off Windows or when the key cannot be read). */
async function readEntries(run = defaultRun, platform = process.platform) {
  if (platform !== "win32") return [];
  const result = await run("reg", ["query", RUN_KEY]);
  return result.ok ? ownEntries(parseReg(result.stdout)) : [];
}

/** Whether the companion starts with Windows: a Run entry for it exists. */
async function isOn(run = defaultRun, platform = process.platform) {
  return (await readEntries(run, platform)).length > 0;
}

/** Removes the named Run values and their StartupApproved mirrors. */
async function removeNames(names, run = defaultRun) {
  for (const name of names) {
    await run("reg", ["delete", RUN_KEY, "/v", name, "/f"]);
    await run("reg", ["delete", APPROVED_KEY, "/v", name, "/f"]);
  }
}

/**
 * Applies the member's choice and returns what Windows really has afterwards.
 * `electronSet(on)` is app.setLoginItemSettings with the canonical arguments.
 */
async function apply(on, { run = defaultRun, platform = process.platform, electronSet } = {}) {
  if (platform !== "win32") return false;
  const before = await readEntries(run, platform);
  const wish = plan(before, !!on);
  await removeNames(wish.remove, run);
  if (on) electronSet?.(true); else electronSet?.(false);
  if (!on) {
    // Electron's own name again, in case setLoginItemSettings(false) did not match a differently-registered command line.
    await removeNames([CANONICAL_NAME], run);
  }
  return isOn(run, platform);
}

module.exports = { RUN_KEY, APPROVED_KEY, CANONICAL_NAME, KNOWN_NAMES, ARGS, parseReg, ownEntries, plan, readEntries, isOn, removeNames, apply };
