import type { LeaderRow } from "./dungeon-stats.js";

export function finalRows(value: unknown): LeaderRow[] | null {
  if (!Array.isArray(value) || value.some(row => !row || typeof row.memberId !== "string" || typeof row.name !== "string" || typeof row.points !== "number" || !Number.isFinite(row.points))) return null;
  return value as LeaderRow[];
}
