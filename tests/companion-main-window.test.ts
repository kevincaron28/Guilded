import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { AUTO_OPEN_MIN_INTERVAL_MS, autoOpenDecision, mainStatus } from "../companion/main-status.mjs";

// Companion redo C2: the single window (renderer/main.html) on the same IPC as the old window.
const require = createRequire(import.meta.url);
const security = require("../companion-app/ipc-security.cjs");
const dir = path.resolve("companion-app");
const js = readFileSync("companion-app/renderer/main.js", "utf8");
const html = readFileSync("companion-app/renderer/main.html", "utf8");
const preload = readFileSync("companion-app/preload.cjs", "utf8");
const main = readFileSync("companion-app/main.cjs", "utf8");

function sender(file: string) {
  const frame = { url: pathToFileURL(path.join(dir, "renderer", file)).href + "?lang=fr" };
  const contents = { mainFrame: frame };
  return { event: { sender: contents, senderFrame: frame }, win: { webContents: contents } };
}

describe("the single window", () => {
  it("is trusted, like the old window behind Advanced, and nothing else is", () => {
    for (const file of ["main.html", "index.html"]) { const { event, win } = sender(file); expect(() => security.assertSender(event, win, dir)).not.toThrow(); }
    const { event, win } = sender("evil.html");
    expect(() => security.assertSender(event, win, dir)).toThrow("Untrusted companion window.");
  });

  it("only calls IPC the preload exposes, and the new channel takes no arguments", () => {
    const used = new Set([...js.matchAll(/\bapi\.([A-Za-z]+)/g)].map((match) => match[1]));
    for (const name of used) expect(preload, name).toContain(`  ${name}:`);
    expect(() => security.validateIpc("open-old-window", [])).not.toThrow();
    expect(() => security.validateIpc("open-old-window", ["x"])).toThrow();
    expect(main).toContain('registerIpc("open-old-window"');
    expect(() => security.validateIpc("open-single-window", [])).not.toThrow();
    expect(main).toContain('registerIpc("open-single-window"');
    // The old window has a way back, and the first load already knows about a second WoW account.
    expect(readFileSync("companion-app/renderer/index.html", "utf8")).toContain('id="btnSingleWindow"');
    expect(readFileSync("companion-app/renderer/app.js", "utf8")).toContain("api.openSingleWindow()");
    expect(main).toMatch(/registerIpc\("get-all", \(\) => \(\{ otherAccount:/);
    expect(js).toContain("api.onUpdateProgress");
    expect(js).toContain("all.otherAccount");
  });

  it("keeps the page's content policy and loads only local files", () => {
    expect(html).toContain("script-src 'self'");
    expect(html).not.toMatch(/<script(?![^>]*src=)/);
    expect(html).not.toMatch(/\sstyle=/);
    for (const id of ["line-wow", "line-addon", "line-sync", "line-account", "needs", "btnSync", "linkMy", "btnAdvanced"]) expect(html).toContain(`id="${id}"`);
  });

  it("opens the old window only for --tab screenshots or Advanced > Old window", () => {
    expect(main).toContain("const OLD_WINDOW_FIRST = Boolean(screenshotTab);");
    expect(main).toContain('path.join(__dirname, "renderer", "main.html")');
  });
});

describe("tray and automatic opening (redo C3)", () => {
  const main = readFileSync("companion-app/main.cjs", "utf8");
  const tray = main.slice(main.indexOf("function buildTrayMenu()"), main.indexOf("function createTray()"));

  it("has four menu items under a greyed status line", () => {
    expect(tray).toContain("enabled: false");
    const labels = [...tray.matchAll(/label: T\("([^"]+)"\)/g)].map((match) => match[1]);
    expect(labels).toEqual(["Open Guilded Companion", "Sync now", "Start with Windows", "Quit (stops sending data)"]); // the status line comes first, greyed
    expect(tray).not.toContain("Remove all data");
  });

  it("ships main-status.mjs with the engine files", () => {
    expect(readFileSync("companion-app/package.json", "utf8")).toContain('"main-status.mjs"');
  });
});

describe("autoOpenDecision", () => {
  const needy = mainStatus({ config: { companionCredential: "c", watchFile: "x" }, savedFile: { addon: { status: "ok" } }, otherAccount: { account: "A" } });
  const noWow = mainStatus({ config: { companionCredential: "c" }, problems: [{ id: "saved-file-missing", data: { chosen: false } }] });
  const quiet = mainStatus({ config: { companionCredential: "c", watchFile: "x" }, savedFile: { addon: { status: "ok" } } });
  const empty = { key: "", openedAt: 0 };
  const T0 = 1_000_000;

  it("waits for the first check, then opens even when no WoW install was found", () => {
    expect(autoOpenDecision(empty, noWow, { checked: false, now: T0 }).open).toBe(false);
    expect(autoOpenDecision(empty, noWow, { checked: true, now: T0 }).open).toBe(true);
  });

  it("never opens for a quiet status and opens once per problem", () => {
    expect(autoOpenDecision(empty, quiet, { checked: true, now: T0 }).open).toBe(false);
    const first = autoOpenDecision(empty, needy, { checked: true, now: T0 });
    expect(first.open).toBe(true);
    expect(autoOpenDecision(first.latch, needy, { checked: true, now: T0 + 1000 }).open).toBe(false);
  });

  it("does not reopen every time a problem comes and goes: 30 minutes apart at least", () => {
    let latch = autoOpenDecision(empty, needy, { checked: true, now: T0 }).latch;
    latch = autoOpenDecision(latch, quiet, { checked: true, now: T0 + 60_000 }).latch;
    const soon = autoOpenDecision(latch, needy, { checked: true, now: T0 + 120_000 });
    expect(soon.open).toBe(false);
    const later = autoOpenDecision(soon.latch, needy, { checked: true, now: T0 + AUTO_OPEN_MIN_INTERVAL_MS + 1 });
    expect(later.open).toBe(true);
  });

  it("does not open a window that is already showing", () => {
    expect(autoOpenDecision(empty, needy, { checked: true, now: T0, visible: true })).toMatchObject({ open: false, latch: { key: expect.any(String) } });
  });

  it("is used by main.cjs, which commits the latch after showing the window", () => {
    const main = readFileSync("companion-app/main.cjs", "utf8");
    expect(main).toContain("engineModules.autoOpenDecision(");
    expect(main).toContain("savedFileChecked = true;");
  });
});
