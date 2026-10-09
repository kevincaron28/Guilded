export type PilotOptions = { enabled: boolean; primaryGuildId: string; guildIds: string; limit: number };

export function createPilotPolicy(options: PilotOptions) {
  const ids = [...new Set([options.primaryGuildId, ...options.guildIds.split(/[\s,]+/)].filter(Boolean))];
  if (options.enabled) {
    if (ids.some(id => !/^\d{17,20}$/.test(id))) throw new Error("Pilot approvals must be Discord server IDs (17–20 digits).");
    if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 100 || ids.length > options.limit) throw new Error("Pilot approval list exceeds HOSTED_GUILD_LIMIT (1–100).");
  }
  return {
    enabled: options.enabled,
    guildIds: ids,
    allows: (discordId: string) => !options.enabled || ids.includes(discordId)
  };
}

export const PILOT_DENIED = "This server needs the Guilded owner's approval before using the hosted pilot. / Ce serveur doit être approuvé par le propriétaire de Guilded avant de participer au pilote hébergé.";
