// A registry kept apart from the leaderboard pages so that any service can drop the pages' caches without importing them (no import cycle).
const clearers = new Set<() => void>();

/** Called by each leaderboard page set: its function that empties its caches. */
export function registerLeaderboardCache(clear: () => void): void { clearers.add(clear); }

/** Drops every leaderboard cache at once: call it when a guild turns its public pages on or off, changes its address, or a member hides or shows a profile. */
export function clearLeaderboardCaches(): void { for (const clear of clearers) clear(); }
