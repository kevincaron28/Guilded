import { MessageFlags, PermissionFlagsBits, SlashCommandBuilder, type ChatInputCommandInteraction } from "discord.js";
import type { OwnerConsole } from "../services/owner-console.js";

// /guilded-console: the bot owner's private fleet console (services/owner-console.ts). Registered
// only in the home server (DISCORD_GUILD_ID), like /guilded-season; refused for anyone but the
// Discord application's owner.
export const OWNER_CONSOLE_COMMAND = "guilded-console";

export const ownerConsoleCommand = new SlashCommandBuilder()
  .setName(OWNER_CONSOLE_COMMAND)
  .setDescription("Bot owner: the private fleet console")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand((sub) => sub.setName("setup").setDescription("Create (or repair) the owner-only console channel here"))
  .addSubcommand((sub) => sub.setName("refresh").setDescription("Redraw the fleet board now"))
  .addSubcommand((sub) => sub.setName("test").setDescription("Mark a server as a test server (kept out of public pages)")
    .addBooleanOption((o) => o.setName("on").setDescription("True = test server, false = live").setRequired(true))
    .addStringOption((o) => o.setName("server").setDescription("Server id (default: this server)")));

export async function executeOwnerConsole(interaction: ChatInputCommandInteraction, console_: OwnerConsole, ownerId: () => Promise<string | null>): Promise<void> {
  if (interaction.user.id !== await ownerId()) {
    await interaction.reply({ content: "Only the Guilded bot's owner can use the owner console.", flags: MessageFlags.Ephemeral });
    return;
  }
  if (interaction.options.getSubcommand() === "setup") { await console_.setupChannel(interaction); return; }
  if (interaction.options.getSubcommand() === "test") {
    const id = (interaction.options.getString("server") ?? interaction.guildId ?? "").trim();
    await interaction.reply({ content: /^\d{15,25}$/.test(id) ? await console_.setTestServer(id, interaction.options.getBoolean("on", true), interaction.user.id) : "Give a server id (digits).", flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await console_.refresh(true);
  await interaction.editReply("Board refreshed (if the console channel is set up).");
}
