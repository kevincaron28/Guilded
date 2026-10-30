import { MessageFlags, type ChatInputCommandInteraction, type ButtonInteraction, type ModalSubmitInteraction, type StringSelectMenuInteraction } from "discord.js";
import { prisma } from "../database.js";
import { createGuildService } from "../services/guild.js";
import { createErrorReportService, isMemberAnswer } from "../services/error-report.js";
import { BRAND } from "../brand.js";
import { currentGuildScope } from "../services/guild-scope.js";

export const guildService = createGuildService(prisma);
export const errorReportService = createErrorReportService(prisma);

export async function requireGuildContext(
  interaction: ChatInputCommandInteraction | ButtonInteraction | ModalSubmitInteraction | StringSelectMenuInteraction
): Promise<{ guildId: string; memberId: string } | null> {
  if (!interaction.guild || !interaction.guildId || !interaction.member) {
    await interaction.reply({
      content: `This command can only be used inside the ${BRAND.name} Discord server.`,
      flags: MessageFlags.Ephemeral
    });
    return null;
  }

  const guild = await guildService.ensureGuild(interaction.guildId, interaction.guild.name);
  const scope = currentGuildScope();
  if (scope?.memberRoleId) {
    const member = await interaction.guild.members.fetch(interaction.user.id);
    if (!member.permissions.has("Administrator") && !member.roles.cache.has(scope.memberRoleId)) throw new Error("You need this in-game guild's member role to use its tools.");
  }
  // The server display name, as button clicks store it: the account username would overwrite the
  // nickname that rosters show and that name matching links characters by.
  const member = await guildService.ensureMember(
    guild.id,
    interaction.user.id,
    "displayName" in interaction.member ? interaction.member.displayName : interaction.member.nick ?? interaction.user.displayName
  );
  return { guildId: guild.id, memberId: member.id };
}

export async function replyWithCommandError(
  interaction: ChatInputCommandInteraction,
  error: unknown
): Promise<void> {
  // Discord gave up on the interaction (took over 3 s): nothing can be sent back.
  if (typeof error === "object" && error !== null && (error as { code?: number }).code === 10062) {
    console.warn("Command answered too late; Discord already dropped it. Try again.");
    return;
  }
  if (isMemberAnswer(error)) {
    console.warn(`/${interaction.commandName}: ${(error as Error).message}`);
  } else {
    console.error("Command failed", error);
    void errorReportService.report(interaction.client, error, {
      source: interaction.commandName,
      guildId: interaction.guildId,
      guildName: interaction.guild?.name,
      channelId: interaction.channelId,
      operation: `/${[interaction.commandName, interaction.options.getSubcommandGroup(false), interaction.options.getSubcommand(false)].filter(Boolean).join(" ")}`,
      userId: interaction.user.id
    });
  }
  const content = error instanceof Error && error.message.length < 200
    ? error.message
    : "The command could not be completed. Please try again or contact an officer.";
  if (interaction.deferred && !interaction.replied) {
    await interaction.editReply({ content });
  } else if (interaction.replied) {
    await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
  } else {
    await interaction.reply({ content, flags: MessageFlags.Ephemeral });
  }
}
