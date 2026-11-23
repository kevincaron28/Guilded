import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Prebuilt releases: GitHub Actions builds the bot, deploy/update.sh downloads, verifies and unpacks it, and the old
// build-on-server path stays as a flag and as the automatic fallback. The behaviour test needs bash, curl, tar and
// sha256sum, so it is skipped on Windows (CI and the server run it).
const read = (path: string) => readFileSync(resolve(path), "utf8").replace(/\r\n/g, "\n");
const update = read("deploy/update.sh");
const library = read("deploy/application-update.sh");
const workflow = read(".github/workflows/bot-build.yml");
const packager = read("deploy/package-release.sh");

describe("deploy/update.sh prebuilt path (static)", () => {
  it("has the fallback flags and keeps the old build-on-server preparation", () => {
    expect(update).toContain("--build-on-server");
    expect(update).toContain("--prebuilt");
    expect(update).toContain("GUILDED_BUILD_ON_SERVER");
    expect(update).toContain("if ! prepare_application \"$SRC\" \"$APP\" guilded");
    expect(update).toMatch(/Falling back to building on this server/);
  });

  it("prepares before stopping the bot, never stops it on a failed download, and refuses a prebuilt-only run without a build", () => {
    const prebuilt = update.indexOf("prepare_prebuilt_application \"$APP\"");
    expect(prebuilt).toBeGreaterThan(update.indexOf("ensure_free_disk"));
    expect(prebuilt).toBeLessThan(update.indexOf("systemctl stop guilded"));
    const failure = update.slice(prebuilt, update.indexOf("if [ \"$PREPARED\" != 1 ]"));
    expect(failure).toContain("discard_own_staging \"$STAGED_APP\"");
    expect(failure).toMatch(/--prebuilt was given[^\n]*not replaced or stopped/);
  });

  it("still takes the backup-style recovery copy and migrations the same way (the activation step is shared)", () => {
    expect(update.match(/activate_application "\$APP" "\$STAGED_APP"/g)).toHaveLength(1);
    expect(update).toContain("migrations_changed");
  });

  it("verifies a checksum and the commit before using a download", () => {
    const fn = library.slice(library.indexOf("prepare_prebuilt_application()"));
    expect(fn).toContain("sha256sum -c");
    expect(fn).toContain(".build-sha");
    expect(fn.indexOf("sha256sum -c")).toBeLessThan(fn.indexOf("tar -xzf"));
    expect(fn).not.toMatch(/systemctl/);
  });
});

describe("the CI build and packaging (static)", () => {
  it("publishes a pre-release that is never the latest release, and never from a pull request", () => {
    expect(workflow).toContain("--prerelease --latest=false");
    expect(workflow.match(/if: github\.event_name != 'pull_request'/g)).toHaveLength(2);
    expect(workflow).toContain("bash deploy/package-release.sh");
    expect(workflow).toContain("prepare_prebuilt_application");
  });

  it("never packages secrets, git history or the phone app", () => {
    for (const excluded of ["./.git", "./.env", "./.env.local", "./backups", "./mobile"]) expect(packager).toContain(`--exclude=${excluded}`);
    expect(packager).toContain(".build-sha");
    expect(packager).toContain("--stamp-client");
  });
});

describe.skipIf(process.platform === "win32")("prepare_prebuilt_application (behaviour)", () => {
  const sha = "a".repeat(40);
  function setup() {
    const root = mkdtempSync(join(tmpdir(), "prebuilt-"));
    const pkg = join(root, "pkg"), release = join(root, "rel", `bot-build-${sha}`), live = join(root, "live");
    for (const dir of ["node_modules/.bin", "src/generated/prisma", "scripts", "companion-app/renderer"]) mkdirSync(join(pkg, dir), { recursive: true });
    mkdirSync(release, { recursive: true }); mkdirSync(live);
    for (const file of ["node_modules/.bin/tsx", "node_modules/.bin/prisma", "src/generated/prisma/client.ts", "scripts/db-update-start.mjs", "companion-app/renderer/ui-bundle.js"]) writeFileSync(join(pkg, file), "");
    writeFileSync(join(pkg, "package.json"), "{}"); writeFileSync(join(pkg, ".build-sha"), `${sha}\n`);
    writeFileSync(join(live, ".env.local"), "TOKEN=from-live\n");
    const name = `guilded-bot-${sha}.tar.gz`;
    execFileSync("tar", ["-czf", join(release, name), "-C", pkg, "."]);
    execFileSync("bash", ["-c", `cd "${release}" && sha256sum ${name} > ${name}.sha256`]);
    return { root, release, live, name };
  }
  const run = (root: string, live: string, wanted = sha) => {
    try {
      const out = execFileSync("bash", ["-c", `set -euo pipefail; source deploy/application-update.sh; PREBUILT_BASE="file://${root}/rel"; PREBUILT_WAIT_SECONDS=0
        prepare_prebuilt_application "${live}" "$(id -un)" ${wanted}; ls -A "$STAGED_APP"; cat "$STAGED_APP/.env.local"`], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      return { ok: true, out };
    } catch (error) { return { ok: false, out: String((error as { stdout?: string }).stdout ?? "") }; }
  };

  it("unpacks a verified build next to the live app and carries over its env file", () => {
    const { root, live } = setup();
    try {
      const result = run(root, live);
      expect(result.ok).toBe(true);
      expect(result.out).toContain("node_modules");
      expect(result.out).toContain("TOKEN=from-live");
      expect(existsSync(join(live, ".env.local"))).toBe(true);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("rejects a tampered download and a commit with no build, without touching the live app", () => {
    const { root, release, live, name } = setup();
    try {
      writeFileSync(join(release, name), Buffer.concat([readFileSync(join(release, name)), Buffer.from("x")]));
      expect(run(root, live).ok).toBe(false);
      expect(run(root, live, "b".repeat(40)).ok).toBe(false);
      expect(readFileSync(join(live, ".env.local"), "utf8")).toBe("TOKEN=from-live\n");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
