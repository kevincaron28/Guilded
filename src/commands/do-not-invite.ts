import { MessageFlags, SlashCommandBuilder, type ChatInputCommandInteraction, type GuildMember } from "discord.js";
import { prisma } from "../database.js";
import { hasPermission } from "../permissions.js";
import { createDoNotInviteService } from "../services/do-not-invite.js";
import { requireGuildContext } from "./context.js";

const service = createDoNotInviteService(prisma);

// Mounted as /mod dni. Officer-only, and every reply is private.
export const dniCommand = new SlashCommandBuilder()
  .setName("dni")
  .setDescription("Officers' do-not-invite list (private; matches warn the officer log).")
  .addSubcommand((sub) => sub.setName("add").setDescription("Add someone to the do-not-invite list.")
    .addStringOption((o) => o.setName("name").setDescription("Character name (full name on Forever)").setMaxLength(60).setRequired(true))
    .addStringOption((o) => o.setName("reason").setDescription("Why (officers see it on a match)").setMaxLength(200).setRequired(true))
    .addStringOption((o) => o.setName("realm").setDescription("Realm, if it matters").setMaxLength(60))
    .addUserOption((o) => o.setName("user").setDescription("Their Discord account, if known")))
  .addSubcommand((sub) => sub.setName("remove").setDescription("Remove an entry.")
    .addStringOption((o) => o.setName("entry").setDescription("The entry (pick from the list)").setAutocomplete(true).setRequired(true)))
  .addSubcommand((sub) => sub.setName("list").setDescription("Show the list."));

export async function executeDni(interaction: ChatInputCommandInteraction): Promise<void> {
  const context = await requireGuildContext(interaction);
  if (!context) return;
  if (!interaction.member || !hasPermission(interaction.member as GuildMember, "officer")) {
    await interaction.reply({ content: "Only officers can use the do-not-invite list.", flags: MessageFlags.Ephemeral });
    return;
  }
  const subcommand = interaction.options.getSubcommand();
  if (subcommand === "add") {
    const user = interaction.options.getUser("user");
    const entry = await service.add(context.guildId, {
      name: interaction.options.getString("name", true), realm: interaction.options.getString("realm"),
      discordUserId: user?.id ?? null, reason: interaction.options.getString("reason", true), addedBy: interaction.user.id
    });
    await interaction.reply({ content: `Added **${entry.name}${entry.realm ? `-${entry.realm}` : ""}**${user ? ` (<@${user.id}>)` : ""} to the do-not-invite list. Officers are warned in the officer log if they apply${user ? " or join the Discord" : ""}; nothing is blocked.`, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    return;
  }
  if (subcommand === "remove") {
    await service.remove(context.guildId, interaction.options.getString("entry", true));
    await interaction.reply({ content: "Removed from the do-not-invite list.", flags: MessageFlags.Ephemeral });
    return;
  }
  const entries = await service.list(context.guildId);
  const lines = entries.map((entry) => `• **${entry.name}${entry.realm ? `-${entry.realm}` : ""}**${entry.discordUserId ? ` (<@${entry.discordUserId}>)` : ""} — ${entry.reason} · <@${entry.addedBy}> <t:${Math.floor(entry.createdAt.getTime() / 1000)}:d>`);
  let text = "";
  for (const line of lines) {
    if (text.length + line.length > 1900) { text += `\n… +${lines.length - text.split("\n").length}`; break; }
    text += `${text ? "\n" : ""}${line}`;
  }
  await interaction.reply({ content: text || "The do-not-invite list is empty.", flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
}

export async function dniChoices(guildId: string, query: string) {
  const q = query.trim().toLowerCase();
  return (await service.list(guildId)).map((entry) => ({ name: `${entry.name}${entry.realm ? `-${entry.realm}` : ""} — ${entry.reason}`.slice(0, 100), value: entry.id }))
    .filter((choice) => !q || choice.name.toLowerCase().includes(q)).slice(0, 25);
}
