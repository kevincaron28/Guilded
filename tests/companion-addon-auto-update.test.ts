import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";

// The automatic addon update controller (companion-app/addon-auto-update.cjs): behaviour with a fake clock and fake installs.
const { createAddonAutoUpdater, BACKOFF_MS, MAX_ATTEMPTS, FAST_LOOK_MS, SLOW_LOOK_MS } = createRequire(import.meta.url)("../companion-app/addon-auto-update.cjs");

const old = { folder: "x", expected: "forever", status: "ok", version: "9.3.0", extras: [{ name: "GuildedDungeons", version: "9.3.0" }] };

function make(options: { blocked?: () => Promise<boolean>; install?: () => Promise<unknown> } = {}) {
  let time = 1_000_000;
  const logs: string[] = [];
  const install = vi.fn(options.install ?? (async () => ({ version: "9.3.1", updated: [{ name: "Guilded" }, { name: "GuildedDungeons" }], failed: [] })));
  const updater = createAddonAutoUpdater({
    companionVersion: () => "9.3.1", autoUpdate: () => true, wowEnabled: () => true,
    wowBlocked: options.blocked ?? (async () => false), install, log: (text: string) => logs.push(text), now: () => time
  });
  updater.setAddon(old);
  return { updater, install, logs, advance: (ms: number) => { time += ms; } };
}

describe("a wanted addon update", () => {
  it("installs at the first look with WoW closed, and never installs the same version twice", async () => {
    const { updater, install } = make();
    await updater.tick();
    await updater.tick();
    await updater.tick();
    expect(install).toHaveBeenCalledTimes(1);
    expect(updater.getAddon()).toMatchObject({ version: "9.3.1", extras: [{ name: "GuildedDungeons", version: "9.3.1" }] });
    expect(updater.failed()).toBe(false);
  });

  it("waits while WoW runs, and a failed or timed-out process list counts as running", async () => {
    let blocked = true;
    const { updater, install } = make({ blocked: async () => blocked });
    await updater.tick();
    expect(install).not.toHaveBeenCalled();
    expect(updater.nextLookMs()).toBe(FAST_LOOK_MS); // looks quickly while it waits for WoW to close
    const unknown = make({ blocked: async () => { throw new Error("tasklist timed out"); } });
    await unknown.updater.tick();
    expect(unknown.install).not.toHaveBeenCalled();
    blocked = false;
    await updater.tick();
    expect(install).toHaveBeenCalledTimes(1);
  });

  it("treats a partly failed install as a failure with back-off, not as a loop", async () => {
    // Guilded installs, GuildedDungeons does not (installAddon returns failed[] without throwing).
    const { updater, install, advance } = make({ install: async () => ({ version: "9.3.1", updated: [{ name: "Guilded" }], failed: [{ name: "GuildedDungeons", message: "locked" }] }) });
    await updater.tick();
    expect(install).toHaveBeenCalledTimes(1);
    expect(updater.failed()).toBe(true);
    expect(updater.getAddon()).toMatchObject({ version: "9.3.1" }); // Guilded itself is not reinstalled
    for (let i = 0; i < 20; i++) { advance(4_000); await updater.tick(); }
    expect(install).toHaveBeenCalledTimes(1); // nothing during the back-off, however often it looks
    expect(updater.nextLookMs()).toBe(SLOW_LOOK_MS); // and no 4 second polling
    advance(BACKOFF_MS[0]);
    await updater.tick();
    expect(install).toHaveBeenCalledTimes(2);
  });

  it("backs off after a thrown failure, and stops after the attempt cap until reset", async () => {
    const { updater, install, advance, logs } = make({ install: async () => { throw new Error("download failed"); } });
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      await updater.tick();
      expect(install).toHaveBeenCalledTimes(attempt);
      advance(BACKOFF_MS[BACKOFF_MS.length - 1]! + 1);
    }
    expect(updater.gaveUp()).toBe(true);
    await updater.tick();
    await updater.tick();
    expect(install).toHaveBeenCalledTimes(MAX_ATTEMPTS); // given up: no more automatic tries
    expect(logs.some(line => /automatic tries stopped/.test(line))).toBe(true);
    expect(updater.failed()).toBe(true); // still shown to the member, with the Update addon button
    updater.reset(); // the member presses the button
    expect(updater.failed()).toBe(false);
    await updater.tick();
    expect(install).toHaveBeenCalledTimes(MAX_ATTEMPTS + 1);
  });

  it("uses a longer wait after each failure", async () => {
    const { updater, advance } = make({ install: async () => { throw new Error("no"); } });
    await updater.tick();
    expect(updater.state().nextAt - 1_000_000).toBe(BACKOFF_MS[0]);
    advance(BACKOFF_MS[0]!);
    await updater.tick();
    expect(updater.state().nextAt - (1_000_000 + BACKOFF_MS[0]!)).toBe(BACKOFF_MS[1]);
  });

  it("does not count WoW starting during the install as a failure", async () => {
    const { updater, install } = make({ install: async () => { throw new Error("Exit World of Warcraft first."); } });
    await updater.tick();
    expect(updater.failed()).toBe(false);
    await updater.tick();
    expect(install).toHaveBeenCalledTimes(2);
  });

  it("does nothing, and forgets old failures, once the addon is current (for example after a manual install)", async () => {
    const { updater, install } = make({ install: async () => { throw new Error("no"); } });
    await updater.tick();
    expect(updater.failed()).toBe(true);
    updater.setAddon({ ...old, version: "9.3.1", extras: [{ name: "GuildedDungeons", version: "9.3.1" }] });
    await updater.tick();
    expect(updater.failed()).toBe(false);
    expect(install).toHaveBeenCalledTimes(1);
  });

  it("writes every state change and attempt to the log", async () => {
    const { updater, logs } = make({ blocked: async () => true });
    await updater.tick();
    expect(logs.join("\n")).toMatch(/addon update waiting: wow-running; installed 9\.3\.0, companion 9\.3\.1/);
    const second = make();
    await second.updater.tick();
    expect(second.logs.join("\n")).toMatch(/attempt 1: 9\.3\.0 -> 9\.3\.1[\s\S]*installed 9\.3\.1/);
  });
});
