// (9.3.1) Runs this PC only heard through its party or raid (the addon marks them `viaGroup`) are carried for the players who
// played them. They are sent only to a bot that says it handles them (feature "group-relay"): an older bot would take them for
// guild runs. The bot's receipt for such a run is "group:<id>", never the plain id (the plain id means a guild holds it).
export const GROUP_RELAY_FEATURE = "group-relay";
export const GROUP_RECEIPT_PREFIX = "group:";

export const isGroupRun = (run) => run?.viaGroup === true;

/**
 * Whether a run is left out of an upload.
 * @param {any} run
 * @param {{ enabled: boolean, acknowledged: Set<string> }} options `enabled`: the bot announced the feature.
 */
export function leaveOut(run, { enabled, acknowledged }) {
  if (!run) return true;
  if (isGroupRun(run)) return !enabled || acknowledged.has(`${GROUP_RECEIPT_PREFIX}${run.id}`);
  return acknowledged.has(run.id);
}

/**
 * (9.3.1) The line that tells the addon this companion carries the runs of players in its group (it reads the addon's carried table and
 * the bot places them on the public boards). An older companion writes no such line, so the addon keeps carried runs to itself.
 */
export function featuresLua(_stamp, now = Date.now()) {
  // (9.3.3) `at` is the time of writing, never the standings stamp (that only moves when the guild's data changes), and `hb = 1` says
  // this companion rewrites the line at least hourly, so the addon may treat a marker a few hours old as a companion that stopped.
  const at = Math.floor(now / 1000);
  return `GuildedCompanionFeatures = { ["${GROUP_RELAY_FEATURE}"] = true, ["carry-records"] = true, hb = 1, at = ${at} }`;
}

const FEATURES_LINE = /^GuildedCompanionFeatures = \{[^\n]*\}$/m;
/** A file's text without the marker's time, so a refreshed marker never counts as a change of the data. */
export const withoutFeatureStamp = (text) => text.replace(FEATURES_LINE, "GuildedCompanionFeatures = {}");

/** The text with a fresh marker, or null when it carries none (a file of another kind is never touched). */
export function withFreshMarker(text, now = Date.now()) {
  return FEATURES_LINE.test(text) ? text.replace(FEATURES_LINE, () => featuresLua(null, now)) : null;
}

export const HEARTBEAT_MS = 50 * 60 * 1000;

/**
 * Rewrites the marker of each file that has one when it is older than the heartbeat, even when nothing else changed (a quiet guild
 * answers 304 for days). Written next to the file and renamed, like the other generated files. Returns the paths rewritten.
 */
export async function refreshMarkers(paths, { now = Date.now(), maxAgeMs = HEARTBEAT_MS } = {}) {
  const { readFile, rename, rm, writeFile } = await import("node:fs/promises");
  const written = [];
  for (const path of paths) {
    try {
      const text = await readFile(path, "utf8");
      const line = text.match(FEATURES_LINE)?.[0];
      if (!line) continue;
      const at = Number(/ at = (\d+) \}$/.exec(line)?.[1]);
      if (Number.isFinite(at) && now - at * 1000 < maxAgeMs) continue;
      const temporary = `${path}.${process.pid}.hb.tmp`;
      try { await writeFile(temporary, withFreshMarker(text, now), "utf8"); await rename(temporary, path); written.push(path); }
      finally { await rm(temporary, { force: true }).catch(() => undefined); }
    } catch { /* a missing or locked file is tried again at the next check */ }
  }
  return written;
}
