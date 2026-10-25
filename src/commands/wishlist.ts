import { SlashCommandBuilder, type ChatInputCommandInteraction, MessageFlags } from "discord.js";
import { prisma } from "../database.js";
import { createWishlistService, PRIORITY_LABELS } from "../services/wishlist.js";
import { guildService, requireGuildContext } from "./context.js";
import { selectedCharacter } from "../services/character-match.js";

const wishlistService = createWishlistService(prisma);

export const wishlistCommand = new SlashCommandBuilder()
  .setName("wishlist")
  .setDescription("Track the items your characters are hoping to get.")
  .addSubcommand((sub) => sub.setName("add").setDescription("Add or update an item on a character's wishlist.")
    .addStringOption((o) => o.setName("character").setDescription("Your character (pick from the list)").setAutocomplete(true).setRequired(true))
    .addStringOption((o) => o.setName("item").setDescription("Item (pick a known one, or type)").setAutocomplete(true).setRequired(true).setMaxLength(100))
    .addIntegerOption((o) => o.setName("priority").setDescription("1 = high, 2 = medium (default), 3 = low").setMinValue(1).setMaxValue(3)))
  .addSubcommand((sub) => sub.setName("remove").setDescription("Remove an item from a character's wishlist.")
    .addStringOption((o) => o.setName("character").setDescription("Your character (pick from the list)").setAutocomplete(true).setRequired(true))
    .addStringOption((o) => o.setName("item").setDescription("Item (pick a known one, or type)").setAutocomplete(true).setRequired(true).setMaxLength(100)))
  .addSubcommand((sub) => sub.setName("list").setDescription("Show one of your characters' wishlist.")
    .addStringOption((o) => o.setName("character").setDescription("Your character (pick from the list)").setAutocomplete(true).setRequired(true)))
  .addSubcommand((sub) => sub.setName("item").setDescription("See who in the guild wants an item.")
    .addStringOption((o) => o.setName("item").setDescription("Item (pick a known one, or type)").setAutocomplete(true).setRequired(true).setMaxLength(100)));

export async function executeWishlist(interaction: ChatInputCommandInteraction): Promise<void> {
  const context = await requireGuildContext(interaction);
  if (!context) return;
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === "item") {
    const itemName = interaction.options.getString("item", true);
    const entries = await wishlistService.whoWants(context.guildId, itemName);
    await interaction.reply({
      content: entries.length
        ? [`Wanted by ${entries.length}:`, ...entries.map((entry) => `${PRIORITY_LABELS[entry.priority] ?? entry.priority} - ${entry.character.name} (${entry.character.className})`)].join("\n")
        : "Nobody has that item on their wishlist.",
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const characterName = interaction.options.getString("character", true);
  const characters = await guildService.listCharacters(context.memberId);
  const character = selectedCharacter(characters, characterName);
  if (!character) throw new Error("That character is not linked to your profile.");

  if (subcommand === "list") {
    const entries = await wishlistService.list(character.id);
    await interaction.reply({
      content: entries.length
        ? entries.map((entry) => `${PRIORITY_LABELS[entry.priority] ?? entry.priority}: ${entry.itemName}`).join("\n")
        : `${character.name} has no wishlist items.`,
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const itemName = interaction.options.getString("item", true);
  if (subcommand === "add") {
    const entry = await wishlistService.add(character.id, itemName, interaction.options.getInteger("priority") ?? 2);
    await interaction.reply({ content: `Added ${entry.itemName} to ${character.name}'s wishlist (${PRIORITY_LABELS[entry.priority]}).`, flags: MessageFlags.Ephemeral });
    return;
  }
  await wishlistService.remove(character.id, itemName);
  await interaction.reply({ content: `Removed ${itemName.trim()} from ${character.name}'s wishlist.`, flags: MessageFlags.Ephemeral });
}
