import type { Client } from "discord.js";
import { prisma } from "../database.js";
import { announceDungeonRuns } from "./import-followup.js";
import { updateDungeonLeaderboard } from "./dungeon-leaderboard.js";
import { withGuildScope } from "./guild-scope.js";
import { shareRuns } from "./cross-guild-runs.js";

/**
 * (9.3.2) Stores runs a lane has just saved in every other guild with a member in them, then posts each of those guilds' run cards and
 * refreshes its board. Never throws, and is meant to run in the background after the upload has been answered.
 */
export async function shareAndAnnounce(client: Client | null | undefined, originGuildId: string | null, runs: readonly unknown[] | undefined): Promise<void> {
  if (!runs?.length) return;
  try {
    const shared = await shareRuns(prisma, originGuildId, runs);
    for (const item of shared) {
      try {
        const discordGuild = client && item.discordId ? await client.guilds.fetch(item.discordId).catch(() => null) : null;
        await withGuildScope(prisma, item.guildId, async () => {
          if (await announceDungeonRuns(discordGuild, item.summary, item.guildId)) await updateDungeonLeaderboard(discordGuild);
        });
      } catch (error) {
        console.error(`Cross-guild run cards could not be posted: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } catch (error) {
    console.error(`Cross-guild run sharing failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
