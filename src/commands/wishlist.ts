import { displayCharacterName } from "../services/character-display.js";
import { SlashCommandBuilder, type ChatInputCommandInteraction, MessageFlags } from "discord.js";
import { prisma } from "../database.js";
import { createWishlistService, PRIORITY_LABELS } from "../services/wishlist.js";
import { guildService, memberLang, requireGuildContext } from "./context.js";
import { tx } from "../i18n.js";
import { pickOwnCharacter } from "../services/own-character.js";

const wishlistService = createWishlistService(prisma);

export const wishlistCommand = new SlashCommandBuilder()
  .setName("wishlist")
  .setDescription("Track the items your characters are hoping to get.")
  .addSubcommand((sub) => sub.setName("add").setDescription("Add or update an item on a character's wishlist.")
    .addStringOption((o) => o.setName("item").setDescription("Item (pick a known one, or type)").setAutocomplete(true).setRequired(true).setMaxLength(100))
    .addIntegerOption((o) => o.setName("priority").setDescription("1 = high, 2 = medium (default), 3 = low").setMinValue(1).setMaxValue(3))
    .addStringOption((o) => o.setName("character").setDescription("Your character (default: your main)").setAutocomplete(true)))
  .addSubcommand((sub) => sub.setName("remove").setDescription("Remove an item from a character's wishlist.")
    .addStringOption((o) => o.setName("item").setDescription("Item (pick a known one, or type)").setAutocomplete(true).setRequired(true).setMaxLength(100))
    .addStringOption((o) => o.setName("character").setDescription("Your character (default: your main)").setAutocomplete(true)))
  .addSubcommand((sub) => sub.setName("list").setDescription("Show one of your characters' wishlist.")
    .addStringOption((o) => o.setName("character").setDescription("Your character (default: your main)").setAutocomplete(true)))
  .addSubcommand((sub) => sub.setName("item").setDescription("See who in the guild wants an item.")
    .addStringOption((o) => o.setName("item").setDescription("Item (pick a known one, or type)").setAutocomplete(true).setRequired(true).setMaxLength(100)));

export async function executeWishlist(interaction: ChatInputCommandInteraction): Promise<void> {
  const context = await requireGuildContext(interaction);
  if (!context) return;
  const subcommand = interaction.options.getSubcommand();
  const lang = await memberLang(context.guildId);
  const priorityLabel = (priority: number): string => tx(lang, PRIORITY_LABELS[priority] ?? String(priority));

  if (subcommand === "item") {
    const itemName = interaction.options.getString("item", true);
    const entries = await wishlistService.whoWants(context.guildId, itemName);
    await interaction.reply({
      content: entries.length
        ? [tx(lang, "Wanted by {count}:", { count: entries.length }), ...entries.map((entry) => `${priorityLabel(entry.priority)} - ${displayCharacterName(entry.character)} (${entry.character.className})`)].join("\n")
        : tx(lang, "Nobody has that item on their wishlist."),
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const characters = await guildService.listCharacters(context.memberId);
  const character = pickOwnCharacter(characters, interaction.options.getString("character"), lang);

  if (subcommand === "list") {
    const entries = await wishlistService.list(character.id);
    await interaction.reply({
      content: entries.length
        ? entries.map((entry) => `${priorityLabel(entry.priority)}: ${entry.itemName}`).join("\n")
        : tx(lang, "{name} has no wishlist items.", { name: displayCharacterName(character) }),
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  const itemName = interaction.options.getString("item", true);
  if (subcommand === "add") {
    const entry = await wishlistService.add(character.id, itemName, interaction.options.getInteger("priority") ?? 2);
    await interaction.reply({ content: tx(lang, "Added {item} to {name}'s wishlist ({priority}).", { item: entry.itemName, name: displayCharacterName(character), priority: priorityLabel(entry.priority) }), flags: MessageFlags.Ephemeral });
    return;
  }
  await wishlistService.remove(character.id, itemName);
  await interaction.reply({ content: tx(lang, "Removed {item} from {name}'s wishlist.", { item: itemName.trim(), name: displayCharacterName(character) }), flags: MessageFlags.Ephemeral });
}
