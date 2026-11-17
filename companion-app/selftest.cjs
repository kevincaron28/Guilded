// `Guilded Companion.exe --self-test`: proves a BUILT app can load everything it needs, then exits.
// Runs before any window, tray, single-instance lock, update, autostart or network call, with a
// throwaway userData folder so it never touches a member's settings. 9.3.7 shipped an app that could not
// start because ./run-log.cjs was missing from the package; unit tests never launched the packaged app.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const REQUIRED_FILES = ["package.json", "preload.cjs", "renderer/main.html", "renderer/main.js", "renderer/ui-bundle.js", "locales/fr.json", "assets/icon.png"];

// Every local ./x.cjs module reachable from `entry` (entry included), found by reading the source.
function collectLocalModules(entry, readSource) {
  const seen = new Set();
  const walk = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const source = readSource(file);
    for (const match of source.matchAll(/require\(\s*["']\.\/([^"']+\.cjs)["']\s*\)/g)) walk(match[1]);
  };
  walk(entry);
  return [...seen];
}

// Engine modules main.cjs loads with url("x.mjs").
function collectEngineModules(mainSource) {
  return [...new Set([...mainSource.matchAll(/\burl\(\s*["']([^"']+\.mjs)["']\s*\)/g)].map((m) => m[1]))];
}

async function runChecks(app) {
  const root = app.getAppPath();
  const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
  const missing = REQUIRED_FILES.filter((file) => !fs.existsSync(path.join(root, file)));
  if (missing.length) throw new Error(`Missing from the app: ${missing.join(", ")}`);
  const mainSource = read("main.cjs");
  const locals = collectLocalModules("main.cjs", read).filter((file) => file !== "main.cjs");
  for (const file of locals) require(path.join(root, file));
  const engineDir = app.isPackaged ? path.join(process.resourcesPath, "engine") : path.join(root, "..", "companion");
  const engineFiles = new Set(collectEngineModules(mainSource));
  if (app.isPackaged) for (const file of fs.readdirSync(engineDir)) if (file.endsWith(".mjs")) engineFiles.add(file);
  for (const file of engineFiles) await import(pathToFileURL(path.join(engineDir, file)).href);
  return { selfTest: "ok", version: app.getVersion(), modules: locals.length + engineFiles.size };
}

function run(app) {
  app.setPath("userData", path.join(os.tmpdir(), `guilded-selftest-${process.pid}`));
  runChecks(app).then(
    (result) => { process.stdout.write(`${JSON.stringify(result)}\n`); app.exit(0); },
    (error) => { process.stderr.write(`SELF-TEST FAILED: ${error && error.stack ? error.stack : error}\n`); app.exit(1); }
  );
}

module.exports = { run, runChecks, collectLocalModules, collectEngineModules, REQUIRED_FILES };
