// Keep an owner-approved history reset durable when an offline companion
// later resends old SavedVariables. Unset means existing installations behave
// exactly as before. The boundary is a run's start, not its upload time.
export function dungeonResetCutoff(value = process.env["DUNGEON_RUNS_NOT_BEFORE"]): number | null {
  if (!value?.trim()) return null;
  const ms = Date.parse(value);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) || !Number.isFinite(ms)) {
    throw new Error("DUNGEON_RUNS_NOT_BEFORE must be an ISO UTC timestamp");
  }
  return ms / 1000;
}

export function predatesDungeonReset(run: { startedAt?: number | undefined }, cutoff: number | null): boolean {
  return cutoff !== null && (!Number.isFinite(run.startedAt) || run.startedAt! < cutoff);
}
