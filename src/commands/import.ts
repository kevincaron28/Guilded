import { SlashCommandBuilder, type ChatInputCommandInteraction, MessageFlags } from "discord.js";
import { createAddonImportService } from "../services/addon-import.js";
import { prisma } from "../database.js";
import { hasPermission } from "../permissions.js";
import { requireGuildContext } from "./context.js";

const importService = createAddonImportService(prisma);

export const importCommand = new SlashCommandBuilder()
  .setName("import")
  .setDescription("Preview a validated addon JSON export.")
  .addAttachmentOption((option) => option.setName("file").setDescription("Addon JSON export").setRequired(true));

export async function executeImport(interaction: ChatInputCommandInteraction): Promise<void> {
  const context = await requireGuildContext(interaction);
  if (!context) return;
  if (!interaction.member || !hasPermission(interaction.member as Parameters<typeof hasPermission>[0], "officer")) {
    await interaction.reply({ content: "Only officers can import addon data.", flags: MessageFlags.Ephemeral });
    return;
  }
  const attachment = interaction.options.getAttachment("file", true);
  if (!attachment.name.toLowerCase().endsWith(".json")) {
    throw new Error("The addon export must be a .json file.");
  }
  const response = await fetch(attachment.url);
  if (!response.ok) throw new Error(`Could not download the addon export (${response.status}).`);
  const payload: unknown = await response.json();
  const preview = await importService.preview(context.guildId, payload, interaction.user.id);
  if (preview.duplicate) throw new Error("This exact addon export has already been imported.");
  await importService.record(context.guildId, preview.snapshot, preview.checksum, interaction.user.id);
  await interaction.reply({
    content: `Validated ${preview.transactionCount} ${preview.snapshot.source} transactions. Import recorded for officer review; no DKP was changed.`,
    flags: MessageFlags.Ephemeral
  });
}
