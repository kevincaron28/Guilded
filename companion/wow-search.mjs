// "Find it" in Connection & setup (8.5 fresh-PC test: WoW on D:\Jeux was not found, and the button
// showed nothing new). Turns companion-app/detect-wow.cjs's searchWow() answer into one sentence,
// always: what was found, or which drives were searched and what to do next. English keys only.

/**
 * @param {{ entries?: { path: string, exists: boolean }[], installs?: string[], drives?: string[], held?: number }} result
 * @param {{ personal?: boolean }} [options]
 * @returns {{ ok: boolean, path: string | null, text: [string, ...(string | number)[]] }}
 */
export function wowSearchMessage(result = {}, { personal = false } = {}) {
  const entries = Array.isArray(result.entries) ? result.entries : [];
  const installs = Array.isArray(result.installs) ? result.installs : [];
  const drives = Array.isArray(result.drives) && result.drives.length ? result.drives.join(", ") : "C:";
  const first = entries[0];
  if (first) {
    if (entries.length > 1) return { ok: true, path: first.path, text: ["Found {0} accounts. Check the selected file before saving.", entries.length] };
    if (first.exists) return { ok: true, path: first.path, text: ["Found your addon data."] };
    return { ok: true, path: first.path, text: [personal ? "Account found. Use /reload with Guilded Dungeons (or Guilded) enabled to create its saved file." : "Account found. Use /reload with the addon enabled to create Guilded.lua."] };
  }
  if (result.held) return { ok: false, path: null, text: ["Guilded is focused on WoW Forever for now. Your other WoW version is on hold and will come back later; nothing was changed."] };
  // WoW is installed but was never started with this account: no account folder yet.
  if (installs.length) return { ok: false, path: null, text: ["Found World of Warcraft in {0}, but no account folder yet. Start WoW, log in once, then press Find it again.", installs[0]] };
  return { ok: false, path: null, text: ["No World of Warcraft folder found on {0}. Choose WoW folder and pick it yourself.", drives] };
}
