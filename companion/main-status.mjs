// The companion's single window, as data (companion redo C1; docs/plans/COMPANION_REDO_2026-11-13.md §3-4).
// Four status lines (game found, addon up to date, last sync, synced as) plus one "needs you" line.
// A line is green ("ok"), amber ("warn") or red ("bad"), or "busy" while something is being set up;
// only a line that is not green says why. It is a view over what the companion already knows: the
// problems list (problems.mjs), the engine state, the saved-file check, the addon decision and the update
// check. No new detection and nothing here touches the sync engine.
//
// Text is an English key plus values, translated by the window (locales/fr.json). Buttons carry an
// action name the window maps to an existing IPC call. Pure ESM, shared by the window bundle and tests.

/** Tone of each line, worst first. */
const RANK = { bad: 3, warn: 2, busy: 1, ok: 0 };

/** "D:\Games\World of Warcraft\_forever_\WTF\Account\X\SavedVariables\Guilded.lua" -> "D:\…\World of Warcraft\_forever_". */
export function shortGamePath(file) {
  if (typeof file !== "string" || !file) return null;
  const parts = file.split(/[\\/]+/).filter(Boolean);
  // Up to the folder that holds WTF: the game folder (World of Warcraft\_forever_).
  const wtf = parts.findIndex((part) => part.toUpperCase() === "WTF");
  const base = wtf > 0 ? parts.slice(0, wtf) : parts.slice(0, -1);
  if (!base.length) return null;
  const tail = base.slice(-2).join("\\");
  const drive = /^[A-Za-z]:$/.test(base[0]) ? `${base[0]}\\` : "";
  return base.length > 2 ? `${drive}…\\${tail}` : `${drive}${base.slice(drive ? 1 : 0).join("\\")}`;
}

const line = (id, tone, text, detail = null, button = null) => ({ id, tone, text, detail, button });
const has = (problems, id) => problems.find((problem) => problem.id === id) ?? null;

function wowLine({ config, problems, savedFile }) {
  const path = shortGamePath(config.watchFile);
  const none = has(problems, "saved-file-missing");
  if (config.wowEnabled === false) return line("wow", "warn", ["World of Warcraft is switched off."], null, { action: "pick-wow-folder", label: "Choose folder" });
  if (!config.watchFile && (none?.data.chosen === false || !savedFile?.addon)) return line("wow", "bad", ["WoW not found"], null, { action: "pick-wow-folder", label: "Choose folder" });
  if (!config.watchFile) return line("wow", "ok", ["Found"], null);
  return line("wow", "ok", ["Found"], path ? ["{0}", path] : null);
}

function addonLine({ problems, savedFile, addonAction = null, wowRunning = false, state = {} }) {
  const addon = savedFile?.addon;
  if (has(problems, "addon-missing")) return line("addon", "bad", ["Not installed"], null, { action: "install-addon", label: "Install" });
  if (has(problems, "addon-wrong-edition")) return line("addon", "bad", ["The wrong version is installed"], null, { action: "install-addon", label: "Update addon" });
  if (has(problems, "addon-outdated")) return line("addon", "warn", ["Update ready"], null, { action: "install-addon", label: "Update addon" });
  // The companion updates the addon by itself, as soon as WoW closes.
  if (addonAction?.action === "update" && wowRunning) return line("addon", "warn", ["Update ready, installs when WoW closes"], null);
  if (has(problems, "wow-running-update")) return line("addon", "warn", ["Updated: restart WoW to use it"], null);
  if (!addon) return line("addon", "busy", ["Checking…"], null);
  if (addon.status === "ok") return line("addon", "ok", ["Up to date"], addon.version ? ["Version {0}", addon.version] : (state.addonVersion ? ["Version {0}", state.addonVersion] : null));
  return line("addon", "busy", ["Checking…"], null);
}

/** The last upload time is a value ({ ago: iso }) the window words ("2 min ago"). */
function syncLine({ config, state, problems }) {
  const offline = has(problems, "bot-unreachable");
  if (offline) return line("sync", "warn", [offline.data.offline ? "This PC is offline" : "Guilded's server is not answering"], ["Your data waits here and is sent as soon as it is back."], { action: "retry", label: "Try again" });
  if (has(problems, "upload-rejected")) return line("sync", "bad", ["Guilded refused the last sync"], null, { action: "problems", label: "See why" });
  if (has(problems, "sign-in-expired")) return line("sync", "warn", ["Waiting for you to sign in again"], null);
  if (has(problems, "saved-file-missing") || has(problems, "saved-file-not-updated")) {
    return line("sync", "warn", ["Waiting: the game has not saved yet"], ["Type /reload in WoW, or log out."]);
  }
  if (state.syncPhase === "uploading") return line("sync", "busy", ["Sending your data…"], null);
  if (!state.running && config.syncEnabled === false) return line("sync", "warn", ["Syncing is paused"], null, { action: "toggle-tracking", label: "Turn on" });
  if (state.device?.status === "no-guild") return line("sync", "warn", ["Waiting for your guild"], ["Your data waits here."]);
  if (state.device?.status === "choose") return line("sync", "warn", ["Waiting for you to choose a server"], null);
  if (state.lastUpload?.at) return line("sync", "ok", [{ ago: state.lastUpload.at }], null);
  return line("sync", "ok", ["Ready. Waiting for your first /reload in WoW."], null);
}

function accountLine({ config, state, problems, me = null }) {
  const linked = Boolean(config.companionCredential);
  const device = !linked && config.device === true && Boolean(config.deviceSecret);
  if (has(problems, "sign-in-expired")) return line("account", "bad", ["Signed out"], null, { action: "sign-in", label: "Sign in with Discord" });
  if (linked) {
    const name = me?.account?.displayName || me?.account?.username || null;
    return line("account", "ok", name ? ["{0} (Discord)", name] : ["Signed in with Discord"], null, { action: "sign-in-switch", label: "Switch account" });
  }
  if (device) return line("account", "ok", ["This PC, not signed in"], state.device?.server ? ["Syncing to {0}.", state.device.server] : null, { action: "sign-in", label: "Sign in with Discord" });
  // Setting itself up (zero-setup, no sign-in needed); failed or switched off: sign in.
  const settingUp = config.wowEnabled !== false && !config.personal && config.zeroSetupOff !== true && state.device?.status !== "unsupported" && !(state.zeroSetupFailures > 0);
  if (settingUp) return line("account", "busy", ["Setting this PC up…"], null);
  return line("account", "warn", ["Not signed in"], null, { action: "sign-in", label: "Sign in with Discord" });
}

/** The one thing that needs the member, most urgent first; null when nothing does. */
function needsYou({ config, state, problems, savedFile, update, otherAccount }) {
  const item = (id, tone, text, detail, buttons) => ({ id, tone, text, detail, buttons });
  const save = has(problems, "settings-not-saved");
  if (save) return item("settings-not-saved", "bad", ["Your settings could not be saved."], ["Restart Windows, then open the companion again."], [{ action: "problems", label: "See how to fix" }]);
  const disk = has(problems, "disk-space-low");
  if (disk) return item("disk-space-low", "bad", ["Not enough disk space: {0} MB free.", disk.data.freeMb], ["Free some space; the companion carries on."], [{ action: "storage", label: "Open Storage settings" }]);
  if (otherAccount?.account) return item("new-wow-account", "warn", ["New WoW account found: is it yours?"], ["{0}", otherAccount.account], [{ action: "account-yes", label: "Yes" }, { action: "account-no", label: "No" }]);
  if (state.device?.status === "choose") return item("choose-server", "warn", ["Choose your guild's Discord server."], ["Several servers set up your guild {0}.", state.device.guild?.name ?? ""], [{ action: "choose-server", label: "Choose server" }]);
  if (state.device?.status === "no-guild" && state.device.guild?.name) {
    return item("guild-not-set-up", "warn", ["Your guild {0} isn't set up on Discord yet.", state.device.guild.name], ["Ask an officer to run /setup on your guild's Discord."], [{ action: "copy-officer-message", label: "Copy a message for your officer" }]);
  }
  if (savedFile?.candidate && !has(problems, "saved-file-missing")) return item("folder-moved", "warn", ["Your addon data seems to be in another WoW folder now."], ["Nothing is deleted."], [{ action: "switch-folder", label: "Use the new folder" }]);
  const outdated = has(problems, "companion-outdated");
  if (outdated || (update && config.autoUpdate === false)) {
    return item("companion-update", "warn", ["A new version is out."], ["Version {0}", outdated?.data.latest ?? update?.version ?? ""], [{ action: outdated?.data.store ? "open-store" : "install-update", label: "Update" }]);
  }
  return null;
}

/**
 * @param {{
 *   config?: Record<string, any>, state?: Record<string, any>, problems?: { id: string, data?: Record<string, any> }[],
 *   savedFile?: Record<string, any> | null, addonAction?: { action?: string } | null, wowRunning?: boolean,
 *   update?: { version?: string } | null, otherAccount?: { account?: string } | null,
 *   me?: { account?: { displayName?: string | null, username?: string } } | null
 * }} [input]
 */
export function mainStatus(input = {}) {
  const config = input.config ?? {};
  const state = input.state ?? {};
  const problems = (input.problems ?? []).map((problem) => ({ id: problem.id, data: problem.data ?? {} }));
  const shared = { config, state, problems, savedFile: input.savedFile ?? null, addonAction: input.addonAction ?? null, wowRunning: input.wowRunning === true, me: input.me ?? null };
  const lines = [wowLine(shared), addonLine(shared), syncLine(shared), accountLine(shared)];
  const needs = needsYou({ ...shared, update: input.update ?? null, otherAccount: input.otherAccount ?? null });
  const worst = [...lines.map((entry) => entry.tone), needs?.tone ?? "ok"].reduce((a, b) => (RANK[b] > RANK[a] ? b : a), "ok");
  const linked = Boolean(config.companionCredential);
  const device = !linked && config.device === true && Boolean(config.deviceSecret);
  return {
    lines,
    needsYou: needs,
    // The window opens by itself when something needs the member (redo plan §5, decision 3).
    openWindow: Boolean(needs) || lines.some((entry) => entry.tone === "bad"),
    tone: worst,
    syncNow: { enabled: (linked || device) && Boolean(config.watchFile) && state.syncPhase !== "uploading", busy: state.syncPhase === "uploading" }
  };
}
