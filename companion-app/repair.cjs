"use strict";
// Repair (8.5, owner batch 3 #3): one button that re-checks what a member's setup depends on and
// fixes what it can, then says what it did. Each step is ok, fixed, needs-you (with what to do) or
// failed. Every side effect comes in through `deps`, so the whole run is tested without Electron.
// Text is an English key with {0} slots; the window translates it.

const STEPS = ["disk", "folder", "addon", "signin", "link", "sync"];

/**
 * @param {{
 *   wowEnabled: boolean,
 *   watchFile: () => string | null,
 *   watchedFileExists: () => Promise<boolean>,
 *   searchWow: () => { entries: { path: string, exists: boolean }[], installs: string[] },
 *   pick: (entries: any[]) => any,
 *   setWatchFile: (path: string) => Promise<void>,
 *   addonDecision: () => Promise<{ action: string, reason: string, blocked?: string }>,
 *   installAddon: () => Promise<{ version: string, backup: string | null }>,
 *   diskSpace?: () => { ok: boolean, freeMb: number | null, neededMb: number },
 *   signedIn: () => boolean,
 *   me: () => Promise<any>,
 *   syncConfigured: () => boolean,
 *   syncRunning: () => boolean,
 *   restartSync: () => Promise<void>
 * }} deps
 */
async function runRepair(deps) {
  const results = [];
  const add = (id, status, ...text) => results.push({ id, status, text });

  // 0. Free disk space: an update or addon install needs about 600 MB (disk-space.cjs). Too little
  // and the addon step below is not tried, so nothing stops halfway.
  let diskLow = false;
  if (deps.diskSpace) {
    let disk = null;
    try { disk = deps.diskSpace(); } catch { disk = null; }
    if (disk && disk.ok === false) {
      diskLow = true;
      add("disk", "needs-you", "Not enough disk space: {0} MB free, about {1} MB needed. Free space with Windows Settings > Storage, then retry.", disk.freeMb, disk.neededMb);
    } else if (disk) add("disk", "ok", "There is enough free disk space.");
  }

  // 1. The WoW folder: the watched Guilded.lua's account folder still exists, or find it again.
  if (!deps.wowEnabled) add("folder", "ok", "World of Warcraft is off in this companion.");
  else {
    const current = deps.watchFile();
    let fine = false;
    if (current) { try { fine = await deps.watchedFileExists(); } catch { fine = false; } }
    if (fine) add("folder", "ok", "Your WoW folder is chosen and still there.");
    else {
      const found = deps.searchWow();
      const choice = deps.pick(found.entries);
      if (choice && (!current || choice.path.toLowerCase() !== current.toLowerCase())) {
        await deps.setWatchFile(choice.path);
        const parts = choice.path.split(/[\\/]/);
        add("folder", "fixed", "Found your WoW account folder again: {0}", `${parts.at(-6) ?? ""} > ${parts.at(-3) ?? ""}`);
      } else if (choice) add("folder", "ok", "Your WoW folder is chosen; WoW has not saved Guilded data there yet.");
      else if (found.entries.length > 1) add("folder", "needs-you", "Several WoW accounts were found. Choose WoW folder and pick yours.");
      else if (found.installs.length) add("folder", "needs-you", "Found World of Warcraft, but no account folder yet. Start WoW, log in once, then press Repair again.");
      else add("folder", "needs-you", "No World of Warcraft folder was found. Choose WoW folder and pick it yourself.");
    }
  }

  // 2. The addon: missing, the wrong build or older than this companion: install the matching one.
  if (deps.wowEnabled) {
    let decision = null;
    try { decision = await deps.addonDecision(); } catch { decision = null; }
    if (!decision || decision.action === "none") {
      add("addon", "ok", decision?.reason === "up-to-date" ? "The Guilded addon is installed and up to date." : "Nothing to change in the addon.");
    } else if (diskLow) {
      add("addon", "needs-you", "The Guilded addon needs to be installed or updated. Free some disk space first, then press Repair again.");
    } else if (decision.blocked === "wow-running") {
      add("addon", "needs-you", "The Guilded addon needs an update. Exit World of Warcraft, then press Repair again.");
    } else {
      try {
        const installed = await deps.installAddon();
        add("addon", "fixed", decision.action === "install" ? "Installed the Guilded addon {0}." : "Updated the Guilded addon to {0}.", installed.version);
      } catch (error) {
        add("addon", "failed", "The Guilded addon could not be installed: {0}", error instanceof Error ? error.message : String(error));
      }
    }
  }

  // 3. Sign-in, and 4. the link to the guild's server (companion-me answers both).
  if (!deps.signedIn()) {
    add("signin", "needs-you", "Not signed in. Press Sign in with Discord.");
  } else {
    let me = null;
    try { me = await deps.me(); } catch { me = null; }
    if (me?.ok) {
      add("signin", "ok", "Signed in to Discord as {0}.", me.account?.displayName || me.account?.username || "?");
      if (me.personal) add("link", "needs-you", me.join?.serverName ? "Signed in for public dungeon rankings only. Join {0} on Discord, then press Link to my guild." : "Signed in for public dungeon rankings only. Join your guild's Discord, then press Link to my guild.", me.join?.serverName || "");
      else add("link", "ok", "Linked to your guild's Discord server.");
    } else if (me?.unreachable) {
      add("signin", "failed", "Guilded's server did not answer. Your sign-in is kept; press Repair again in a minute.");
    } else if (me?.unsupported) {
      add("signin", "ok", "Signed in (this Guilded server is older and cannot show more).");
    } else {
      add("signin", "needs-you", "Your Discord sign-in is no longer valid. Press Sign in with Discord again.");
    }
  }

  // 5. Sync: configured but stopped (after an error or a pause): start it again.
  if (deps.syncConfigured()) {
    if (deps.syncRunning()) add("sync", "ok", "Sync is running.");
    else {
      try { await deps.restartSync(); add("sync", deps.syncRunning() ? "fixed" : "failed", deps.syncRunning() ? "Restarted the sync." : "The sync did not start. Open Problems to see why."); }
      catch { add("sync", "failed", "The sync did not start. Open Problems to see why."); }
    }
  }
  return results;
}

/** One line for the log and the toast: "Repair: 2 fixed, 1 needs you." */
function repairSummary(results = []) {
  const count = (status) => results.filter((item) => item.status === status).length;
  return { fixed: count("fixed"), needsYou: count("needs-you"), failed: count("failed"), ok: count("ok") };
}

module.exports = { runRepair, repairSummary, STEPS };
