import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Deploy hardening after the 9.0.3 outage: the bot's unit is protected from the OOM killer and restarts
// on failure, a changed unit is installed without leaving the bot without one, and the runbook explains
// the monitor and the freeze. These are static checks; the behaviour of the cgroup ceiling is covered by
// tests/deploy-prepare-memory.test.ts.
const read = (file: string) => readFileSync(resolve(file), "utf8").replace(/\r\n/g, "\n");
const update = read("deploy/update.sh");
const unit = read("deploy/guilded.service");
const setup = read("deploy/setup-server.sh");
const runbook = read("docs/DEPLOY_ORACLE.md");

describe("the bot's systemd unit (static)", () => {
  it("restarts the bot after any exit and keeps the memory ceiling", () => {
    expect(unit).toMatch(/^Restart=always$/m);
    expect(unit).toMatch(/^RestartSec=\d+$/m);
    expect(unit).toMatch(/^MemoryMax=700M$/m);
  });

  it("protects the bot from the OOM killer and reserves memory for it", () => {
    expect(unit).toMatch(/^OOMScoreAdjust=-500$/m);
    expect(unit).toMatch(/^MemoryLow=\d+M$/m);
  });

  it("is still the file setup-server.sh installs", () => {
    expect(setup).toContain('cp "$APP/deploy/guilded.service" /etc/systemd/system/guilded.service');
  });
});

describe("deploy/update.sh installs a changed unit safely (static)", () => {
  it("writes the new unit beside the old one and moves it into place in one step", () => {
    expect(update).toContain('UNIT_NEW="$(mktemp /etc/systemd/system/.guilded.service.XXXXXXXX)"');
    expect(update).toMatch(/install -m 644 "\$APP\/deploy\/guilded\.service" "\$UNIT_NEW" && mv -f "\$UNIT_NEW" "\$UNIT"/);
    expect(update).not.toContain('cp "$APP/deploy/guilded.service" /etc/systemd/system/guilded.service');
  });

  it("saves the previous unit before the change, and restores it when systemd rejects the new one", () => {
    const saved = update.indexOf('"$PREVIOUS_APP/.recovery-service"');
    const move = update.indexOf('mv -f "$UNIT_NEW" "$UNIT"');
    const reload = update.indexOf("systemctl daemon-reload");
    expect(saved).toBeGreaterThan(-1);
    expect(saved).toBeLessThan(move);
    expect(move).toBeLessThan(reload);
    expect(update).toContain("restoring the previous one");
    expect(update.slice(reload, reload + 300)).toContain('cp -p "$PREVIOUS_APP/.recovery-service" "$UNIT"');
  });

  it("leaves the previous unit in place when the new one cannot be written", () => {
    expect(update).toContain('rm -f "${UNIT_NEW:-}"');
    expect(update).toContain("the previous one stays in place");
  });
});

describe("docs/DEPLOY_ORACLE.md runbook (static)", () => {
  it("documents the freeze, the guards and the owner's steps when the monitor emails", () => {
    expect(runbook).toContain("## Deploy guards, the 7-8 November freeze and the uptime monitor");
    expect(runbook).toContain("450 MB");
    expect(runbook).toContain("https://guilded.kcaron.top/health");
    expect(runbook).toMatch(/wait 10 minutes/i);
    expect(runbook).toContain("**Reboot**");
  });
});

describe("uptime monitor (static)", () => {
  const workflow = ".github/workflows/uptime.yml";

  it("runs every 10 minutes against the public health endpoint, read-only", () => {
    expect(existsSync(resolve(workflow))).toBe(true);
    const text = read(workflow);
    expect(text).toContain("cron: '*/10 * * * *'");
    expect(text).toContain("https://guilded.kcaron.top/health");
    expect(text).toMatch(/permissions:\n\s+contents: read/);
  });
});
