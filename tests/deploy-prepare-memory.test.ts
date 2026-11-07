import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// deploy/application-update.sh prepare_application: on the 1 GB server the npm ci step drove memory into
// swap. When the lockfile matches the running application, its node_modules is copied and only Prisma is
// regenerated; the build steps carry a heap cap. These tests run the real function with sudo, npm and the
// Prisma CLI replaced by logging shims, so they need Linux bash and rsync.
const library = readFileSync(resolve("deploy/application-update.sh"), "utf8").replace(/\r\n/g, "\n");
const posix = process.platform !== "win32";
const hasRsync = posix && (() => { try { execFileSync("rsync", ["--version"]); return true; } catch { return false; } })();
const owner = userInfo().username;
const hasGroup = posix && (() => { try { execFileSync("getent", ["group", owner]); return true; } catch { return false; } })();

describe("deploy/application-update.sh dependency reuse (static)", () => {
  it("reuses the running node_modules only on a byte-identical lock and manifest", () => {
    expect(library).toMatch(/can_reuse_dependencies\(\) \{/);
    expect(library).toContain('cmp -s "$source/package.json" "$app/package.json"');
    expect(library).toContain('cmp -s "$source/package-lock.json" "$app/package-lock.json"');
  });

  it("copies rather than links, and keeps npm ci for a changed lock", () => {
    expect(library).toContain('cp -a "$app/node_modules" "$STAGED_APP/node_modules"');
    expect(library).not.toMatch(/\bln\b|cp -al|cp -rl/);
    expect(library).toContain("npm ci --no-audit --no-fund");
  });

  it("caps the Node heap for Prisma generation and the bundle build", () => {
    expect(library).toContain("NODE_OPTIONS=--max-old-space-size=512 ./node_modules/.bin/prisma generate");
    expect(library).toContain("NODE_OPTIONS=--max-old-space-size=384 npm run companion:build");
  });
});

describe.skipIf(!hasRsync || !hasGroup)("deploy/application-update.sh dependency reuse (behaviour)", () => {
  function fixture(sameLock: boolean) {
    const root = mkdtempSync(join(tmpdir(), "guilded-prepare-"));
    const shims = join(root, "shims");
    const opt = join(root, "opt");
    const app = join(opt, "guilded");
    const source = join(root, "source");
    const log = join(root, "calls.log");
    for (const dir of [shims, app, join(app, "node_modules", ".bin"), source]) mkdirSync(dir, { recursive: true });
    const manifest = '{"name":"fixture","version":"1.0.0","private":true}';
    writeFileSync(join(app, "package.json"), manifest);
    writeFileSync(join(app, "package-lock.json"), '{"lockfileVersion":3}');
    writeFileSync(join(source, "package.json"), manifest);
    writeFileSync(join(source, "package-lock.json"), sameLock ? '{"lockfileVersion":3}' : '{"lockfileVersion":3,"changed":true}');
    writeFileSync(join(app, "node_modules", "marker.js"), "live");
    // The Prisma CLI in the copied tree logs its call and its heap cap.
    const prisma = join(app, "node_modules", ".bin", "prisma");
    writeFileSync(prisma, `#!/bin/sh\necho "prisma $* heap=$NODE_OPTIONS" >> "${log}"\n`);
    chmodSync(prisma, 0o755);
    // sudo drops "-u USER" and runs the rest; npm only logs.
    writeFileSync(join(shims, "sudo"), '#!/bin/sh\nif [ "$1" = "-u" ]; then shift 2; fi\nexec "$@"\n');
    writeFileSync(join(shims, "npm"), `#!/bin/sh\necho "npm $* heap=$NODE_OPTIONS" >> "${log}"\n`);
    for (const name of ["sudo", "npm"]) chmodSync(join(shims, name), 0o755);
    const script = `set -euo pipefail
export PATH="${shims}:$PATH"
source "${resolve("deploy/application-update.sh")}"
prepare_application "${source}" "${app}" "${owner}"
echo "STAGED=$STAGED_APP"`;
    const out = execFileSync("bash", ["-c", script], { encoding: "utf8" });
    const staged = /STAGED=(.*)/.exec(out)?.[1]?.trim() ?? "";
    const calls = existsSync(log) ? readFileSync(log, "utf8") : "";
    return { app, staged, calls };
  }

  it("with the same lock: copies node_modules, regenerates Prisma, never runs npm ci", () => {
    const { app, staged, calls } = fixture(true);
    expect(calls).not.toContain("npm ci");
    expect(calls).toContain("prisma generate heap=--max-old-space-size=512");
    expect(calls).toContain("npm run companion:build heap=--max-old-space-size=384");
    expect(readFileSync(join(staged, "node_modules", "marker.js"), "utf8")).toBe("live");
    // A real copy: the staged file is a different inode, and writing it leaves the live tree alone.
    expect(statSync(join(staged, "node_modules", "marker.js")).ino).not.toBe(statSync(join(app, "node_modules", "marker.js")).ino);
    writeFileSync(join(staged, "node_modules", "marker.js"), "changed in staging");
    expect(readFileSync(join(app, "node_modules", "marker.js"), "utf8")).toBe("live");
  });

  it("with a different lock: falls back to npm ci", () => {
    const { calls } = fixture(false);
    expect(calls).toContain("npm ci --no-audit --no-fund");
    expect(calls).not.toContain("prisma generate");
  });
});
