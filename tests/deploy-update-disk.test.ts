import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Disk housekeeping in deploy/update.sh: old saved applications are pruned, stale staging directories
// are removed, and a low-disk run stops before anything is prepared. The Linux server runs this; the
// behaviour test needs bash and GNU find, so it is skipped on Windows.
const update = readFileSync(resolve("deploy/update.sh"), "utf8").replace(/\r\n/g, "\n");
const library = readFileSync(resolve("deploy/application-update.sh"), "utf8").replace(/\r\n/g, "\n");

describe("deploy/update.sh disk housekeeping (static)", () => {
  it("checks free space and stops before any change when it is still too low", () => {
    const check = update.indexOf("ensure_free_disk \"$APP\" \"$MIN_FREE_KB\"");
    expect(check).toBeGreaterThan(-1);
    expect(update).toContain("MIN_FREE_KB=$((3 * 1024 * 1024))");
    expect(update.slice(check, check + 400)).toMatch(/exit 1/);
    // The check runs after the checkout is fetched and before anything is prepared or stopped.
    expect(check).toBeGreaterThan(update.indexOf("merge --ff-only origin/main"));
    expect(check).toBeLessThan(update.indexOf("prepare_application \"$SRC\""));
    expect(check).toBeLessThan(update.indexOf("systemctl stop guilded"));
  });

  it("removes its own staging directory when preparation fails", () => {
    const failure = update.slice(update.indexOf("if ! prepare_application"), update.indexOf("say \"Stopping the bot"));
    expect(failure).toContain("discard_own_staging \"${STAGED_APP:-}\"");
    expect(failure).toMatch(/exit 1/);
  });

  it("prunes old saved applications only after activation, keeping three", () => {
    const activation = update.indexOf("if ! activate_application");
    const prune = update.indexOf("prune_previous_applications \"$APP\" 3");
    expect(prune).toBeGreaterThan(activation);
    expect(update.slice(prune, prune + 200)).toContain("|| echo");
  });

  it("removes stale staging only while holding the lock", () => {
    const lock = update.indexOf("flock -n 9");
    const stale = update.indexOf("remove_stale_staging \"$APP\"");
    expect(stale).toBeGreaterThan(lock);
  });

  it("never names the app, its lock or a bare variable in a deletion", () => {
    const deletions = library.match(/rm -rf[^\n]*/g) ?? [];
    expect(deletions.length).toBeGreaterThanOrEqual(3);
    for (const line of deletions) {
      expect(line).toMatch(/rm -rf -- /);
      expect(line).not.toMatch(/rm -rf -- \$[A-Za-z_]+\s*$/);
    }
    expect(library).toContain("previous.????????");
    expect(library).toContain("stage.????????");
    expect(library).not.toMatch(/rm[^\n]*update\.lock/);
  });

  it("parses under bash -n", () => {
    if (process.platform === "win32") return;
    for (const file of ["deploy/update.sh", "deploy/application-update.sh"]) {
      execFileSync("bash", ["-n", resolve(file)]);
    }
  });
});

describe.skipIf(process.platform === "win32")("deploy/application-update.sh disk housekeeping (behaviour)", () => {
  it("keeps the three newest saved applications, leaves the app and lock alone, and removes old stages", () => {
    const root = mkdtempSync(join(tmpdir(), "guilded-prune-"));
    const opt = join(root, "opt");
    const app = join(opt, "guilded");
    mkdirSync(app, { recursive: true });
    writeFileSync(join(opt, "guilded.update.lock"), "");
    const day = 24 * 60 * 60 * 1000;
    const dated = (name: string, daysAgo: number) => {
      const path = join(opt, name);
      mkdirSync(path);
      const when = new Date(Date.now() - daysAgo * day);
      utimesSync(path, when, when);
    };
    // Newest first: 1..5 days old.
    for (let n = 1; n <= 5; n++) dated(`guilded.previous.aaaaaaa${n}`, n);
    dated("guilded.previous.short", 9); // wrong suffix length: never matched
    dated("guilded.stage.bbbbbbb1", 2); // stale staging
    dated("guilded.stage.ccccccc1", 0); // fresh staging: kept
    const lib = resolve("deploy/application-update.sh");
    const script = `set -euo pipefail
source "${lib}"
prune_previous_applications "${app}" 3
remove_stale_staging "${app}"
if discard_own_staging "${app}"; then echo "BAD: discarded app"; exit 1; fi
if ensure_free_disk "${app}" 999999999999; then echo "BAD: low disk accepted"; exit 1; fi
discard_own_staging "${join(opt, "guilded.stage.ccccccc1")}"
echo DONE`;
    const out = execFileSync("bash", ["-c", script], { encoding: "utf8" });
    expect(out).toContain("DONE");
    expect(out).toContain("Still only");
    const left = readdirSync(opt).sort();
    expect(left).toEqual([
      "guilded",
      "guilded.previous.aaaaaaa1",
      "guilded.previous.aaaaaaa2",
      "guilded.previous.aaaaaaa3",
      "guilded.previous.short",
      "guilded.update.lock",
    ]);
    expect(existsSync(app)).toBe(true);
  });
});
