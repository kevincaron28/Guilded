import { config } from "./config.js";
import { createPilotPolicy } from "./services/pilot-policy.js";

export const hostedPilot = createPilotPolicy({ enabled: config.HOSTED_PILOT ?? false,
  primaryGuildId: config.DISCORD_GUILD_ID ?? "", guildIds: config.HOSTED_GUILD_IDS ?? "", limit: config.HOSTED_GUILD_LIMIT ?? 5 });

// Only apply extra predicates in hosted mode; independent installations retain their behavior.
export const pilotGuildScope = hostedPilot.enabled ? { guild: { discordId: { in: hostedPilot.guildIds } } } : {};
