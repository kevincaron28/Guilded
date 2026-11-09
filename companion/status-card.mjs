// The Sync status card on Home (companion redesign, PR 1; docs/plans/COMPANION_REDESIGN.md §3).
// One state at a time, most urgent first, each with one plain sentence and at most one button.
// It is a view over what the companion already knows: the Problems list (companion/problems.mjs),
// the setup (signed in, WoW folder) and the sync state from the engine. No new detection.
//
// Text is an English key plus values; the window translates it. Pure ESM, so the window bundle and
// the tests share it.

/** The order states are picked in. The first that applies is shown. */
export const STATUS_ORDER = Object.freeze([
  "settings-not-saved", "disk-space-low", "not-signed-in", "sign-in-expired", "no-wow-folder",
  "addon-missing", "addon-wrong-edition", "addon-outdated", "folder-moved", "never-saved",
  "bot-unreachable", "upload-rejected", "paused", "syncing", "guild-not-set-up", "choose-server", "synced", "waiting-first-save"
]);

/**
 * @param {{
 *   problems?: { id: string, data?: Record<string, any> }[],
 *   config?: { companionCredential?: string, wowEnabled?: boolean, watchFile?: string, personal?: boolean, syncEnabled?: boolean, device?: boolean, deviceSecret?: string },
 *   state?: { running?: boolean, syncPhase?: string, lastUpload?: { at?: string } | null, device?: { status?: string, server?: string, guild?: { name?: string } | null } | null },
 *   now?: number
 * }} input
 * @returns {{ id: string, tone: "ok" | "busy" | "warn" | "bad", title: [string, ...any[]], detail: [string, ...any[]] | null,
 *   button: { action: string, label: string } | null }}
 */
export function statusCard({ problems = [], config = {}, state = {} } = {}) {
  const has = new Map(problems.map((problem) => [problem.id, problem.data || {}]));
  const linked = Boolean(config.companionCredential);
  // Zero-setup companion (docs/ZERO_SETUP_COMPANION.md): syncing with the device key, no sign-in yet.
  const device = !linked && config.device === true && Boolean(config.deviceSecret);
  const wow = config.wowEnabled !== false;
  const card = (id, tone, title, detail = null, button = null) => ({ id, tone, title, detail, button });

  if (has.has("settings-not-saved")) return card("settings-not-saved", "bad", ["Your settings could not be saved."], ["Restart Windows, then open the companion again. Until then, what you change is kept only while it stays open."], { action: "problems", label: "See how to fix" });
  if (has.has("disk-space-low")) {
    const d = has.get("disk-space-low");
    return card("disk-space-low", "bad", ["Not enough disk space: {0} MB free.", d.freeMb], ["Updates and the addon install need about {0} MB. Free some space, then the companion carries on.", d.neededMb ?? 600], { action: "storage", label: "Open Storage settings" });
  }
  if (!linked && (!device || state.device?.status === "claimed")) return card("not-signed-in", "warn", ["Sign in with Discord to start syncing."], ["It takes a minute: your browser opens, you pick your guild's server, and that's it."], { action: "sign-in", label: "Sign in with Discord" });
  if (has.has("sign-in-expired")) return card("sign-in-expired", "bad", ["Your Discord sign-in expired."], ["Sign in again; nothing is lost."], { action: "sign-in", label: "Sign in with Discord" });
  if (wow && !config.personal && has.has("saved-file-missing") && has.get("saved-file-missing").chosen === false) {
    return card("no-wow-folder", "warn", ["We have not found your World of Warcraft folder yet."], ["Find WoW looks on every drive and picks your account."], { action: "find-wow", label: "Find WoW" });
  }
  if (has.has("addon-missing")) return card("addon-missing", "warn", ["The Guilded addon is not installed."], ["Close WoW, then install it here: it takes a few seconds."], { action: "install-addon", label: "Install addon" });
  if (has.has("addon-wrong-edition")) return card("addon-wrong-edition", "warn", ["This WoW folder has the wrong Guilded addon."], ["Close WoW, then update it here: your old folder is kept as a backup."], { action: "install-addon", label: "Update addon" });
  if (has.has("addon-outdated")) return card("addon-outdated", "warn", ["Your Guilded addon is older than this companion."], ["Close WoW, then update it here: your old folder is kept as a backup."], { action: "install-addon", label: "Update addon" });
  if (has.has("saved-file-not-updated") && has.get("saved-file-not-updated").moved) return card("folder-moved", "warn", ["Your addon data seems to be in another WoW folder now."], ["Use the new folder: nothing is deleted, and you can switch back in Settings."], { action: "switch-folder", label: "Use the new folder" });
  if (has.has("saved-file-missing") || has.has("saved-file-not-updated")) return card("never-saved", "warn", ["Waiting for WoW to save your addon data."], ["Start WoW, log in and type /reload once (or log out). The companion syncs by itself after that."], null);
  if (has.has("bot-unreachable")) {
    const offline = has.get("bot-unreachable").offline === true;
    return card("bot-unreachable", "warn", [offline ? "This PC is offline." : "Guilded's server is not answering."], ["Your addon data waits here and is sent as soon as it is back."], { action: "retry", label: "Try again" });
  }
  if (has.has("upload-rejected")) return card("upload-rejected", "bad", ["Guilded refused your last sync."], ["See why, and what to do, in Problems."], { action: "problems", label: "See why" });
  if (!state.running && config.syncEnabled === false) return card("paused", "warn", ["Syncing is paused."], ["Turn it back on in Settings when you are ready."], { action: "settings", label: "Open Settings" });
  if (state.syncPhase === "uploading") return card("syncing", "busy", ["Sending your latest data…"], null, null);
  if (device && state.device?.status === "no-guild") {
    const guild = state.device.guild?.name;
    return guild
      ? card("guild-not-set-up", "warn", ["Your guild {0} isn't set up on Discord yet.", guild], ["Your data waits here. Ask an officer to run /setup on your guild's Discord: the companion syncs by itself after that."], { action: "sign-in", label: "Sign in with Discord" })
      : card("guild-not-set-up", "warn", ["Waiting for your character's guild."], ["Log in to WoW with the Guilded addon enabled, then type /reload once."], null);
  }
  if (device && state.device?.status === "choose") return card("choose-server", "warn", ["Choose your guild's Discord server."], ["Several Discord servers set up your guild {0}. Pick yours once.", state.device.guild?.name ?? ""], { action: "choose-server", label: "Choose server" });
  if (device && state.device?.status === "synced") return card("synced", "ok", ["Syncing to {0} (from your guild {1}).", state.device.server ?? "", state.device.guild?.name ?? ""], ["Your characters show as reported. Sign in with Discord to confirm them (optional)."], { action: "sign-in", label: "Sign in with Discord to confirm your characters" });
  if (state.lastUpload?.at) return card("synced", "ok", ["Synced {0}.", { ago: state.lastUpload.at }], ["After you play, /reload or log out: the companion syncs by itself."], { action: "sync-now", label: "Sync now" });
  return card("waiting-first-save", "ok", ["Ready. Waiting for your first /reload in WoW."], ["Log in to WoW and type /reload (or log out): the companion syncs by itself."], { action: "sync-now", label: "Sync now" });
}

/**
 * The quiet line under the card (owner, 7 November): the guild's name and the last /reload only.
 * @param {{ config?: { wowGuildName?: string, wowGuild?: string }, savedFile?: { changedAt?: string | null } | null }} [input]
 * @returns {{ guild: string | null, lastReload: string | null }}
 */
export function guildLine({ config = {}, savedFile = null } = {}) {
  const guild = config.wowGuildName || config.wowGuild || null;
  const lastReload = savedFile?.changedAt || null;
  return { guild, lastReload };
}
