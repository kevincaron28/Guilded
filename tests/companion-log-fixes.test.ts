import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createRunLog, restartedText } = require("../companion-app/run-log.cjs");
const { createAddonAutoUpdater } = require("../companion-app/addon-auto-update.cjs");

describe("the run log (finding 1, 16 Nov)", () => {
  it("keeps appending after start-up and rotates by size instead of stopping", () => {
    const file = join(mkdtempSync(join(tmpdir(), "runlog-")), "startup.log");
    const log = createRunLog(file, { maxBytes: 200 });
    for (let i = 0; i < 20; i++) log.line("t", "info", `upload ${i} finished with a rather long message`);
    log.line("t", "info", "last line of the run");
    expect(readFileSync(file, "utf8")).toContain("last line of the run");
    expect(existsSync(file + ".1")).toBe(true);
  });
  it("main.cjs writes every Activity line for the whole run", () => {
    const main = readFileSync("companion-app/main.cjs", "utf8");
    expect(main).not.toContain("startupLogging");
    expect(main).toMatch(/function startupLog\(entry\) \{\s+try \{ runLog\(\)\.line/);
  });
});

describe("the restart wording (finding 2)", () => {
  it("never says Microsoft Store for a website install", () => {
    expect(restartedText(true, false)).toBe("yes (the companion's own update)");
    expect(restartedText(true, true)).toBe("yes (Microsoft Store update)");
    expect(restartedText(false, false)).toBe("no");
    expect(readFileSync("companion-app/main.cjs", "utf8")).not.toContain("restarted by Microsoft Store: {2}");
  });
});

describe("the addon auto-update log (finding 3)", () => {
  it("runs one look at a time and never logs 'not needed: busy'", async () => {
    const lines: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let installs = 0;
    const updater = createAddonAutoUpdater({
      companionVersion: () => "9.3.6", autoUpdate: () => true, wowEnabled: () => true,
      wowBlocked: async () => false,
      install: async () => { installs += 1; await gate; return { version: "9.3.6", updated: [{ name: "Guilded" }] }; },
      log: (text: string) => lines.push(text)
    });
    updater.setAddon({ folder: "x", expected: "forever", status: "ok", version: "9.3.5", extras: [] });
    const first = updater.tick();
    const second = updater.tick();
    const third = updater.tick();
    release();
    await Promise.all([first, second, third]);
    expect(installs).toBe(1);
    expect(lines.some((line) => /not needed: busy/.test(line))).toBe(false);
    expect(lines.some((line) => /installed 9\.3\.6/.test(line))).toBe(true);
    expect(lines.some((line) => /waiting: .*(running|look)/.test(line))).toBe(true);
  });
});
