// Temporary 8.5.0 preview switch (owner decision, 6 November 2026).
//
// While FEATURE_PREVIEW_GUILD_IDS is set (comma- or space-separated Discord server IDs), the new automatic 8.5 features
// (race-to-60 board and Hall of Fame, PvP channels and ladders, a new duel board, nickname sync, the Who's who board, the
// weekly promotion list and the first-link DM) act only in those servers, so they can be tested on the owner's test
// server without touching Québec Gold or any other guild. Unset the variable at release and everything follows the
// on-by-default decision. Commands an officer runs by hand are not gated.
export function previewAllows(discordGuildId: string | null | undefined, list = process.env["FEATURE_PREVIEW_GUILD_IDS"]): boolean {
  const raw = list?.trim();
  if (!raw) return true;
  return Boolean(discordGuildId) && raw.split(/[\s,]+/).includes(String(discordGuildId));
}
