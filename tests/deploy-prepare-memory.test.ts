import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// deploy/application-update.sh prepare_application. On the 1 GB server a fresh npm ci drove memory into swap.
// When the dependencies match the running application (a version-only bump still counts), its node_modules is
// copied and only Prisma is regenerated. A genuine dependency change runs npm ci with a heap cap, and only
// after a memory check. The behaviour tests run the real function with sudo, npm and the Prisma CLI replaced
// by logging shims, so they need Linux bash and rsync.
const library = readFileSync(resolve("deploy/application-update.sh"), "utf8").replace(/\r\n/g, "\n");
const posix = process.platform !== "win32";
const hasRsync = posix && (() => { try { execFileSync("rsync", ["--version"]); return true; } catch { return false; } })();
const owner = userInfo().username;
const hasGroup = posix && (() => { try { execFileSync("getent", ["group", owner]); return true; } catch { return false; } })();

describe("deploy/application-update.sh dependency reuse (static)", () => {
  it("compares dependency content, not bytes, so version-only bumps reuse node_modules", () => {
    expect(library).toMatch(/dependency_fingerprint\(\) \{/);
    expect(library).toMatch(/can_reuse_dependencies\(\) \{/);
    expect(library).toContain('"dependencies", "devDependencies", "optionalDependencies", "peerDependencies", "overrides"');
    expect(library).toContain('delete lock.version;');
    expect(library).toContain('delete lock.packages[""].version;');
    expect(library).not.toContain('cmp -s "$source/package-lock.json"');
  });

  it("copies rather than links, and runs npm ci only for a real dependency change", () => {
    expect(library).toContain('cp -a "$app/node_modules" "$STAGED_APP/node_modules"');
    expect(library).not.toMatch(/\bln\b|cp -al|cp -rl/);
    expect(library).toContain("NODE_OPTIONS=--max-old-space-size=512 npm ci --prefer-offline --no-audit --no-fund");
  });

  it("checks memory before a fresh install, and before anything is created", () => {
    expect(library).toMatch(/memory_ok_for_install\(\) \{/);
    const check = library.indexOf("memory_ok_for_install || return 1");
    const staging = library.indexOf('STAGED_APP="$(mktemp');
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(staging);
    expect(library).toContain("MIN_AVAILABLE_KB=393216");
    expect(library).toContain("MIN_AVAILABLE_PLUS_SWAP_KB=786432");
  });

  it("runs every heavy step through run_heavy, inside the memory ceiling", () => {
    expect(library.match(/^\s*run_heavy sudo -u "\$owner"/gm)).toHaveLength(3);
    expect(library).not.toMatch(/^\s*sudo -u "\$owner"/m);
    expect(library).toContain("MemoryMax=450M -p MemorySwapMax=200M -p CPUWeight=20 -p IOWeight=20");
    expect(library).toContain("command -v systemd-run");
    expect(library).toContain("HEAVY_CAPPED=0");
    expect(library).toContain("cannot set a memory ceiling here");
  });

  it("caps the Node heap for Prisma generation and the bundle build", () => {
    expect(library).toContain("NODE_OPTIONS=--max-old-space-size=512 ./node_modules/.bin/prisma generate");
    expect(library).toContain("NODE_OPTIONS=--max-old-space-size=384 npm run companion:build");
  });
});

describe.skipIf(!hasRsync || !hasGroup)("deploy/application-update.sh dependency reuse (behaviour)", () => {
  type Fixture = {
    sourceVersion?: string;
    sourceLock?: string;
    appVersion?: string;
    appLock?: string;
    meminfo?: string;
    // "works": systemd-run passes the command through and logs its limits. "fails": it refuses, as on a box without cgroup limits.
    systemdRun?: "works" | "fails";
  };

  function fixture(f: Fixture = {}) {
    const root = mkdtempSync(join(tmpdir(), "guilded-prepare-"));
    const shims = join(root, "shims");
    const opt = join(root, "opt");
    const app = join(opt, "guilded");
    const source = join(root, "source");
    const log = join(root, "calls.log");
    for (const dir of [shims, app, join(app, "node_modules", ".bin"), source]) mkdirSync(dir, { recursive: true });
    const manifest = (version: string) => JSON.stringify({ name: "fixture", version, private: true, dependencies: { leftpad: "1.3.0" } });
    const lock = (version: string, leftpad = "1.3.0") => JSON.stringify({
      name: "fixture", version, lockfileVersion: 3,
      packages: { "": { name: "fixture", version, dependencies: { leftpad } }, "node_modules/leftpad": { version: leftpad } },
    });
    writeFileSync(join(app, "package.json"), manifest(f.appVersion ?? "9.0.2"));
    writeFileSync(join(app, "package-lock.json"), f.appLock ?? lock(f.appVersion ?? "9.0.2"));
    writeFileSync(join(source, "package.json"), manifest(f.sourceVersion ?? "9.0.2"));
    writeFileSync(join(source, "package-lock.json"), f.sourceLock ?? lock(f.sourceVersion ?? "9.0.2"));
    writeFileSync(join(app, "node_modules", "marker.js"), "live");
    // The Prisma CLI in the copied tree logs its call and its heap cap.
    const prisma = join(app, "node_modules", ".bin", "prisma");
    writeFileSync(prisma, `#!/bin/sh\necho "prisma $* heap=$NODE_OPTIONS" >> "${log}"\n`);
    chmodSync(prisma, 0o755);
    // sudo drops "-u USER" and runs the rest; npm only logs.
    writeFileSync(join(shims, "sudo"), '#!/bin/sh\nif [ "$1" = "-u" ]; then shift 2; fi\nexec "$@"\n');
    writeFileSync(join(shims, "npm"), `#!/bin/sh\necho "npm $* heap=$NODE_OPTIONS" >> "${log}"\n`);
    for (const name of ["sudo", "npm"]) chmodSync(join(shims, name), 0o755);
    const systemdRun = f.systemdRun === "fails"
      ? `#!/bin/sh\necho "systemd-run $*" >> "${log}"\nexit 1\n`
      : `#!/bin/sh\necho "systemd-run $*" >> "${log}"\nwhile [ "$#" -gt 0 ] && [ "$1" != "--" ]; do shift; done\n[ "$#" -gt 0 ] && shift\nexec "$@"\n`;
    writeFileSync(join(shims, "systemd-run"), systemdRun);
    chmodSync(join(shims, "systemd-run"), 0o755);
    const meminfo = join(root, "meminfo");
    writeFileSync(meminfo, f.meminfo ?? "MemTotal: 1000000 kB\nMemAvailable: 900000 kB\nSwapTotal: 0 kB\nSwapFree: 0 kB\n");
    const script = `set -euo pipefail
export PATH="${shims}:$PATH"
export MEMINFO_FILE="${meminfo}"
source "${resolve("deploy/application-update.sh")}"
if prepare_application "${source}" "${app}" "${owner}"; then echo "RESULT=ok"; else echo "RESULT=refused"; fi
echo "STAGED=\${STAGED_APP:-}"`;
    const out = execFileSync("bash", ["-c", script], { encoding: "utf8" });
    const staged = /STAGED=(.*)/.exec(out)?.[1]?.trim() ?? "";
    const calls = existsSync(log) ? readFileSync(log, "utf8") : "";
    const stageDirs = readdirSync(opt).filter((n) => n.includes(".stage."));
    return { app, staged, calls, out, stageDirs };
  }

  it("a version-only bump copies node_modules, regenerates Prisma and never runs npm ci", () => {
    const { app, staged, calls, out } = fixture({ sourceVersion: "9.0.3" });
    expect(out).toContain("RESULT=ok");
    expect(calls).not.toContain("npm ci");
    expect(calls).toContain("prisma generate heap=--max-old-space-size=512");
    expect(calls).toContain("npm run companion:build heap=--max-old-space-size=384");
    expect(readFileSync(join(staged, "node_modules", "marker.js"), "utf8")).toBe("live");
    // A real copy: a different inode, and writing it leaves the live tree alone.
    expect(statSync(join(staged, "node_modules", "marker.js")).ino).not.toBe(statSync(join(app, "node_modules", "marker.js")).ino);
    writeFileSync(join(staged, "node_modules", "marker.js"), "changed in staging");
    expect(readFileSync(join(app, "node_modules", "marker.js"), "utf8")).toBe("live");
  });

  it("a version-only bump still reuses node_modules on a low-memory box", () => {
    const low = "MemTotal: 1000000 kB\nMemAvailable: 20000 kB\nSwapTotal: 0 kB\nSwapFree: 0 kB\n";
    const { calls, out } = fixture({ sourceVersion: "9.0.3", meminfo: low });
    expect(out).toContain("RESULT=ok");
    expect(calls).not.toContain("npm ci");
  });

  it("a genuine dependency change runs npm ci with the heap cap and the npm cache preferred", () => {
    const changed = JSON.stringify({ name: "fixture", version: "9.0.2", lockfileVersion: 3, packages: { "": { name: "fixture", version: "9.0.2" } } });
    const { calls, out } = fixture({ sourceLock: changed });
    expect(out).toContain("RESULT=ok");
    expect(calls).toContain("npm ci --prefer-offline --no-audit --no-fund heap=--max-old-space-size=512");
    expect(calls).not.toContain("prisma generate");
  });

  it("a genuine dependency change on a low-memory box stops before anything is created", () => {
    const low = "MemTotal: 1000000 kB\nMemAvailable: 200000 kB\nSwapTotal: 0 kB\nSwapFree: 100000 kB\n";
    const changed = JSON.stringify({ name: "fixture", version: "9.0.2", lockfileVersion: 3, packages: { "": { name: "fixture", version: "9.0.2" } } });
    const { calls, out, stageDirs, staged } = fixture({ sourceLock: changed, meminfo: low });
    expect(out).toContain("RESULT=refused");
    expect(out).toContain("Not enough memory to install new dependencies: 195 MB available, 97 MB swap free.");
    expect(calls).not.toContain("npm ci");
    expect(stageDirs).toEqual([]);
    expect(staged).toBe("");
  });

  it("runs the heavy steps under the ceiling: a probe, then prisma and the bundle", () => {
    const { calls, out } = fixture({ sourceVersion: "9.0.3" });
    expect(out).toContain("RESULT=ok");
    expect(calls).toContain("-p MemoryMax=450M -p MemorySwapMax=200M -p CPUWeight=20 -p IOWeight=20");
    // The probe, Prisma generation and the bundle build: three systemd-run calls for a version-only bump.
    expect(calls.match(/^systemd-run /gm)).toHaveLength(3);
  });

  it("runs npm ci under the ceiling for a real dependency change", () => {
    const changed = JSON.stringify({ name: "fixture", version: "9.0.2", lockfileVersion: 3, packages: { "": { name: "fixture", version: "9.0.2" } } });
    const { calls, out } = fixture({ sourceLock: changed });
    expect(out).toContain("RESULT=ok");
    expect(calls.match(/^systemd-run /gm)).toHaveLength(3);
    expect(calls).toContain("-- sudo -u");
    expect(calls).toContain("npm ci --prefer-offline --no-audit --no-fund heap=--max-old-space-size=512");
  });

  it("says so and still installs when systemd-run cannot set a ceiling", () => {
    const changed = JSON.stringify({ name: "fixture", version: "9.0.2", lockfileVersion: 3, packages: { "": { name: "fixture", version: "9.0.2" } } });
    const { calls, out } = fixture({ sourceLock: changed, systemdRun: "fails" });
    expect(out).toContain("cannot set a memory ceiling here");
    expect(out).toContain("RESULT=ok");
    expect(calls).not.toContain("-- sudo");
    expect(calls).toContain("npm ci --prefer-offline --no-audit --no-fund heap=--max-old-space-size=512");
  });

  it("an unreadable memory report refuses a fresh install rather than guessing", () => {
    const changed = JSON.stringify({ name: "fixture", version: "9.0.2", lockfileVersion: 3, packages: { "": { name: "fixture", version: "9.0.2" } } });
    const { calls, out } = fixture({ sourceLock: changed, meminfo: "MemTotal: 1000000 kB\n" });
    expect(out).toContain("RESULT=refused");
    expect(calls).not.toContain("npm ci");
  });
});
