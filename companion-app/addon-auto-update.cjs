"use strict";
const { decideAutoAddonUpdate } = require("./addon-installer.cjs");

// The automatic addon update (9.3.2), kept apart from main.cjs so its behaviour can be tested: a wanted update is installed at the
// next moment WoW is closed, a failed or partly failed try backs off (10 min, 30 min, 2 h, 6 h) and stops after five tries until the
// member presses Update addon, and the addon reading is updated the moment an install ends so the same version is never installed twice.
const BACKOFF_MS = [10 * 60_000, 30 * 60_000, 2 * 3_600_000, 6 * 3_600_000];
const MAX_ATTEMPTS = 5;
const FAST_LOOK_MS = 4_000, SLOW_LOOK_MS = 20_000;

/**
 * @param {{
 *   companionVersion: () => string, autoUpdate: () => boolean, wowEnabled: () => boolean,
 *   wowBlocked: () => Promise<boolean>,            // true when WoW runs OR the process list could not be read
 *   install: () => Promise<{ version: string, updated?: { name: string }[], failed?: { name: string, message: string }[] }>,
 *   log?: (text: string) => void, onChange?: () => void, onInstalled?: (result: any) => void, now?: () => number
 * }} deps
 */
function createAddonAutoUpdater(deps) {
  const now = deps.now ?? Date.now, log = deps.log ?? (() => {});
  let addon = null, attempts = 0, nextAt = 0, gaveUp = false, busy = false, looking = false, note = "";
  const say = (text) => log(text);
  const change = () => { try { deps.onChange?.(); } catch { /* display only */ } };
  const decide = (wowRunning) => decideAutoAddonUpdate({ addon, companionVersion: deps.companionVersion(), wowRunning, autoUpdate: deps.autoUpdate(), wowEnabled: deps.wowEnabled(), busy });
  const wanted = () => decide(false).action === "install";

  function fail(reason) {
    attempts += 1;
    nextAt = now() + BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)];
    gaveUp = attempts >= MAX_ATTEMPTS;
    say(gaveUp ? `addon update failed (${attempts}): ${reason}; automatic tries stopped, the member can press Update addon` : `addon update failed (${attempts}): ${reason}; next try in ${Math.round((nextAt - now()) / 60_000)} min`);
    change();
  }

  return {
    /** The latest reading of the installed addon (from a file check). */
    setAddon(next) { addon = next ?? null; },
    getAddon() { return addon; },
    /** True while a failed try is waiting to be repeated or automatic tries have stopped (shown as a problem with Update addon). */
    failed() { return attempts > 0; },
    gaveUp() { return gaveUp; },
    state() { return { attempts, nextAt, gaveUp, busy }; },
    /** A manual install or Update addon press: forget the failures. */
    reset() { const had = attempts > 0; attempts = 0; nextAt = 0; gaveUp = false; if (had) change(); },
    /** Milliseconds until the next look: fast only while an update waits for WoW, one long wait during a back-off. */
    nextLookMs() {
      try {
        if (gaveUp || !wanted()) return SLOW_LOOK_MS;
        if (nextAt > now()) return SLOW_LOOK_MS;
        return FAST_LOOK_MS;
      } catch { return SLOW_LOOK_MS; }
    },
    /** One look: installs when it is wanted, WoW is surely closed and no back-off is running. Never throws. */
    async tick() {
      // Single flight (9.3.7): the look is claimed before the first await, so two ticks (start-up, the WoW watcher, the timer)
      // never run side by side; the second one used to see the first one's install as "busy" and logged "not needed: busy".
      if (busy || looking) {
        if (note !== "busy") { note = "busy"; say(`addon update waiting: ${busy ? "an install is running" : "another look is running"}; it looks again soon`); }
        return { action: "none", reason: "busy" };
      }
      looking = true;
      try { return await this.look(); } finally { looking = false; }
    },
    async look() {
      let blocked = true;
      try { blocked = await deps.wowBlocked(); } catch { blocked = true; }
      const decision = decide(blocked);
      if (decision.action === "none") {
        if (attempts > 0 && decision.reason !== "busy") { this.reset(); }
        if (decision.reason === "busy") return decision;
        if (note !== "none") { if (note) say(`addon update not needed: ${decision.reason}`); note = "none"; }
        return decision;
      }
      let reason = decision.reason, action = decision.action;
      if (action === "install" && gaveUp) { action = "wait"; reason = "gave-up"; }
      else if (action === "install" && nextAt > now()) { action = "wait"; reason = "backoff"; }
      const key = `${action}:${reason}`;
      if (key !== note) { note = key; say(`addon update ${action === "wait" ? "waiting" : "starting"}: ${reason}; installed ${addon?.version ?? "none"}, companion ${deps.companionVersion()}`); }
      if (action !== "install") return { action, reason };
      busy = true;
      try {
        say(`addon update attempt ${attempts + 1}: ${addon?.version ?? "none"} -> ${deps.companionVersion()}`);
        const result = await deps.install();
        const names = new Set((result.updated ?? []).map((entry) => entry.name));
        // Move the reading to what is on disk now, at once: a look 4 seconds later must not install the same version again.
        if (addon) addon = { ...addon, status: "ok", version: names.has("Guilded") || !names.size ? result.version : addon.version,
          extras: (Array.isArray(addon.extras) ? addon.extras : []).map((extra) => (names.has(extra?.name) ? { ...extra, version: result.version } : extra)) };
        const failures = result.failed ?? [];
        if (failures.length) fail(failures.map((failure) => `${failure.name}: ${String(failure.message).slice(0, 80)}`).join("; "));
        else { attempts = 0; nextAt = 0; gaveUp = false; note = ""; say(`addon update installed ${result.version}`); change(); }
        deps.onInstalled?.(result);
        return { action: "install", reason: failures.length ? "partly-failed" : "done" };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // WoW started in between: not a failure, the next look tries again.
        if (/Exit World of Warcraft first/.test(message)) { say("addon update waiting: wow started during the install"); return { action: "wait", reason: "wow-running" }; }
        fail(message.slice(0, 160));
        return { action: "install", reason: "failed" };
      } finally {
        busy = false;
        change();
      }
    }
  };
}

module.exports = { createAddonAutoUpdater, BACKOFF_MS, MAX_ATTEMPTS, FAST_LOOK_MS, SLOW_LOOK_MS };
