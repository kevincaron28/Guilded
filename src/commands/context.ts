import { MessageFlags, type ChatInputCommandInteraction, type ButtonInteraction, type ModalSubmitInteraction, type StringSelectMenuInteraction } from "discord.js";
import { prisma } from "../database.js";
import { createGuildService } from "../services/guild.js";
import { createErrorReportService, isMemberAnswer } from "../services/error-report.js";
import { BRAND } from "../brand.js";
import { frenchErrorMessage } from "../services/error-fr.js";
import { currentGuildScope } from "../services/guild-scope.js";
import { asLang, type Lang } from "../i18n.js";

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

/** The guild's language for member-facing text (English when the settings cannot be read). */
export async function memberLang(guildId: string): Promise<Lang> {
  return asLang((await guildService.getSettings(guildId).catch(() => null))?.language);
}

/** The language of the guild an interaction came from, for failure replies (English outside a guild or when it cannot be read). */
export async function interactionLang(interaction: { guildId: string | null }): Promise<Lang> {
  if (!interaction.guildId) return "en";
  try {
    const record = await prisma.guild.findFirst({ where: { discordId: interaction.guildId }, select: { id: true } });
    return record ? await memberLang(record.id) : "en";
  } catch {
    return "en";
  }
}

/** Discord error 10062 "Unknown interaction": the 3-second window had passed, so no answer can be sent. */
export const isExpiredInteraction = (error: unknown): boolean => typeof error === "object" && error !== null && (error as { code?: number }).code === 10062;

/** What a failed button or menu tells the member: the service's own answer (translated), else the fallback. */
export async function buttonErrorText(interaction: { locale?: string; guildId: string | null }, error: unknown, fallback: string): Promise<string> {
  const english = isMemberAnswer(error) ? (error as Error).message : fallback;
  return await prefersFrench(interaction) ? frenchErrorMessage(english) : english;
}

/** French when the member's Discord app is in French or the server language is French. */
async function prefersFrench(interaction: { locale?: string; guildId: string | null }): Promise<boolean> {
  if (interaction.locale?.startsWith("fr")) return true;
  if (!interaction.guildId) return false;
  try {
    return asLang((await guildService.getSettings(interaction.guildId))?.language) === "fr";
  } catch {
    return false;
  }
}

export async function replyWithCommandError(
  interaction: ChatInputCommandInteraction,
  error: unknown
): Promise<void> {
  // Discord gave up on the interaction (took over 3 s): nothing can be sent back.
  if (isExpiredInteraction(error)) {
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
  const english = isMemberAnswer(error)
    ? (error as Error).message
    : "The command could not be completed. Please try again or contact an officer.";
  const content = await prefersFrench(interaction) ? frenchErrorMessage(english) : english;
  if (interaction.deferred && !interaction.replied) {
    await interaction.editReply({ content });
  } else if (interaction.replied) {
    await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
  } else {
    await interaction.reply({ content, flags: MessageFlags.Ephemeral });
  }
}
