import type { Client } from "discord.js";
import { prisma } from "../database.js";
import { announceDungeonRuns } from "./import-followup.js";
import { updateDungeonLeaderboard } from "./dungeon-leaderboard.js";
import { withGuildScope } from "./guild-scope.js";
import { inboxToken, shareRuns, type ShareOrigin } from "./cross-guild-runs.js";
import { integrityConfig } from "./run-integrity-config.js";

/**
 * How many of `count` new cards this guild may still be given today for copies of other guilds' runs: counted from the copies it has
 * stored today (so a restart does not reset it), the ones just stored included.
 */
async function cardRoom(guildId: string, count: number, now: Date): Promise<number> {
  const inbox = await prisma.companionDevice.findUnique({ where: { tokenHash: inboxToken(guildId) }, select: { id: true } });
  if (!inbox) return 0;
  const storedToday = await prisma.dungeonRunWitness.count({ where: { guildId, deviceId: inbox.id, status: "stored", decidedAt: { gte: new Date(now.getTime() - 86_400_000) } } });
  return Math.max(0, Math.min(count, integrityConfig().crossGuildCardsPerDay - Math.max(0, storedToday - count)));
}

/**
 * (9.3.2) Offers runs a lane has just saved to every other guild with a member in them, then posts each of those guilds' run cards
 * (under that guild's own dungeon channel and highlight settings) and refreshes its board. Never throws; run in the background.
 */
export async function shareAndAnnounce(client: Client | null | undefined, origin: ShareOrigin, runs: readonly unknown[] | undefined): Promise<void> {
  if (!runs?.length) return;
  try {
    const shared = await shareRuns(prisma, origin, runs, { eligible: (discordId) => !client || client.guilds.cache.has(discordId) });
    for (const item of shared) {
      try {
        const discordGuild = client ? await client.guilds.fetch(item.discordId).catch(() => null) : null;
        // No Discord server, or past the day's allowance: the run is stored without a card.
        if (!discordGuild) continue;
        const summaries = item.summaries.slice(0, await cardRoom(item.guildId, item.summaries.length, origin.receivedAt));
        if (!summaries.length) continue;
        await withGuildScope(prisma, item.guildId, async () => {
          let posted = false;
          for (const summary of summaries) posted = await announceDungeonRuns(discordGuild, summary, item.guildId) || posted;
          if (posted) await updateDungeonLeaderboard(discordGuild);
        });
      } catch (error) {
        console.error(`Cross-guild run cards could not be posted: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } catch (error) {
    console.error(`Cross-guild run sharing failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
