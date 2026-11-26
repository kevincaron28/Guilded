import type { Client } from "discord.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { pilotGuildScope } from "../hosted-pilot.js";
import { asLang, tx } from "../i18n.js";
import { createLootService } from "./loot.js";
import { coreForRaid } from "./core-rules.js";
import { notifications, notify } from "./notify.js";
import { guildScopeOf, runInGuildScope } from "./guild-scope.js";

// An auction closes by itself when its time is up: the highest eligible bid wins, as with /lead loot close.
// Only auctions that ran out in the last few minutes: older ones left open (before this existed, or while the
// bot was down for long) are never awarded by surprise; officers close them by hand.
export const AUTO_CLOSE_WINDOW_MS = 15 * 60_000;

export async function runAuctionAutoClose(client: Client, database: PrismaClient, now = new Date()): Promise<number> {
  const due = await database.auction.findMany({
    where: { ...pilotGuildScope, status: "ACTIVE", closesAt: { lte: now, gte: new Date(now.getTime() - AUTO_CLOSE_WINDOW_MS) } },
    include: { guild: { include: { settings: true, wowSpace: true } } },
    orderBy: { closesAt: "asc" },
    take: 50
  });
  const loot = createLootService(database);
  let closed = 0;
  for (const auction of due) {
    try {
      const result = await loot.closeAuction(auction.id, auction.createdBy);
      closed += 1;
      const lang = asLang(auction.guild.settings?.language);
      const discordGuild = await client.guilds.fetch(auction.guild.discordId);
      const text = result.award
        ? tx(lang, "Auction closed. **{item}** awarded to {user} for **{amount} GP**.", { item: result.award.itemName, user: `<@${result.award.member.discordUserId}>`, amount: result.award.amount })
        : tx(lang, "Auction **{item}** closed with no bids.", { item: auction.itemName });
      const channel = auction.channelId ? await discordGuild.channels.fetch(auction.channelId).catch(() => null) : null;
      if (channel?.isTextBased()) await channel.send({ content: text, allowedMentions: { parse: [] } }).catch(() => undefined);
      if (result.award) {
        const core = await coreForRaid(database, auction.guildId, result.auction.raidId);
        const award = result.award;
        const announce = () => notify(discordGuild, notifications.lootAwarded(award.itemName, award.member.displayName, award.amount), "loot", core?.id ?? null);
        // The announcement looks the guild up from the Discord server: keep it on this auction's in-game guild.
        const scope = guildScopeOf(auction.guild);
        await (scope ? runInGuildScope(scope, announce) : announce());
      }
    } catch (error) {
      // Closed by an officer at the same moment, or the core's points pool is unavailable: leave it.
      console.error(`Auto-close failed for auction ${auction.id}`, error instanceof Error ? error.message : error);
    }
  }
  return closed;
}
