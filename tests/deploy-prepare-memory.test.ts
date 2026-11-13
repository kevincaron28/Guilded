import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// deploy/application-update.sh prepare_application. On the 1 GB server a fresh npm ci drove memory into swap.
// When the dependencies match the running application (a version-only bump still counts), its node_modules is
// copied and only Prisma is regenerated. A genuine dependency change runs npm install on a copy of the live
// node_modules (a fresh npm ci is OOM-killed inside the 450 MB cap), verified, and falls back to npm ci with a
// heap cap, only after a memory check. The behaviour tests run the real function with sudo, npm and the Prisma CLI replaced
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
    expect(library).toContain('cp -a --reflink=auto "$from" "$to"');
    expect(library).toContain('copy_tree "$app/node_modules" "$STAGED_APP/node_modules" "$owner"');
    // Never a hard link: npm install rewrites files in place, which would reach the live tree.
    expect(library).not.toMatch(/\bln\b|cp -al|cp -rl|cp -a -l|--link/);
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
    // npm ci, npm install, npm ls, prisma generate and the bundle build; the big copies use run_heavy_idle.
    expect(library.match(/run_heavy sudo -u "\$owner"/g)).toHaveLength(5);
    expect(library.match(/run_heavy_idle sudo -u "\$owner"/g)).toHaveLength(1);
    expect(library).not.toMatch(/^\s*sudo -u "\$owner"/m);
    expect(library).toContain("HEAVY_PROPS_FULL=(MemoryMax=450M MemorySwapMax=200M CPUWeight=20 IOWeight=20 CPUQuota=50%)");
    // MemoryHigh is for the copies only; the install, generate and build keep the 450M / 200M limits they were measured under.
    expect(library).toContain("HEAVY_COPY_HIGH=MemoryHigh=360M");
    expect(library).toContain('run_heavy() { run_heavy_io "-c2 -n7" 0 "$@"; }');
    expect(library).toContain('run_heavy_idle() { run_heavy_io "-c3" 1 "$@"; }');
    expect(library).toContain("HEAVY_PROPS_MEMORY=(MemoryMax=450M MemorySwapMax=200M)");
    // ionice is probed once and skipped where it cannot be set.
    expect(library).toContain("HEAVY_IONICE_OK");
    expect(library).toContain("command -v ionice");
    expect(library).toContain('run_heavy_io "-c2 -n7"');
    expect(library).toContain('run_heavy_io "-c3"');
    expect(library).toContain("command -v systemd-run");
    expect(library).toContain("HEAVY_CAPPED=0");
    expect(library).toContain("cannot set a memory ceiling here");
  });

  it("updates changed dependencies on a copy of the live ones, verifies, and falls back to npm ci", () => {
    expect(library).toMatch(/install_dependencies_incrementally\(\) \{/);
    expect(library).toContain("NODE_OPTIONS=--max-old-space-size=384 npm install --prefer-offline --no-audit --no-fund");
    expect(library).toContain('cmp -s "$STAGED_APP/package-lock.json" "$source/package-lock.json"');
    expect(library).toContain("npm ls --all >/dev/null");
    expect(library).toContain("Updating changed dependencies on a copy of the live ones.");
    expect(library).toContain("falling back to a full install");
    expect(library).toContain("MIN_INCREMENTAL_AVAILABLE_KB=262144");
    // The fallback re-checks memory before a fresh npm ci, after removing the staged copy.
    const fallback = library.slice(library.indexOf("falling back to a full install"));
    expect(fallback.indexOf('rm -rf -- "$STAGED_APP/node_modules"')).toBeLessThan(fallback.indexOf("memory_ok_for_install || return 1"));
  });

  it("caps the Node heap for Prisma generation and the bundle build", () => {
    expect(library).toContain("NODE_OPTIONS=--max-old-space-size=512 ./node_modules/.bin/prisma generate");
    expect(library).toContain("timed_step ");
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
    // How the npm shim misbehaves: rewrites the lockfile, fails npm ls, skips the Prisma client, or fails the install.
    npmFault?: "lock" | "ls" | "client" | "install";
    // The live application has no node_modules (nothing to copy), so a dependency change must do a full npm ci.
    noLiveModules?: boolean;
    // "works": systemd-run passes the command through and logs its limits. "fails": it refuses, as on a box without cgroup limits.
    systemdRun?: "works" | "fails" | "memory-only";
    // The Prisma schema of the source differs from the live application's.
    schemaChanged?: boolean;
    // The live application has no generated Prisma client to copy.
    noLiveClient?: boolean;
    // The live application recorded the hash of the companion sources it was built from (and has the outputs).
    builtLive?: boolean;
    // A companion source file changed since the live build.
    companionChanged?: boolean;
    // ionice exists but refuses (a restricted VM or container).
    ionice?: "works" | "fails";
    // The generated-client copy or the bundle copy fails.
    failCopy?: "client" | "bundle";
    // prisma.config.ts differs from the live application's.
    configChanged?: boolean;
    // Writing the companion build stamp (its chown) fails.
    failStampChown?: boolean;
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
    // Schema, generated client, companion sources and the live bundle outputs.
    for (const dir of [app, source]) {
      for (const sub of ["src", "prisma", "companion", "companion-app/renderer", "scripts", "docs/branding", "site"]) mkdirSync(join(dir, sub), { recursive: true });
      writeFileSync(join(dir, "prisma", "schema.prisma"), dir === source && f.schemaChanged ? "schema B" : "schema A");
      writeFileSync(join(dir, "companion", "a.mjs"), dir === source && f.companionChanged ? "export const a = 2;" : "export const a = 1;");
      writeFileSync(join(dir, "companion-app", "renderer", "ui-entry.js"), "entry");
      writeFileSync(join(dir, "scripts", "build-companion-renderer.mjs"), "build");
      writeFileSync(join(dir, "docs", "branding", "guilded-logo-400.png"), "logo");
      writeFileSync(join(dir, "site", "nav.mjs"), "nav");
    }
    if (f.configChanged) { writeFileSync(join(app, "prisma.config.ts"), "config A"); writeFileSync(join(source, "prisma.config.ts"), "config B"); }
    if (!f.noLiveClient) { mkdirSync(join(app, "src", "generated", "prisma"), { recursive: true }); writeFileSync(join(app, "src", "generated", "prisma", "client.ts"), "live client"); }
    if (f.builtLive) {
      mkdirSync(join(app, "companion-app", "assets"), { recursive: true });
      writeFileSync(join(app, "companion-app", "assets", "icon.png"), "icon");
      writeFileSync(join(app, "companion-app", "renderer", "ui-bundle.js"), "live bundle");
      writeFileSync(join(app, "companion-app", "renderer", "logo.png"), "live logo");
    }
    // The Prisma CLI in the copied tree logs its call and its heap cap.
    const prisma = join(app, "node_modules", ".bin", "prisma");
    writeFileSync(prisma, `#!/bin/sh\necho "prisma $* heap=$NODE_OPTIONS" >> "${log}"\n`);
    chmodSync(prisma, 0o755);
    // sudo drops "-u USER" and runs the rest; npm only logs.
    writeFileSync(join(shims, "sudo"), '#!/bin/sh\nif [ "$1" = "-u" ]; then shift 2; fi\nexec "$@"\n');
    // npm logs its call (and the directory it ran in). "install" writes the Prisma client the postinstall would,
    // unless a fault says otherwise. Only the incremental install is faulted; npm ci always succeeds.
    const fault = f.npmFault ?? "";
    writeFileSync(join(shims, "npm"), `#!/bin/sh
echo "npm $* heap=$NODE_OPTIONS" >> "${log}"
fault="${fault}"
if [ "$1" = "install" ]; then
  [ "$fault" = "install" ] && exit 1
  [ "$fault" != "client" ] && mkdir -p src/generated/prisma && echo x > src/generated/prisma/client.ts
  [ "$fault" = "lock" ] && echo " " >> package-lock.json
fi
if [ "$1" = "ls" ] && [ "$fault" = "ls" ]; then exit 1; fi
exit 0
`);
    for (const name of ["sudo", "npm"]) chmodSync(join(shims, name), 0o755);
    const systemdRun = f.systemdRun === "fails"
      ? `#!/bin/sh\necho "systemd-run $*" >> "${log}"\nexit 1\n`
      : `#!/bin/sh\necho "systemd-run $*" >> "${log}"\nwhile [ "$#" -gt 0 ] && [ "$1" != "--" ]; do shift; done\n[ "$#" -gt 0 ] && shift\nexec "$@"\n`;
    // "memory-only": refuses CPU and I/O properties, as a box without those controllers would.
    const memoryOnly = `#!/bin/sh\necho "systemd-run $*" >> "${log}"\ncase "$*" in *CPUQuota*|*CPUWeight*|*IOWeight*) exit 1;; esac\nwhile [ "$#" -gt 0 ] && [ "$1" != "--" ]; do shift; done\n[ "$#" -gt 0 ] && shift\nexec "$@"\n`;
    writeFileSync(join(shims, "systemd-run"), f.systemdRun === "memory-only" ? memoryOnly : systemdRun);
    // ionice logs its class and runs the rest.
    writeFileSync(join(shims, "ionice"), f.ionice === "fails"
      ? `#!/bin/sh\necho "ionice $*" >> "${log}"\nexit 1\n`
      : `#!/bin/sh\necho "ionice $*" >> "${log}"\nwhile [ "\${1#-}" != "$1" ]; do shift; done\nexec "$@"\n`);
    chmodSync(join(shims, "ionice"), 0o755);
    // cp and chown pass through, except for the faults a fixture asks for.
    const realCp = execFileSync("sh", ["-c", "command -v cp"], { encoding: "utf8" }).trim();
    const realChown = execFileSync("sh", ["-c", "command -v chown"], { encoding: "utf8" }).trim();
    writeFileSync(join(shims, "cp"), `#!/bin/sh\ncase "$*" in\n  *src/generated*) [ "${f.failCopy ?? ""}" = client ] && exit 1;;\n  *ui-bundle.js*) [ "${f.failCopy ?? ""}" = bundle ] && exit 1;;\nesac\nexec "${realCp}" "$@"\n`);
    writeFileSync(join(shims, "chown"), `#!/bin/sh\ncase "$*" in *companion-build-stamp*) [ "${f.failStampChown ? "yes" : ""}" = yes ] && exit 1;; esac\nexec "${realChown}" "$@"\n`);
    chmodSync(join(shims, "cp"), 0o755);
    chmodSync(join(shims, "chown"), 0o755);
    chmodSync(join(shims, "systemd-run"), 0o755);
    if (f.noLiveModules) rmSync(join(app, "node_modules"), { recursive: true, force: true });
    const meminfo = join(root, "meminfo");
    writeFileSync(meminfo, f.meminfo ?? "MemTotal: 1000000 kB\nMemAvailable: 900000 kB\nSwapTotal: 0 kB\nSwapFree: 0 kB\n");
    const stamp = f.builtLive ? `source "${resolve("deploy/application-update.sh")}"\ncompanion_build_fingerprint "${app}" > "${app}/.companion-build-stamp"\n` : "";
    const script = `set -euo pipefail
export PATH="${shims}:$PATH"
export MEMINFO_FILE="${meminfo}"
source "${resolve("deploy/application-update.sh")}"
${stamp}if prepare_application "${source}" "${app}" "${owner}"; then echo "RESULT=ok"; else echo "RESULT=refused"; fi
echo "STAGED=\${STAGED_APP:-}"`;
    const out = execFileSync("bash", ["-c", script], { encoding: "utf8" });
    const staged = /STAGED=(.*)/.exec(out)?.[1]?.trim() ?? "";
    const calls = existsSync(log) ? readFileSync(log, "utf8") : "";
    const stageDirs = readdirSync(opt).filter((n) => n.includes(".stage."));
    return { app, staged, calls, out, stageDirs };
  }

  it("a version-only bump copies node_modules and the generated client, and never runs npm ci", () => {
    const { app, staged, calls, out } = fixture({ sourceVersion: "9.0.3" });
    expect(out).toContain("RESULT=ok");
    expect(calls).not.toContain("npm ci");
    expect(calls).not.toContain("prisma generate");
    expect(calls).toContain("npm run companion:build heap=--max-old-space-size=384");
    expect(readFileSync(join(staged, "node_modules", "marker.js"), "utf8")).toBe("live");
    // A real copy: a different inode, and writing it leaves the live tree alone.
    expect(statSync(join(staged, "node_modules", "marker.js")).ino).not.toBe(statSync(join(app, "node_modules", "marker.js")).ino);
    writeFileSync(join(staged, "node_modules", "marker.js"), "changed in staging");
    expect(readFileSync(join(app, "node_modules", "marker.js"), "utf8")).toBe("live");
    // The generated client is a copy too: staging writes never reach the live tree.
    expect(readFileSync(join(staged, "src", "generated", "prisma", "client.ts"), "utf8")).toBe("live client");
    writeFileSync(join(staged, "src", "generated", "prisma", "client.ts"), "changed in staging");
    expect(readFileSync(join(app, "src", "generated", "prisma", "client.ts"), "utf8")).toBe("live client");
  });

  it("regenerates the Prisma client when the schema changed or the live client is missing", () => {
    const changedSchema = fixture({ sourceVersion: "9.0.3", schemaChanged: true });
    expect(changedSchema.out).toContain("RESULT=ok");
    expect(changedSchema.calls).toContain("prisma generate heap=--max-old-space-size=512");
    expect(existsSync(join(changedSchema.staged, "src", "generated", "prisma", "client.ts"))).toBe(false);
    const noClient = fixture({ sourceVersion: "9.0.3", noLiveClient: true });
    expect(noClient.calls).toContain("prisma generate heap=--max-old-space-size=512");
  });

  it("prints a timing line for each preparation step and a total", () => {
    const { out } = fixture({ sourceVersion: "9.0.3" });
    for (const label of ["mode: reuse", "copy source: ", "copy node_modules: ", "copy prisma client: ", "companion build: ", "total: "]) expect(out).toContain(`[prepare] ${label}`);
    const incremental = fixture({ sourceLock: changed });
    for (const label of ["copy node_modules: ", "npm install: ", "npm ls: ", "companion build: "]) expect(incremental.out).toContain(`[prepare] ${label}`);
  });

  it("copies the live companion bundle when its sources are unchanged, and builds when they changed", () => {
    const same = fixture({ sourceVersion: "9.0.3", builtLive: true });
    expect(same.out).toContain("RESULT=ok");
    expect(same.out).toContain("copying the live bundle");
    expect(same.calls).not.toContain("companion:build");
    expect(readFileSync(join(same.staged, "companion-app", "renderer", "ui-bundle.js"), "utf8")).toBe("live bundle");
    expect(readFileSync(join(same.staged, ".companion-build-stamp"), "utf8")).toBe(readFileSync(join(same.app, ".companion-build-stamp"), "utf8"));
    const edited = fixture({ sourceVersion: "9.0.3", builtLive: true, companionChanged: true });
    expect(edited.out).toContain("RESULT=ok");
    expect(edited.out).not.toContain("copying the live bundle");
    expect(edited.calls).toContain("npm run companion:build heap=--max-old-space-size=384");
    expect(readFileSync(join(edited.staged, ".companion-build-stamp"), "utf8")).not.toBe(readFileSync(join(edited.app, ".companion-build-stamp"), "utf8"));
    // Without a recorded stamp (the first deploy with this feature) it builds.
    expect(fixture({ sourceVersion: "9.0.3" }).calls).toContain("companion:build");
  });

  it("copies at idle I/O priority and runs the other steps at the lowest best-effort priority", () => {
    const { calls } = fixture({ sourceLock: changed });
    expect(calls).toMatch(/^ionice -c3 sudo -u .* cp -a --reflink=auto /m);
    expect(calls).toMatch(/^ionice -c2 -n7 sudo -u .* npm install/m);
  });

  it("falls back to the memory limits alone when the box cannot set CPU or I/O limits", () => {
    const { calls, out } = fixture({ sourceVersion: "9.0.3", systemdRun: "memory-only" });
    expect(out).toContain("RESULT=ok");
    expect(out).toContain("memory limits only");
    const heavy = calls.split("\n").filter((line) => line.startsWith("systemd-run") && line.includes("-- ionice"));
    expect(heavy.length).toBeGreaterThan(0);
    for (const line of heavy) expect(line).not.toMatch(/CPUQuota|CPUWeight|IOWeight/);
    expect(heavy[0]).toContain("-p MemoryMax=450M -p MemorySwapMax=200M");
  });

  it("keeps MemoryHigh off npm install, npm ls and prisma generate", () => {
    const { calls } = fixture({ sourceLock: changed });
    const scoped = calls.split("\n").filter((line) => line.startsWith("systemd-run"));
    for (const step of ["npm install", "npm ls"]) {
      const lines = scoped.filter((line) => line.includes(step));
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) expect(line).not.toContain("MemoryHigh");
    }
    const generate = fixture({ sourceVersion: "9.0.3", schemaChanged: true }).calls.split("\n").filter((line) => line.startsWith("systemd-run") && line.includes("prisma generate"));
    expect(generate.length).toBeGreaterThan(0);
    for (const line of generate) expect(line).not.toContain("MemoryHigh");
  });

  it("runs without ionice, and says so, when it cannot set an I/O priority", () => {
    const { calls, out } = fixture({ sourceVersion: "9.0.3", ionice: "fails" });
    expect(out).toContain("RESULT=ok");
    expect(out).toContain("ionice cannot set an I/O priority here");
    for (const line of calls.split("\n").filter((l) => l.startsWith("systemd-run"))) expect(line).not.toContain("ionice");
    expect(calls).toContain("npm run companion:build");
  });

  it("rebuilds the companion bundle after a dependency change even when the bundle sources are unchanged", () => {
    const { out, calls } = fixture({ sourceLock: changed, builtLive: true });
    expect(out).toContain("RESULT=ok");
    expect(out).not.toContain("copying the live bundle");
    expect(calls).toContain("npm run companion:build");
  });

  it("generates the Prisma client when prisma.config.ts changed", () => {
    const { calls, out } = fixture({ sourceVersion: "9.0.3", configChanged: true });
    expect(out).toContain("RESULT=ok");
    expect(out).not.toContain("copying the live generated client");
    expect(calls).toContain("prisma generate");
  });

  it("falls back to generating and building when copying the client or the bundle fails", () => {
    const client = fixture({ sourceVersion: "9.0.3", failCopy: "client" });
    expect(client.out).toContain("RESULT=ok");
    expect(client.out).toContain("Copying the client failed; generating it instead.");
    expect(client.calls).toContain("prisma generate");
    const bundle = fixture({ sourceVersion: "9.0.3", builtLive: true, failCopy: "bundle" });
    expect(bundle.out).toContain("RESULT=ok");
    expect(bundle.out).toContain("Copying the bundle failed; building it instead.");
    expect(bundle.calls).toContain("npm run companion:build");
  });

  it("only warns when the companion build hash cannot be recorded", () => {
    for (const builtLive of [true, false]) {
      const { out, staged } = fixture({ sourceVersion: "9.0.3", builtLive, failStampChown: true });
      expect(out).toContain("RESULT=ok");
      expect(out).toContain("Could not record the companion build hash");
      expect(existsSync(join(staged, ".companion-build-stamp"))).toBe(false);
    }
  });

  it("a version-only bump still reuses node_modules on a low-memory box", () => {
    const low = "MemTotal: 1000000 kB\nMemAvailable: 20000 kB\nSwapTotal: 0 kB\nSwapFree: 0 kB\n";
    const { calls, out } = fixture({ sourceVersion: "9.0.3", meminfo: low });
    expect(out).toContain("RESULT=ok");
    expect(calls).not.toContain("npm ci");
  });

  const changed = JSON.stringify({ name: "fixture", version: "9.0.2", lockfileVersion: 3, packages: { "": { name: "fixture", version: "9.0.2" } } });

  it("a genuine dependency change updates a copy of the live node_modules with npm install, verified, no npm ci", () => {
    const { app, staged, calls, out } = fixture({ sourceLock: changed });
    expect(out).toContain("RESULT=ok");
    expect(out).toContain("Updating changed dependencies on a copy of the live ones.");
    expect(out).not.toContain("falling back");
    expect(calls).toContain("npm install --prefer-offline --no-audit --no-fund heap=--max-old-space-size=384");
    expect(calls).toContain("npm ls --all heap=--max-old-space-size=384");
    expect(calls).not.toContain("npm ci");
    // Prisma generation comes from the install's postinstall, not a separate call.
    expect(calls).not.toContain("prisma generate");
    // The live tree was copied, and the live one is untouched.
    expect(readFileSync(join(staged, "node_modules", "marker.js"), "utf8")).toBe("live");
    expect(readFileSync(join(app, "src", "generated", "prisma", "client.ts"), "utf8")).toBe("live client");
  });

  it("an incremental install needs only the small sanity floor, not the full-install memory", () => {
    const some = "MemTotal: 1000000 kB\nMemAvailable: 300000 kB\nSwapTotal: 0 kB\nSwapFree: 0 kB\n";
    const { calls, out } = fixture({ sourceLock: changed, meminfo: some });
    expect(out).toContain("RESULT=ok");
    expect(calls).toContain("npm install --prefer-offline");
    expect(calls).not.toContain("npm ci");
  });

  for (const fault of ["lock", "ls", "client", "install"] as const) {
    it(`falls back to a full npm ci when the incremental install fails its check (${fault})`, () => {
      const { staged, calls, out } = fixture({ sourceLock: changed, npmFault: fault });
      expect(out).toContain("RESULT=ok");
      expect(out).toContain("falling back to a full install");
      expect(calls).toContain("npm ci --prefer-offline --no-audit --no-fund heap=--max-old-space-size=512");
      // The copied tree was removed before the fresh install: the old marker is gone.
      expect(existsSync(join(staged, "node_modules", "marker.js"))).toBe(false);
    });
  }

  it("a failed incremental install on a box too low for a full install refuses", () => {
    // 300 MB passes the incremental floor (256 MB) but not the full-install gate (384 MB).
    const some = "MemTotal: 1000000 kB\nMemAvailable: 300000 kB\nSwapTotal: 0 kB\nSwapFree: 0 kB\n";
    const { calls, out } = fixture({ sourceLock: changed, npmFault: "ls", meminfo: some });
    expect(out).toContain("RESULT=refused");
    expect(out).toContain("Not enough memory to install new dependencies");
    expect(calls).not.toContain("npm ci");
  });

  it("without a live node_modules a dependency change runs a full npm ci with the heap cap and the cache preferred", () => {
    const { calls, out } = fixture({ sourceLock: changed, noLiveModules: true });
    expect(out).toContain("RESULT=ok");
    expect(out).toContain("Installing all dependencies with a full npm ci.");
    expect(calls).toContain("npm ci --prefer-offline --no-audit --no-fund heap=--max-old-space-size=512");
    expect(calls).not.toContain("npm install");
    expect(calls).not.toContain("prisma generate");
  });

  it("a genuine dependency change on a low-memory box stops before anything is created", () => {
    const low = "MemTotal: 1000000 kB\nMemAvailable: 200000 kB\nSwapTotal: 0 kB\nSwapFree: 100000 kB\n";
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
    expect(calls).toContain("-p MemoryMax=450M -p MemorySwapMax=200M -p CPUWeight=20 -p IOWeight=20 -p CPUQuota=50% -p MemoryHigh=360M");
    // MemoryHigh only on the copies: the install-class steps keep MemoryMax 450M and 200M swap alone.
    const scoped = calls.split("\n").filter((line) => line.startsWith("systemd-run"));
    expect(scoped.filter((line) => line.includes("cp -a")).every((line) => line.includes("MemoryHigh=360M"))).toBe(true);
    expect(scoped.filter((line) => line.includes("companion:build")).every((line) => !line.includes("MemoryHigh"))).toBe(true);
    expect(scoped.filter((line) => line.includes("companion:build")).length).toBeGreaterThan(0);
    // The probe, the node_modules copy, the generated-client copy and the bundle build: four systemd-run calls for a version-only bump.
    expect(calls.match(/^systemd-run /gm)).toHaveLength(4);
  });

  it("runs the incremental install and its check under the ceiling for a real dependency change", () => {
    const { calls, out } = fixture({ sourceLock: changed });
    expect(out).toContain("RESULT=ok");
    // Probe, node_modules copy, npm install, npm ls, bundle build.
    expect(calls.match(/^systemd-run /gm)).toHaveLength(5);
    expect(calls).toMatch(/-- ionice -c\d.* sudo -u/);
  });

  it("runs a full npm ci under the ceiling when there is no live node_modules", () => {
    const { calls, out } = fixture({ sourceLock: changed, noLiveModules: true });
    expect(out).toContain("RESULT=ok");
    expect(calls.match(/^systemd-run /gm)).toHaveLength(3);
    expect(calls).toContain("npm ci --prefer-offline --no-audit --no-fund heap=--max-old-space-size=512");
  });

  it("says so and still installs when systemd-run cannot set a ceiling", () => {
    const { calls, out } = fixture({ sourceLock: changed, systemdRun: "fails" });
    expect(out).toContain("cannot set a memory ceiling here");
    expect(out).toContain("RESULT=ok");
    expect(calls).not.toContain("-- sudo");
    expect(calls).toContain("npm install --prefer-offline --no-audit --no-fund heap=--max-old-space-size=384");
  });

  it("an unreadable memory report refuses a fresh install rather than guessing", () => {
    const { calls, out } = fixture({ sourceLock: changed, meminfo: "MemTotal: 1000000 kB\n" });
    expect(out).toContain("RESULT=refused");
    expect(calls).not.toContain("npm ci");
  });
});
