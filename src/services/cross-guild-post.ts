import type { Client } from "discord.js";
import { prisma } from "../database.js";
import { announceDungeonRuns } from "./import-followup.js";
import { updateDungeonLeaderboard } from "./dungeon-leaderboard.js";
import { withGuildScope } from "./guild-scope.js";
import { shareRuns, type ShareOrigin } from "./cross-guild-runs.js";
import { integrityConfig } from "./run-integrity-config.js";

const cardsToday = new Map<string, { day: string; count: number }>();
/** How many more run cards this guild may be given today for runs that came from other guilds (the run is stored either way). */
export function cardRoom(guildId: string, now = new Date()): number {
  const day = now.toISOString().slice(0, 10);
  const entry = cardsToday.get(guildId);
  return Math.max(0, integrityConfig().crossGuildCardsPerDay - (entry && entry.day === day ? entry.count : 0));
}
function spendCards(guildId: string, count: number, now = new Date()): void {
  const day = now.toISOString().slice(0, 10);
  const entry = cardsToday.get(guildId);
  cardsToday.set(guildId, { day, count: (entry && entry.day === day ? entry.count : 0) + count });
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
        const summaries = item.summaries.slice(0, cardRoom(item.guildId, origin.receivedAt));
        if (!summaries.length) continue;
        spendCards(item.guildId, summaries.length, origin.receivedAt);
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
