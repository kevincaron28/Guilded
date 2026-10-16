import type { Guild } from "discord.js";

// Puts every member in the cache, so role.members lists all holders and name matching sees
// everyone. Pages through the REST member list (queued and retried by discord.js) instead of a
// gateway member request, whose strict rate limit failed the honors role sync right after
// startup (opcode 8, October 8 and 9, 2026).
export async function cacheAllMembers(guild: Pick<Guild, "memberCount" | "members">): Promise<void> {
  if (guild.members.cache.size >= guild.memberCount) return;
  let after: string | undefined;
  for (let page = 0; page < 100; page++) {
    const batch = await guild.members.list({ limit: 1000, ...(after ? { after } : {}), cache: true });
    if (batch.size < 1000) return;
    after = batch.lastKey();
  }
}
