import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { mainStatus } from "../companion/main-status.mjs";

const require = createRequire(import.meta.url);
const rb = require("../companion-app/update-rollback.cjs");
const updates = require("../companion-app/update-check.cjs");

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const bytes1 = Buffer.from("installer 9.4.1");
const bytes2 = Buffer.from("installer 9.4.2");

/** A data folder where 9.4.1 ran healthily and its installer is kept; 9.4.2 is being installed. */
function scene({ kept = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "qg-rollback-")); dirs.push(dir);
  mkdirSync(join(dir, "updates", "keep"), { recursive: true });
  if (kept) {
    writeFileSync(join(dir, "updates", "keep", "Guilded.Companion.Setup.9.4.1.exe"), bytes1);
    writeFileSync(join(dir, "updates", "keep", "kept.json"), JSON.stringify({ version: "9.4.1", name: "Guilded.Companion.Setup.9.4.1.exe", sha256: sha(bytes1) }));
  }
  const toFile = join(dir, "updates", "Guilded.Companion.Setup.9.4.2.exe");
  writeFileSync(toFile, bytes2);
  rb.beginTrial({ dir, from: "9.4.1", to: "9.4.2", toFile, toSha256: sha(bytes2) });
  return { dir, toFile };
}
function launch(dir: string, over: Record<string, unknown> = {}) {
  const spawned: { file: string; args: string[] }[] = [];
  const notes: string[][] = [];
  const result = rb.guard({
    dir, current: "9.4.2", packaged: true, store: false,
    spawn: (file: string, args: string[]) => { spawned.push({ file, args }); return { unref() {} }; },
    hashFile: (file: string) => sha(readFileSync(file)),
    notify: (failed: string, back: string) => notes.push([failed, back]),
    ...over
  });
  return { result, spawned, notes };
}

describe("9.4 T2: update rollback", () => {
  it("the marker is written before the update and counts launches of the new version", () => {
    const { dir } = scene();
    expect(rb.readTrial(dir)).toMatchObject({ from: "9.4.1", to: "9.4.2", launches: 0, keep: { version: "9.4.1" } });
    expect(launch(dir).result.action).toBe("watch");
    expect(rb.readTrial(dir).launches).toBe(1);
  });

  it("rolls back after K failed launches: the kept installer starts, the version is banned, settings stay", () => {
    const { dir, toFile } = scene();
    writeFileSync(join(dir, "config.json"), "settings");
    for (let i = 0; i < rb.MAX_FAILED_LAUNCHES; i++) expect(launch(dir).result.action).toBe("watch");
    const { result, spawned, notes } = launch(dir);
    expect(result.action).toBe("rollback");
    expect(spawned).toHaveLength(1);
    expect(spawned[0].file).toBe(join(dir, "updates", "keep", "Guilded.Companion.Setup.9.4.1.exe"));
    expect(spawned[0].args).toContain("/S");
    expect(notes).toEqual([["9.4.2", "9.4.1"]]);
    expect(rb.readTrial(dir)).toBeNull();
    expect(existsSync(toFile)).toBe(false);
    expect(rb.isBanned(dir, "9.4.2")).toBe(true);
    expect(rb.isBanned(dir, "9.4.3")).toBe(false);
    expect(readFileSync(join(dir, "config.json"), "utf8")).toBe("settings");
    // The restored version tells the member once.
    expect(rb.takeResult({ dir, current: "9.4.1" })).toEqual({ failed: "9.4.2", back: "9.4.1" });
    expect(rb.takeResult({ dir, current: "9.4.1" })).toBeNull();
  });

  it("no rollback after a healthy run: the marker goes and the installer becomes the kept one", () => {
    const { dir } = scene();
    launch(dir); launch(dir);
    expect(rb.markHealthy({ dir, current: "9.4.2" })).toEqual({ promoted: true });
    expect(rb.readTrial(dir)).toBeNull();
    expect(rb.readKept(dir)).toMatchObject({ version: "9.4.2", sha256: sha(bytes2) });
    expect(existsSync(join(dir, "updates", "keep", "Guilded.Companion.Setup.9.4.1.exe"))).toBe(false);
    for (let i = 0; i < 6; i++) expect(launch(dir).result.action).toBe("none");
  });

  it("a normal quit does not count as a failed launch", () => {
    const { dir } = scene();
    for (let i = 0; i < 6; i++) { expect(launch(dir).result.action).toBe("watch"); rb.cleanQuit({ dir, current: "9.4.2" }); }
    expect(rb.readTrial(dir).launches).toBe(0);
  });

  it("Store installs and unpackaged runs are skipped", () => {
    const { dir } = scene();
    for (let i = 0; i < 6; i++) {
      expect(launch(dir, { store: true }).result.action).toBe("none");
      expect(launch(dir, { packaged: false }).result.action).toBe("none");
    }
    expect(rb.readTrial(dir).launches).toBe(0);
  });

  it("without a kept installer the failing version is not rolled back, and the marker is dropped", () => {
    const { dir } = scene({ kept: false });
    for (let i = 0; i < rb.MAX_FAILED_LAUNCHES; i++) launch(dir);
    const { result, spawned } = launch(dir);
    expect(result).toMatchObject({ action: "drop", reason: "no-previous-installer" });
    expect(spawned).toHaveLength(0);
    expect(rb.readTrial(dir)).toBeNull();
  });

  it("a kept installer whose checksum no longer matches is never started", () => {
    const { dir } = scene();
    writeFileSync(join(dir, "updates", "keep", "Guilded.Companion.Setup.9.4.1.exe"), "tampered");
    for (let i = 0; i < rb.MAX_FAILED_LAUNCHES; i++) launch(dir);
    const { result, spawned } = launch(dir);
    expect(result).toMatchObject({ action: "failed", reason: "checksum" });
    expect(spawned).toHaveLength(0);
  });

  it("an update that never installed (still the old version) is not judged", () => {
    const { dir } = scene();
    for (let i = 0; i < 6; i++) expect(launch(dir, { current: "9.4.1" }).result.action).toBe("none");
    expect(rb.readTrial(dir).launches).toBe(0);
  });

  it("the installer of a running trial is protected from the updater's cleanup", () => {
    const { dir, toFile } = scene();
    expect(rb.protectsFile(dir, toFile)).toBe(true);
    expect(rb.protectsFile(dir, join(dir, "other.exe"))).toBe(false);
    rb.abortTrial(dir);
    expect(rb.protectsFile(dir, toFile)).toBe(false);
  });

  it("the window says: Update to X failed; back on Y", () => {
    const notice = updates.updateNotice({ rolledBack: { failed: "9.4.2", back: "9.4.1" } });
    expect(notice).toEqual({ kind: "rolled-back", failed: "9.4.2", back: "9.4.1" });
    const status = mainStatus({ config: {}, state: {}, updateNotice: notice });
    expect(status.needsYou).toMatchObject({ id: "update-rolled-back", text: ["Update to {0} failed; back on {1}", "9.4.2", "9.4.1"] });
  });
});
