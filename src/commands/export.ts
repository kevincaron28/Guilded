import { AttachmentBuilder, SlashCommandBuilder, type ChatInputCommandInteraction, type GuildMember, MessageFlags } from "discord.js";
import { prisma } from "../database.js";
import { hasPermission } from "../permissions.js";
import { buildExport, type ExportKind } from "../services/exports.js";
import { requireGuildContext } from "./context.js";

export const exportCommand = new SlashCommandBuilder()
  .setName("export")
  .setDescription("Officers: download roster, attendance, loot or the EPGP ledger as a CSV file.")
  .addStringOption((o) => o.setName("what").setDescription("What to export").setRequired(true).addChoices(
    { name: "Roster (members and characters)", value: "roster" },
    { name: "Raid attendance", value: "attendance" },
    { name: "Loot history", value: "loot" },
    { name: "EPGP ledger", value: "epgp" }));

export async function executeExport(interaction: ChatInputCommandInteraction): Promise<void> {
  const context = await requireGuildContext(interaction);
  if (!context) return;
  if (!interaction.member || !hasPermission(interaction.member as GuildMember, "officer")) {
    await interaction.reply({ content: "Only Officers and Guild Masters can export data.", flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const result = await buildExport(prisma, context.guildId, interaction.options.getString("what", true) as ExportKind);
  await interaction.editReply({
    content: `${result.rows} row${result.rows === 1 ? "" : "s"} exported. Only you can see this file.`,
    files: [new AttachmentBuilder(Buffer.from(result.csv, "utf8"), { name: result.filename })]
  });
}
