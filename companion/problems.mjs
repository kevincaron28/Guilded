// The companion's Problems panel (8.5, track F1). Each check turns what the app already knows
// (engine state, the saved-file check, the update check, whether WoW is open) into one problem
// with a fixed id. The page words each id (companion-app/renderer/problems.js); this file
// decides only WHETHER a problem exists and the few safe values it needs.
//
// Plain ESM with one import, so the desktop app, the interface bundle and the tests share it.
import { syncDiagnosticPreview } from "./sync-status.mjs";

/** Ids in the order the panel lists them: the cause first, its symptoms after. */
export const PROBLEM_IDS = Object.freeze([
  "sign-in-expired",
  "bot-unreachable",
  "addon-missing",
  "addon-wrong-edition",
  "addon-outdated",
  "saved-file-missing",
  "saved-file-not-updated",
  "upload-rejected",
  "wow-running-update",
  "companion-outdated"
]);

// The text describeError() gives for a missing or never-saved file (companion/engine.mjs).
const NOT_SAVED_YET = /Guilded hasn't saved yet/;
const UNREACHABLE = /Could not reach the bot|temporarily unavailable|\((?:502|503|504|52\d|530)\)/i;
const SIGNED_OUT = /\(401\)|refused this companion|Sign in with Discord again|Pair this companion again/i;
// "Upload failed (400): reason" (engine.mjs) or the size limit message, which also never retries.
const REJECTED = /^Upload failed \((\d{3})\):\s*([\s\S]*)$/;
const TOO_LARGE = /^This upload is \d+ KB/;
// After a /reload or logout WoW writes every addon's saved file in the same second. A Guilded.lua
// older than its neighbours by more than this did not save with them.
export const NOT_SAVED_WITH_OTHERS_MS = 5 * 60 * 1000;

const VERSION = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})/;
function versionParts(value) {
  const match = VERSION.exec(String(value ?? ""));
  return match ? match.slice(1, 4).map(Number) : null;
}
/** True when a is a newer version than b (major.minor.patch; anything after is ignored). */
export function newerVersion(a, b) {
  const left = versionParts(a), right = versionParts(b);
  if (!left || !right) return false;
  for (let index = 0; index < 3; index++) if (left[index] !== right[index]) return left[index] > right[index];
  return false;
}
const minorNewer = (a, b) => {
  const left = versionParts(a), right = versionParts(b);
  return !!left && !!right && (left[0] > right[0] || left[0] === right[0] && left[1] > right[1]);
};

const ADDON_PAGE = "https://www.curseforge.com/wow/addons/guilded";
/**
 * Where "Get the addon" goes: the Forever zip of this very release (the addon and the companion
 * share one version, and every GitHub release carries Guilded-v<version>-forever.zip), or the
 * CurseForge page for any other edition or an unreadable version.
 * @param {string | null | undefined} edition @param {string | null | undefined} version
 */
export function addonDownloadUrl(edition, version) {
  const parts = versionParts(version);
  if (edition !== "forever" || !parts) return ADDON_PAGE;
  const tag = parts.join(".");
  return `https://github.com/kevincaron28/Guilded/releases/download/v${tag}/Guilded-v${tag}-forever.zip`;
}

/** True when Windows' task list (tasklist /FO CSV /NH) shows a World of Warcraft game client. */
export function wowRunningFrom(tasklist) {
  for (const line of String(tasklist ?? "").split(/\r?\n/)) {
    const name = /^"([^"]+)"/.exec(line.trim())?.[1] ?? "";
    // Wow.exe, WowClassic.exe, WowClassicT.exe, WowB.exe, WowT.exe... but not WowVoiceProxy.exe,
    // which can outlive the game.
    if (/^wow[a-z0-9]*\.exe$/i.test(name) && !/voiceproxy/i.test(name)) return true;
  }
  return false;
}

const ms = (iso) => (typeof iso === "string" && Number.isFinite(Date.parse(iso)) ? Date.parse(iso) : null);

/**
 * @param {{
 *   config?: Record<string, any>, state?: Record<string, any>,
 *   savedFile?: { changedAt: string | null, stale?: boolean, candidate?: any, othersChangedAt?: string | null,
 *     addon?: { status: string, expected?: string, installed?: string[], version?: string | null } } | null,
 *   update?: { version: string, installer?: unknown } | null,
 *   version?: string, store?: boolean, autoUpdate?: boolean, updateAttempts?: number,
 *   wowRunning?: boolean, online?: boolean
 * }} input
 * @returns {{ id: string, data: Record<string, string | number | boolean | null> }[]}
 */
export function companionProblems(input = {}) {
  const config = input.config ?? {};
  const state = input.state ?? {};
  const savedFile = input.savedFile ?? null;
  const linked = Boolean(config.companionCredential);
  const wow = config.wowEnabled !== false;
  const problems = new Map();
  const add = (id, data = {}) => { if (!problems.has(id)) problems.set(id, data); };

  // Every error the engine holds right now: uploads, standings, and each background connection.
  const errors = [state.uploadError, state.standingsError, ...(state.profiles ?? []).map((profile) => profile?.error)]
    .filter((text) => typeof text === "string" && text.trim());

  if (linked && config.syncEnabled !== false) {
    if (errors.some((text) => SIGNED_OUT.test(text))) add("sign-in-expired");
    else if (input.online === false || errors.some((text) => UNREACHABLE.test(text))) add("bot-unreachable", { offline: input.online === false });
  }

  // Checked against the chosen saved file, or (none chosen yet) the WoW install the app found:
  // a fresh PC with an empty AddOns folder never saves a Guilded.lua to choose.
  if (wow && (config.watchFile || savedFile?.addon)) {
    const addon = savedFile?.addon;
    if (addon?.status === "not-installed") add("addon-missing", { expected: addon.expected ?? null });
    else if (addon?.status === "wrong-edition") add("addon-wrong-edition", { expected: addon.expected ?? null, installed: (addon.installed ?? []).join(", ") || null });
    // Older than this companion: the matching Forever build is one click away (Update addon).
    else if (addon?.status === "ok" && addon.expected === "forever" && addon.version && newerVersion(input.version, addon.version)) {
      add("addon-outdated", { installed: addon.version, current: versionParts(input.version)?.join(".") ?? null });
    }
  }
  const addonBroken = problems.has("addon-missing") || problems.has("addon-wrong-edition");

  if (wow && linked && !config.personal && !config.watchFile && !addonBroken) add("saved-file-missing", { chosen: false });
  else if (wow && config.watchFile && !addonBroken) {
    const missing = (savedFile && savedFile.changedAt === null) || (typeof state.uploadError === "string" && NOT_SAVED_YET.test(state.uploadError));
    const changed = ms(savedFile?.changedAt), others = ms(savedFile?.othersChangedAt);
    if (missing) add("saved-file-missing", { chosen: true, othersSaved: others !== null });
    else if (savedFile?.candidate) add("saved-file-not-updated", { moved: true, days: changed === null ? null : Math.floor((Date.now() - changed) / 86_400_000) });
    else if (changed !== null && others !== null && others - changed > NOT_SAVED_WITH_OTHERS_MS) add("saved-file-not-updated", { moved: false, days: Math.floor((others - changed) / 86_400_000) });
  }

  // A refusal with the bot's reason. Shown on screen only: the report never carries the reason.
  if (!problems.has("sign-in-expired") && !problems.has("bot-unreachable")) {
    const upload = typeof state.uploadError === "string" ? state.uploadError : "";
    const refused = REJECTED.exec(upload);
    if (refused && !["401", "429"].includes(refused[1]) && Number(refused[1]) < 500) add("upload-rejected", { status: Number(refused[1]), reason: refused[2].trim().slice(0, 300) || null });
    else if (TOO_LARGE.test(upload)) add("upload-rejected", { status: 413, reason: upload.slice(0, 300) });
    else if (state.syncPhase === "apply-error") add("upload-rejected", { status: null, reason: null, applyError: true });
  }

  // WoW reads addon files only when it starts: a newer Guilded on disk than the one that last saved
  // means the game is still running the old one.
  const installedVersion = savedFile?.addon?.version ?? null;
  if (wow && input.wowRunning === true && installedVersion && newerVersion(installedVersion, state.addonVersion)) {
    add("wow-running-update", { installed: installedVersion, running: versionParts(state.addonVersion) ? state.addonVersion : null });
  }

  // Outdated: an update the member must act on (automatic updates off, no installer, or failing),
  // or, for the Store build, a bot a whole version ahead while the Store has not updated yet.
  const version = input.version ?? null;
  const update = input.update ?? null;
  if (update && version && newerVersion(update.version, version)) {
    const automatic = input.autoUpdate !== false && !!update.installer && (input.updateAttempts ?? 0) < 2;
    if (!automatic) add("companion-outdated", { latest: update.version, current: version, store: input.store === true });
  } else if (input.store === true && version && minorNewer(state.botVersion, version)) {
    add("companion-outdated", { latest: state.botVersion, current: version, store: true });
  }

  return PROBLEM_IDS.filter((id) => problems.has(id)).map((id) => ({ id, data: problems.get(id) }));
}

// Report allowlist: per id, the keys that may leave the PC and the kind of value each may hold.
// Never the bot's reason, a path, an account or character name.
const EDITION = /^[a-z][a-z-]{1,30}$/;
const SAFE = {
  "bot-unreachable": { offline: "boolean" },
  "addon-missing": { expected: "edition" },
  "addon-wrong-edition": { expected: "edition", installed: "editions" },
  "addon-outdated": { installed: "version", current: "version" },
  "saved-file-missing": { chosen: "boolean", othersSaved: "boolean" },
  "saved-file-not-updated": { moved: "boolean", days: "number" },
  "upload-rejected": { status: "number", applyError: "boolean" },
  "wow-running-update": { installed: "version", running: "version" },
  "companion-outdated": { latest: "version", current: "version", store: "boolean" }
};
function safeValue(kind, value) {
  if (kind === "boolean") return typeof value === "boolean" ? value : undefined;
  if (kind === "number") return Number.isSafeInteger(value) && value >= 0 && value < 100_000 ? value : undefined;
  if (kind === "version") return versionParts(value) && /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(value) ? value : undefined;
  if (kind === "edition") return typeof value === "string" && EDITION.test(value) ? value : undefined;
  if (kind === "editions") return typeof value === "string" && value.split(", ").every((part) => EDITION.test(part)) ? value : undefined;
  return undefined;
}
/** The problems as they may appear in a report: ids and allowlisted values only.
 * @param {{ id: string, data?: Record<string, any> }[]} [problems] */
export function reportableProblems(problems = []) {
  return problems.filter((problem) => PROBLEM_IDS.includes(problem?.id)).map((problem) => {
    const data = {};
    for (const [key, kind] of Object.entries(SAFE[problem.id] ?? {})) {
      const value = safeValue(kind, problem.data?.[key]);
      if (value !== undefined) data[key] = value;
    }
    return { id: problem.id, ...data };
  });
}

// Eight characters without look-alikes (no 0/O, 1/I/L), as the bot's own bug references.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
/** A short reference the member can quote ("C-K3X9QZ2A"). `random` returns numbers in [0, 1). */
export function problemReference(random = Math.random) {
  let text = "";
  for (let index = 0; index < 8; index++) text += ALPHABET[Math.floor(random() * ALPHABET.length) % ALPHABET.length];
  return `C-${text}`;
}

/**
 * Copy report for the developer: the reference, the problem ids with safe values, and the
 * privacy-reviewed sync summary (syncDiagnosticPreview). Plain text for the clipboard.
 */
/**
 * @param {{ problems?: { id: string, data?: Record<string, any> }[], config?: Record<string, any>, state?: Record<string, any>,
 *   evidence?: Record<string, any>, companionVersion?: string | null, reference?: string, now?: Date }} [options]
 */
export function problemReport({ problems = [], config = {}, state = {}, evidence = {}, companionVersion = null, reference = problemReference(), now = new Date() } = {}) {
  const summary = {
    reference,
    createdAt: now.toISOString(),
    problems: reportableProblems(problems),
    sync: syncDiagnosticPreview(config, state, { ...evidence, companionVersion })
  };
  const ids = summary.problems.map((problem) => problem.id).join(", ") || "none";
  return {
    reference,
    summary,
    text: [
      `Guilded Companion report ${reference}`,
      `Problems: ${ids}`,
      "No file paths, account or character names, server messages or credentials are included.",
      "",
      JSON.stringify(summary, null, 2)
    ].join("\n")
  };
}
