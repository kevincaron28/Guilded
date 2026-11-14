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
export function featuresLua(stamp) {
  const parsed = Date.parse(String(stamp ?? ""));
  const at = Math.floor((Number.isNaN(parsed) ? Date.now() : parsed) / 1000);
  return `GuildedCompanionFeatures = { ["${GROUP_RELAY_FEATURE}"] = true, ["carry-records"] = true, at = ${at} }`;
}
