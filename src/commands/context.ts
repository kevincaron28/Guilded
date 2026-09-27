import type { ChatInputCommandInteraction } from "discord.js";
import { prisma } from "../database.js";
import { createGuildService } from "../services/guild.js";
import { createErrorReportService } from "../services/error-report.js";
import { BRAND } from "../brand.js";

export const guildService = createGuildService(prisma);
export const errorReportService = createErrorReportService(prisma);

export async function requireGuildContext(
  interaction: ChatInputCommandInteraction
): Promise<{ guildId: string; memberId: string } | null> {
  if (!interaction.guild || !interaction.guildId || !interaction.member) {
    await interaction.reply({
      content: `This command can only be used inside the ${BRAND.name} Discord server.`,
      ephemeral: true
    });
    return null;
  }

  const guild = await guildService.ensureGuild(interaction.guildId, interaction.guild.name);
  const member = await guildService.ensureMember(
    guild.id,
    interaction.user.id,
    interaction.member.user.username
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
  console.error("Command failed", error);
  void errorReportService.report(interaction.client, error, {
    source: interaction.commandName,
    guildId: interaction.guildId,
    guildName: interaction.guild?.name,
    userId: interaction.user.id
  });
  const content = error instanceof Error && error.message.length < 200
    ? error.message
    : "The command could not be completed. Please try again or contact an officer.";
  if (interaction.replied || interaction.deferred) {
    await interaction.followUp({ content, ephemeral: true });
  } else {
    await interaction.reply({ content, ephemeral: true });
  }
}
