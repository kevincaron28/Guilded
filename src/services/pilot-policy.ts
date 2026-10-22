export type PilotOptions = { enabled: boolean; primaryGuildId: string; guildIds: string; limit: number };
// approved: every feature. lite: a server waiting for the owner's decision (a small command set,
// no background jobs). blocked: no access at all (blocked, or waiting with no lite slot left).
export type PilotTier = "approved" | "lite" | "blocked";

export function createPilotPolicy(options: PilotOptions) {
  const ids = [...new Set([options.primaryGuildId, ...options.guildIds.split(/[\s,]+/)].filter(Boolean))];
  if (options.enabled) {
    if (ids.some(id => !/^\d{17,20}$/.test(id))) throw new Error("Pilot approvals must be Discord server IDs (17–20 digits).");
    if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 100 || ids.length > options.limit) throw new Error("Pilot approval list exceeds HOSTED_GUILD_LIMIT (1–100).");
  }
  // Filled from backups/pilot-requests.json by the running bot; never part of the approval file.
  const liteIds: string[] = [];
  const allows = (discordId: string) => !options.enabled || ids.includes(discordId);
  return {
    enabled: options.enabled,
    guildIds: ids,
    liteIds,
    /** Full access. Background jobs, the companion API and guild pages use only this. */
    allows,
    tier: (discordId: string): PilotTier => allows(discordId) ? "approved" : liteIds.includes(discordId) ? "lite" : "blocked"
  };
}

export const PILOT_DENIED = "This server needs the Guilded owner's approval before using the free hosted Guilded bot. / Ce serveur doit être approuvé par le propriétaire de Guilded avant d'utiliser le bot Guilded hébergé gratuit.";
export const PILOT_LITE_DENIED = "This server uses Guilded Lite until the Guilded owner approves it; this feature unlocks then. / Ce serveur utilise Guilded Lite jusqu'à son approbation par le propriétaire de Guilded; cette fonction sera alors disponible.";
