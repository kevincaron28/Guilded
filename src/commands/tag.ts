import { SlashCommandBuilder, type ChatInputCommandInteraction, type GuildMember, MessageFlags } from "discord.js";
import { prisma } from "../database.js";
import { hasPermission } from "../permissions.js";
import { createTagService } from "../services/tags.js";
import { requireGuildContext } from "./context.js";

const tagService = createTagService(prisma);

export const tagCommand = new SlashCommandBuilder()
  .setName("tag")
  .setDescription("Saved text snippets (raid rules, consumable lists, etc.).")
  .addSubcommand((sub) => sub.setName("show").setDescription("Post a saved tag.")
    .addStringOption((o) => o.setName("name").setDescription("Tag (pick from the list)").setAutocomplete(true).setRequired(true)))
  .addSubcommand((sub) => sub.setName("list").setDescription("List all tags."))
  .addSubcommand((sub) => sub.setName("set").setDescription("Create or replace a tag (officers only).")
    .addStringOption((o) => o.setName("name").setDescription("Tag (pick from the list)").setAutocomplete(true).setRequired(true))
    .addStringOption((o) => o.setName("content").setDescription("What the tag says").setRequired(true).setMaxLength(1900)))
  .addSubcommand((sub) => sub.setName("delete").setDescription("Delete a tag (officers only).")
    .addStringOption((o) => o.setName("name").setDescription("Tag (pick from the list)").setAutocomplete(true).setRequired(true)));

export async function executeTag(interaction: ChatInputCommandInteraction): Promise<void> {
  const context = await requireGuildContext(interaction);
  if (!context) return;
  const subcommand = interaction.options.getSubcommand();

  if (subcommand === "show") {
    const tag = await tagService.get(context.guildId, interaction.options.getString("name", true));
    if (!tag) throw new Error("No tag with that name exists. Try /tag list.");
    // Tag text is officer-authored but shown publicly: never let it ping anyone.
    await interaction.reply({ content: tag.content, allowedMentions: { parse: [] } });
    return;
  }
  if (subcommand === "list") {
    const tags = await tagService.list(context.guildId);
    await interaction.reply({ content: tags.length ? tags.map((tag) => `\`${tag.name}\``).join(", ") : "No tags saved yet.", flags: MessageFlags.Ephemeral });
    return;
  }

  if (!interaction.member || !hasPermission(interaction.member as GuildMember, "officer")) {
    await interaction.reply({ content: "Only Officers, Guild Masters, or administrators can change tags.", flags: MessageFlags.Ephemeral });
    return;
  }
  const name = interaction.options.getString("name", true);
  if (subcommand === "set") {
    const saved = await tagService.set(context.guildId, name, interaction.options.getString("content", true), interaction.user.id);
    await interaction.reply({ content: `Saved tag \`${saved.name}\`.`, flags: MessageFlags.Ephemeral });
    return;
  }
  await tagService.remove(context.guildId, name);
  await interaction.reply({ content: `Deleted tag \`${name.trim().toLowerCase()}\`.`, flags: MessageFlags.Ephemeral });
}
