/** Canonical run role. Native WoW and old snapshots use DAMAGER for DPS. */
export function dungeonRole(value) {
  if (typeof value !== "string") return null;
  const role = value.trim().toUpperCase();
  if (role === "DAMAGER" || role === "DPS") return "DPS";
  return role === "TANK" || role === "HEALER" ? role : null;
}

// Protocol 2 score panels shipped with a DAMAGER selector. Keep that wire alias
// until those clients retire; comparisons and stored run roles use dungeonRole.
export function snapshotDungeonRole(value) {
  const role = dungeonRole(value);
  return role === "DPS" ? "DAMAGER" : role;
}
