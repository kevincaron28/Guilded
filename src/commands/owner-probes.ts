import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import { prisma } from "../database.js";
import { latestClientProbes, probeDetail, probeLine } from "../services/client-probes.js";
import { botOwnerId } from "./owner-season.js";

// /guilded-probes: the bot owner reads the latest client probes companions uploaded (/guilded probe auctions, maps, ...), per kind
// and WoW client build. Home server only, like /guilded-season; refused for anyone but the Discord application's owner.
export const OWNER_PROBES_COMMAND = "guilded-probes";

export const ownerProbesCommand = new SlashCommandBuilder()
  .setName(OWNER_PROBES_COMMAND)
  .setDescription("Bot owner: the latest client probes members' companions uploaded")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand((sub) => sub.setName("list").setDescription("Every probe kind and client build received, newest first"))
  .addSubcommand((sub) => sub.setName("show").setDescription("The latest result of one probe kind")
    .addStringOption((o) => o.setName("kind").setDescription("auctions, maps, comm ...").setRequired(true))
    .addStringOption((o) => o.setName("build").setDescription("Client build (default: the newest received)")));

export async function executeOwnerProbes(interaction: ChatInputCommandInteraction): Promise<void> {
  if (interaction.user.id !== await botOwnerId(interaction.client)) {
    await interaction.reply({ content: "Only the Guilded bot's owner can read client probes.", flags: MessageFlags.Ephemeral });
    return;
  }
  const reply = (content: string) => interaction.reply({ content: content.slice(0, 1990), flags: MessageFlags.Ephemeral });
  if (interaction.options.getSubcommand() === "show") {
    const kind = interaction.options.getString("kind", true).trim();
    const build = interaction.options.getString("build")?.trim();
    const rows = (await latestClientProbes(prisma, kind)).filter((row) => !build || row.build === build);
    await reply(rows[0] ? probeDetail(rows[0]) : `No ${kind} probe${build ? ` for build ${build}` : ""} received yet. A member runs /guilded probe ${kind} in game; their companion uploads it at the next sync.`);
    return;
  }
  const rows = await latestClientProbes(prisma);
  await reply(rows.length ? rows.map(probeLine).join("\n") : "No client probes received yet. A member runs /guilded probe auctions (or maps) in game; their companion uploads it at the next sync.");
}
