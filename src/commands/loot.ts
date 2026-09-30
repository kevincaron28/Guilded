import { coreContext } from "../services/core-context.js";
import { SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { createLootService } from "../services/loot.js";
import { notifications, notify } from "../services/notify.js";
import { createWishlistService } from "../services/wishlist.js";
import { describeReserves } from "../services/reserves.js";
import { prisma } from "../database.js";
import { hasPermission } from "../permissions.js";
import { coreForRaid, effectiveRules, LOOT_MODE_LABEL } from "../services/core-rules.js";
import { createItemValueService } from "../services/item-values.js";
import { describePriority, priorityFor } from "../services/loot-priority.js";
import { guildService, requireGuildContext } from "./context.js";

const lootService = createLootService(prisma);
const wishlistService = createWishlistService(prisma);
const itemValues = createItemValueService(prisma);

export const lootCommand = new SlashCommandBuilder()
  .setName("loot").setDescription("Auction and track raid loot.")
  .addSubcommand((sub) => sub.setName("auction").setDescription("Start a loot auction.")
    .addStringOption((o) => o.setName("item").setDescription("Item name").setRequired(true))
    .addIntegerOption((o) => o.setName("minimum").setDescription("Minimum bid (default: your guild's setting)").setMinValue(1))
    .addIntegerOption((o) => o.setName("increment").setDescription("Bid increment (default: your guild's setting)").setMinValue(1))
    .addIntegerOption((o) => o.setName("duration").setDescription("How long, in seconds (pick one, or type)").setMinValue(1).setMaxValue(86400).setAutocomplete(true))
    .addStringOption((o) => o.setName("boss").setDescription("Boss that dropped it (for loot history)"))
    .addStringOption((o) => o.setName("raid").setDescription("Raid for loot history (start typing its name)").setAutocomplete(true)))
  .addSubcommand((sub) => sub.setName("award").setDescription("Give an item straight to a player (loot council or a manual award). Officers.")
    .addStringOption((o) => o.setName("item").setDescription("Item name").setRequired(true))
    .addUserOption((o) => o.setName("player").setDescription("Who gets it").setRequired(true))
    .addIntegerOption((o) => o.setName("gp").setDescription("GP to charge (default 0)").setMinValue(0))
    .addBooleanOption((o) => o.setName("offspec").setDescription("Off-spec win: charge the core's off-spec share of the price (default 50%)"))
    .addStringOption((o) => o.setName("boss").setDescription("Boss that dropped it (for loot history)"))
    .addStringOption((o) => o.setName("raid").setDescription("Raid for loot history (start typing its name)").setAutocomplete(true)))
  .addSubcommand((sub) => sub.setName("bid").setDescription("Bid on an active auction.")
    .addStringOption((o) => o.setName("auction").setDescription("Auction (start typing the item)").setAutocomplete(true).setRequired(true))
    .addIntegerOption((o) => o.setName("amount").setDescription("Bid amount").setMinValue(1).setRequired(true)))
  .addSubcommand((sub) => sub.setName("close").setDescription("Close an auction.")
    .addStringOption((o) => o.setName("auction").setDescription("Auction (start typing the item)").setAutocomplete(true).setRequired(true)))
  .addSubcommand((sub) => sub.setName("priority").setDescription("EPGP priority: who gets an item (highest PR of those who wish for it) and its set price. Officers.")
    .addStringOption((o) => o.setName("item").setDescription("Item (pick a known one, or type)").setAutocomplete(true).setRequired(true).setMaxLength(100))
    .addStringOption((o) => o.setName("raid").setDescription("Raid, to use its core's roster, prices and pool (start typing its name)").setAutocomplete(true)))
  .addSubcommand((sub) => sub.setName("history").setDescription("View awarded loot.").addStringOption(o => o.setName("core").setDescription("Raid core (defaults to this channel)").setAutocomplete(true)))
  .addSubcommand((sub) => sub.setName("reserves").setDescription("Who soft-reserved what (the list kept in the game addon).")
    .addStringOption((o) => o.setName("item").setDescription("Only this item (part of its name), or one character's reserves").setMaxLength(100)));

function officer(interaction: ChatInputCommandInteraction): boolean {
  return !!interaction.member && hasPermission(interaction.member as Parameters<typeof hasPermission>[0], "officer");
}

export async function executeLoot(interaction: ChatInputCommandInteraction): Promise<void> {
  const context = await requireGuildContext(interaction);
  if (!context) return;
  const subcommand = interaction.options.getSubcommand();
  if (subcommand === "reserves") {
    await interaction.reply({ content: await describeReserves(prisma, context.guildId, interaction.options.getString("item") ?? undefined), ephemeral: true });
    return;
  }
  if ((subcommand === "auction" || subcommand === "close" || subcommand === "award" || subcommand === "priority") && !officer(interaction)) {
    await interaction.reply({ content: "Only officers, Guild Masters, or administrators can manage auctions.", ephemeral: true });
    return;
  }
  // Loot council can be set for the whole guild (/setup config loot-mode) or for one
  // core (/core rules); a raid made for a core follows that core's mode.
  const guildSettings = await guildService.getSettings(context.guildId);
  let raidForMode = subcommand === "auction" || subcommand === "award" || subcommand === "priority" ? interaction.options.getString("raid") : null;
  if (subcommand === "bid") {
    const auction = await prisma.auction.findFirst({ where: { id: interaction.options.getString("auction", true), guildId: context.guildId }, select: { raidId: true } });
    raidForMode = auction?.raidId ?? null;
  }
  if (!raidForMode && ["auction", "award", "priority"].includes(subcommand)) {
    const channelCore = await coreContext(prisma, context.guildId, interaction.channelId);
    if (channelCore) {
      const raids = await prisma.raid.findMany({ where: { guildId: context.guildId, coreId: channelCore.id, status: "ACTIVE" }, take: 2 });
      if (raids.length !== 1) throw new Error("Choose raid: to use this core's loot rules and history.");
      raidForMode = raids[0]?.id ?? null;
    }
  }
  if (raidForMode && !await prisma.raid.findFirst({ where: { id: raidForMode, guildId: context.guildId }, select: { id: true } })) throw new Error("That raid does not belong to this guild.");
  const raidCore = await coreForRaid(prisma, context.guildId, raidForMode);
  const rules = effectiveRules(guildSettings, raidCore);
  const lootMode = rules.lootMode;
  if (subcommand === "priority") {
    const itemName = interaction.options.getString("item", true);
    const result = await priorityFor(prisma, context.guildId, itemName, { coreId: raidCore?.id ?? null, separatePool: rules.separatePool, baseGp: rules.baseGp, minEp: rules.minEp });
    await interaction.reply({ content: describePriority(itemName, raidCore?.name ?? null, result).slice(0, 1990), ephemeral: true });
    return;
  }
  if (subcommand === "award") {
    const user = interaction.options.getUser("player", true);
    const target = await guildService.ensureMember(context.guildId, user.id, user.username);
    const itemName = interaction.options.getString("item", true);
    // EPGP priority: an item without an explicit price costs its set price.
    let gp = interaction.options.getInteger("gp");
    let usedSetPrice = false;
    if (gp === null && lootMode === "PRIORITY") {
      const price = await itemValues.priceOf(context.guildId, raidCore?.id ?? null, { name: itemName });
      if (price !== null) { gp = price; usedSetPrice = true; }
    }
    // Off-spec: the core's share of the price (a GP typed by hand is the price it applies to).
    const offspec = interaction.options.getBoolean("offspec") === true;
    if (offspec && gp !== null) gp = Math.round(gp * rules.offspecPercent / 100);
    const award = await lootService.awardDirect({
      guildId: context.guildId, memberId: target.id, itemName,
      gp: gp ?? 0, raidId: raidForMode ?? undefined,
      bossName: interaction.options.getString("boss") ?? undefined, awardedBy: interaction.user.id
    });
    await interaction.reply({ content: `**${award.itemName}** awarded to ${user.username}${award.amount ? ` for ${award.amount} GP${usedSetPrice ? " (its set price)" : ""}${offspec ? ` (off-spec, ${rules.offspecPercent}%)` : ""}` : ""}.`, allowedMentions: { parse: [] } });
    await notify(interaction.guild, notifications.lootAwarded(award.itemName, award.member.displayName, award.amount), "loot", raidCore?.id ?? null);
    return;
  }
  if (lootMode !== "EPGP" && (subcommand === "auction" || subcommand === "bid")) {
    const how: Record<string, string> = {
      COUNCIL: "officers decide. In game, officers open the loot council (answer BiS, Upgrade, Off-spec or Pass in the popup) and award with `/loot award` or in the Council tab; add the item to your `/character wishlist` to state interest.",
      RESERVE: "players reserve items before the raid (`/guilded reserve` in game, `/loot reserves` here) and the reservers of a dropped item roll for it. Officers record the award with `/loot award`.",
      PRIORITY: "every item has a set GP price and goes to the highest PR of the players who want it (wishlist here, the popup in game). `/loot priority` shows who is next; `/loot award` charges the set price."
    };
    await interaction.reply({ content: `This raid uses **${LOOT_MODE_LABEL[lootMode]}**: ${how[lootMode]}`, ephemeral: true });
    return;
  }
  if (subcommand === "auction") {
    const auction = await lootService.createAuction({
      guildId: context.guildId,
      itemName: interaction.options.getString("item", true),
      minimumBid: interaction.options.getInteger("minimum") ?? guildSettings?.minimumBid ?? 10,
      bidIncrement: interaction.options.getInteger("increment") ?? guildSettings?.bidIncrement ?? 5,
      durationSeconds: interaction.options.getInteger("duration") ?? guildSettings?.auctionDurationSec ?? 60,
      createdBy: interaction.user.id,
      bossName: interaction.options.getString("boss") ?? undefined,
      raidId: raidForMode ?? undefined
    });
    const wanting = await wishlistService.countWanting(context.guildId, auction.itemName);
    await interaction.reply(`Auction **${auction.itemName}** started. ID: \`${auction.id}\`; closes <t:${Math.floor(auction.closesAt.getTime() / 1000)}:R>.${wanting > 0 ? ` Wishlisted by ${wanting} raider(s).` : ""}`);
    return;
  }
  if (subcommand === "bid") {
    const bid = await lootService.placeBid({
      auctionId: interaction.options.getString("auction", true),
      memberId: context.memberId,
      amount: interaction.options.getInteger("amount", true)
    });
    await interaction.reply({ content: `Bid of **${bid.amount} GP** placed.`, ephemeral: true });
    return;
  }
  if (subcommand === "close") {
    if (!await prisma.auction.findFirst({ where: { id: interaction.options.getString("auction", true), guildId: context.guildId }, select: { id: true } })) throw new Error("That auction does not belong to this guild.");
    const result = await lootService.closeAuction(interaction.options.getString("auction", true), interaction.user.id);
    await interaction.reply(result.award
      ? `Auction closed. **${result.award.itemName}** awarded for **${result.award.amount} GP**.`
      : "Auction closed with no bids.");
    if (result.award) {
      await notify(interaction.guild, notifications.lootAwarded(result.award.itemName, result.award.member.displayName, result.award.amount), "loot", (await coreForRaid(prisma, context.guildId, result.auction.raidId))?.id ?? null);
    }
    return;
  }
  const selectedCore = await coreContext(prisma, context.guildId, interaction.channelId, interaction.options.getString("core"));
  const history = await lootService.getHistory(context.guildId, 20, selectedCore?.id);
  const raidIds = [...new Set(history.map((award) => award.raidId).filter((id): id is string => !!id))];
  const raids = new Map((await prisma.raid.findMany({ where: { guildId: context.guildId, id: { in: raidIds } }, select: { id: true, title: true } }))
    .map((raid) => [raid.id, raid.title]));
  // One line per award: item, boss/raid, winner, GP, their GP before -> after,
  // who awarded it, and when.
  const lines = history.map((award) => {
    const where = [award.bossName, award.raidId ? raids.get(award.raidId) : null].filter(Boolean).join(", ");
    const gpChange = award.gpBefore === null ? "" : ` (GP ${award.gpBefore} → ${award.gpBefore + award.amount})`;
    const by = award.awardedBy ? `, by <@${award.awardedBy}>` : "";
    return `**${award.itemName}**${where ? ` [${where}]` : ""} — <@${award.member.discordUserId}> ${award.amount} GP${gpChange}${by} <t:${Math.floor(award.awardedAt.getTime() / 1000)}:d>`;
  });
  let text = "";
  for (const line of lines) {
    if (text.length + line.length > 1900) break;
    text += `${line}\n`;
  }
  await interaction.reply({ content: text || "No loot has been awarded yet.", allowedMentions: { parse: [] } });
}
