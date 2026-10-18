import { AttachmentBuilder, SlashCommandBuilder, type ChatInputCommandInteraction, type GuildMember, MessageFlags } from "discord.js";
import { prisma } from "../database.js";
import { hasPermission } from "../permissions.js";
import { buildExport, csvBuffer, EXPORT_KINDS, type ExportKind } from "../services/exports.js";
import { requireGuildContext } from "./context.js";

// /officer export table:<...>: this server's data as a CSV file only the officer sees.
export const exportCommand = new SlashCommandBuilder()
  .setName("export")
  .setDescription("Officers: download standings, the EPGP ledger, loot, attendance or the roster as a CSV file.")
  .addStringOption((o) => o.setName("table").setDescription("What to export").setRequired(true).addChoices(
    { name: "Standings (EP, GP, PR)", value: "standings" },
    { name: "EPGP ledger", value: "ledger" },
    { name: "Loot history", value: "loot" },
    { name: "Raid attendance", value: "attendance" },
    { name: "Roster (members and characters)", value: "roster" }));

export async function executeExport(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.inGuild() || !interaction.member || !hasPermission(interaction.member as GuildMember, "officer")) {
    await interaction.reply({ content: "Only Officers and Guild Masters can export data.", flags: MessageFlags.Ephemeral });
    return;
  }
  const table = interaction.options.getString("table", true);
  if (!EXPORT_KINDS.includes(table as ExportKind)) {
    await interaction.reply({ content: `Choose one of: ${EXPORT_KINDS.join(", ")}.`, flags: MessageFlags.Ephemeral });
    return;
  }
  const context = await requireGuildContext(interaction);
  if (!context) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const result = await buildExport(prisma, context.guildId, table as ExportKind);
  await interaction.editReply({
    content: `${result.rows} row${result.rows === 1 ? "" : "s"} exported from this server. Only you can see this file. Open it in Excel or Google Sheets.`,
    files: [new AttachmentBuilder(csvBuffer(result.csv), { name: result.filename })]
  });
}
