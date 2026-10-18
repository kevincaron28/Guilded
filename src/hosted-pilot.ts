import { config } from "./config.js";
import { createPilotPolicy } from "./services/pilot-policy.js";

export const hostedPilot = createPilotPolicy({ enabled: config.HOSTED_PILOT ?? false,
  primaryGuildId: config.DISCORD_GUILD_ID ?? "", guildIds: config.HOSTED_GUILD_IDS ?? "", limit: config.HOSTED_GUILD_LIMIT ?? 5 });

// Only apply extra predicates in hosted mode; independent installations retain their behavior.
// Approved servers only: lite servers never enter scheduled jobs.
export const pilotGuildScope = hostedPilot.enabled ? { guild: { discordId: { in: hostedPilot.guildIds } } } : {};

// Keep the shared array identity: all scheduled query scopes see approvals immediately.
export function replacePilotApprovals(ids: string[]) {
  hostedPilot.guildIds.splice(0, hostedPilot.guildIds.length, ...ids);
}

export function replacePilotLite(ids: string[]) {
  hostedPilot.liteIds.splice(0, hostedPilot.liteIds.length, ...ids);
}
