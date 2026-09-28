import { ApplicationStatus } from "@prisma/client";
import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ModalBuilder, SlashCommandBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle,
  type ButtonInteraction, type ChatInputCommandInteraction, type Guild as DiscordGuild, type GuildMember,
  type GuildTextBasedChannel, type ModalSubmitInteraction, type StringSelectMenuInteraction
} from "discord.js";
import { prisma } from "../database.js";
import { APPLY_PREFIX, createApplicationService } from "../services/application.js";
import { createRaidCoreService } from "../services/raid-core.js";
import { syncApprovedMemberRoles } from "../services/housekeeping.js";
import { notifyInteractive, resolveNotifyChannel } from "../services/notify.js";
import { hasPermission } from "../permissions.js";
import { requireGuildContext, guildService } from "./context.js";
import { CLASSES } from "../wow-data.js";

export { APPLY_PREFIX };
export const applicationService = createApplicationService(prisma);
const coreService = createRaidCoreService(prisma);

export const applicationCommand = new SlashCommandBuilder()
  .setName("application").setDescription("Review recruitment applications.")
  .addSubcommand((sub) => sub.setName("list").setDescription("List applications.")
    .addStringOption((o) => o.setName("status").setDescription("Filter status")
      .addChoices(...Object.values(ApplicationStatus).map((status) => ({ name: status, value: status })))))
  .addSubcommand((sub) => sub.setName("view").setDescription("View an application.")
    .addStringOption((o) => o.setName("id").setDescription("Application (start typing the character)").setAutocomplete(true).setRequired(true)))
  .addSubcommand((sub) => sub.setName("approve").setDescription("Approve an application.")
    .addStringOption((o) => o.setName("id").setDescription("Application (start typing the character)").setAutocomplete(true).setRequired(true)))
  .addSubcommand((sub) => sub.setName("reject").setDescription("Reject an application.")
    .addStringOption((o) => o.setName("id").setDescription("Application (start typing the character)").setAutocomplete(true).setRequired(true)))
  .addSubcommand((sub) => sub.setName("trial").setDescription("Move an application to trial.")
    .addStringOption((o) => o.setName("id").setDescription("Application (start typing the character)").setAutocomplete(true).setRequired(true)));

export const applyCommand = new SlashCommandBuilder()
  .setName("apply").setDescription("Apply to a raid core.")
  .addStringOption((o) => o.setName("core").setDescription("Raid core you're applying to (start typing its name)").setAutocomplete(true).setRequired(true))
  .addStringOption((o) => o.setName("character").setDescription("Character name").setRequired(true))
  .addStringOption((o) => o.setName("class").setDescription("Class (pick from the list)").setRequired(true)
    .addChoices(...CLASSES.map((name) => ({ name, value: name }))))
  .addStringOption((o) => o.setName("spec").setDescription("Specialization (pick or type)").setRequired(true).setAutocomplete(true))
  .addStringOption((o) => o.setName("experience").setDescription("Raid experience").setRequired(true))
  .addStringOption((o) => o.setName("availability").setDescription("Availability (pick or type)").setRequired(true).setAutocomplete(true))
  .addStringOption((o) => o.setName("notes").setDescription("Additional notes"));

function isOfficer(interaction: ChatInputCommandInteraction): boolean {
  return !!interaction.member && hasPermission(interaction.member as Parameters<typeof hasPermission>[0], "officer");
}

type ApplicationCard = {
  id: string; character: string; className: string; spec: string; experience: string; availability: string;
  notes?: string | null; core: { name: string } | null;
};

const DECISION_COLOR: Record<ApplicationStatus, number> = {
  [ApplicationStatus.PENDING]: 0xd4af37, [ApplicationStatus.TRIAL]: 0x5865f2,
  [ApplicationStatus.APPROVED]: 0x2ecc71, [ApplicationStatus.REJECTED]: 0xe74c3c
};
const DECISION_LABEL: Record<ApplicationStatus, string> = {
  [ApplicationStatus.PENDING]: "", [ApplicationStatus.TRIAL]: "🧪 Moved to trial",
  [ApplicationStatus.APPROVED]: "✅ Approved", [ApplicationStatus.REJECTED]: "❌ Rejected"
};

function applicationEmbed(app: ApplicationCard, applicantId: string, decision?: { status: ApplicationStatus; by: string }): EmbedBuilder {
  const embed = new EmbedBuilder().setColor(decision ? DECISION_COLOR[decision.status] : DECISION_COLOR.PENDING)
    .setTitle(`📋 Application — ${app.character}`)
    .setDescription(`From <@${applicantId}>`)
    .addFields(
      { name: "Class / Spec", value: `${app.className} / ${app.spec}`, inline: true },
      { name: "Core", value: app.core?.name ?? "General", inline: true },
      { name: "Experience", value: app.experience.slice(0, 500) },
      { name: "Availability", value: app.availability.slice(0, 500) }
    );
  if (app.notes) embed.addFields({ name: "Notes", value: app.notes.slice(0, 500) });
  if (decision) embed.addFields({ name: "Decision", value: `${DECISION_LABEL[decision.status]} by <@${decision.by}>` });
  else embed.setFooter({ text: `Application id ${app.id}` });
  return embed;
}

function applicationDecisionRow(id: string) {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${APPLY_PREFIX}decide:approve:${id}`).setLabel("Approve").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`${APPLY_PREFIX}decide:trial:${id}`).setLabel("Trial").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${APPLY_PREFIX}decide:reject:${id}`).setLabel("Reject").setStyle(ButtonStyle.Danger)
  );
}

// Posts a card with Approve / Trial / Reject buttons to the applications
// channel (falls back to the officer log): officers decide right there,
// no /application commands needed. Still available as a fallback
// (/application list|view|approve|reject|trial), e.g. if the card scrolled
// out of view.
export async function announceApplication(guild: DiscordGuild | null, applicantId: string, application: ApplicationCard): Promise<void> {
  const message = await notifyInteractive(guild, () => ({
    embeds: [applicationEmbed(application, applicantId)],
    components: [applicationDecisionRow(application.id)]
  }), "application");
  if (message) await applicationService.setCardMessage(application.id, message.id);
}

// After a decision made with /application approve|reject|trial (rather than
// the card's own buttons), updates that same card: shows who decided and
// removes the buttons, so it can't also be clicked afterward. Never throws:
// a decision must stand even if the card was deleted or moved.
async function syncApplicationCard(
  guild: DiscordGuild | null,
  application: ApplicationCard & { cardMessageId: string | null; member: { discordUserId: string } },
  status: ApplicationStatus,
  by: string
): Promise<void> {
  if (!guild || !application.cardMessageId) return;
  try {
    const target = await resolveNotifyChannel(guild, "application");
    if (!target) return;
    const message = await target.channel.messages.fetch(application.cardMessageId).catch(() => null);
    if (!message?.editable) return;
    await message.edit({
      embeds: [applicationEmbed(application, application.member.discordUserId, { status, by })],
      components: []
    });
  } catch (error) {
    console.error("Failed to sync application card", error);
  }
}

export async function executeApply(interaction: ChatInputCommandInteraction): Promise<void> {
  const context = await requireGuildContext(interaction);
  if (!context) return;
  const notes = interaction.options.getString("notes");
  const core = await coreService.byIdOrName(context.guildId, interaction.options.getString("core", true));
  const application = await applicationService.create({
    guildId: context.guildId, memberId: context.memberId,
    character: interaction.options.getString("character", true),
    className: interaction.options.getString("class", true),
    spec: interaction.options.getString("spec", true),
    experience: interaction.options.getString("experience", true),
    availability: interaction.options.getString("availability", true),
    ...(notes ? { notes } : {}),
    coreId: core.id
  });
  await announceApplication(interaction.guild, interaction.user.id, application);
  await interaction.reply({ content: `Application submitted for **${core.name}**. Your application ID is \`${application.id}\`.`, ephemeral: true });
}

export async function executeApplication(interaction: ChatInputCommandInteraction): Promise<void> {
  const context = await requireGuildContext(interaction);
  if (!context) return;
  if (!isOfficer(interaction)) {
    await interaction.reply({ content: "Only officers, Guild Masters, or administrators can view or review applications.", ephemeral: true });
    return;
  }
  const subcommand = interaction.options.getSubcommand();
  if (subcommand === "list") {
    const rawStatus = interaction.options.getString("status") as ApplicationStatus | null;
    const applications = await applicationService.list(context.guildId, rawStatus ?? undefined);
    await interaction.reply(applications.length
      ? applications.map((app) => `\`${app.id}\` — **${app.character}** (<@${app.member.discordUserId}>)${app.core ? ` — ${app.core.name}` : ""} — ${app.status}`).join("\n")
      : "No applications found.");
    return;
  }
  const id = interaction.options.getString("id", true);
  if (subcommand === "view") {
    const app = await applicationService.get(context.guildId, id);
    if (!app) throw new Error("Application not found");
    await interaction.reply(`\`${app.id}\` **${app.character}** — ${app.status}${app.core ? `\nCore: ${app.core.name}` : ""}\nClass/spec: ${app.className} / ${app.spec}\nExperience: ${app.experience}\nAvailability: ${app.availability}${app.notes ? `\nNotes: ${app.notes}` : ""}`);
    return;
  }
  const application = await applicationService.get(context.guildId, id);
  if (!application) throw new Error("Application not found");
  const status = ({ approve: ApplicationStatus.APPROVED, reject: ApplicationStatus.REJECTED, trial: ApplicationStatus.TRIAL } as const)[subcommand as "approve" | "reject" | "trial"];
  const updated = await applicationService.transition(context.guildId, id, status, interaction.user.id);
  if (status === ApplicationStatus.APPROVED && interaction.guild) {
    await syncApprovedMemberRoles(interaction.guild, context.guildId, application.member.discordUserId);
  }
  await syncApplicationCard(interaction.guild, application, status, interaction.user.id);
  await interaction.reply(`Application \`${updated.id}\` is now **${updated.status}**.`);
}

// ---------------------------------------------------------------------
// Click-to-apply: a pinned post with buttons, in the applications guide
// channel (see /setup and /config channel). Reactions can't open a Discord
// form (only a button or select menu can), so this is button -> modal.
// ---------------------------------------------------------------------

const applyGuideText = [
  "**How to apply**",
  "• Press **Apply to a core** below, pick the raid core (you can apply to more than one, one at a time).",
  "• A short form pops up — fill it in and submit.",
  "• An officer will review it and follow up."
].join("\n");

function applyGuideComponents() {
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`${APPLY_PREFIX}core`).setLabel("Apply to a core").setStyle(ButtonStyle.Primary)
  )];
}

// Idempotent: does nothing if a guide post with this button already exists
// among the channel's pinned messages (safe to call again from /config channel).
export async function ensureApplyGuide(channel: GuildTextBasedChannel): Promise<void> {
  const pins = await channel.messages.fetchPinned().catch(() => null);
  const already = pins?.some((message) => message.components.some((row) => "components" in row && row.components.some((c) => "customId" in c && c.customId === `${APPLY_PREFIX}core`)));
  if (already) return;
  const message = await channel.send({ content: applyGuideText, components: applyGuideComponents() });
  await message.pin().catch(() => undefined);
}

function applicationModal(core: { id: string; name: string }) {
  const input = (id: string, label: string, placeholder: string) =>
    new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId(id).setLabel(label).setPlaceholder(placeholder).setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100));
  return new ModalBuilder()
    .setCustomId(`${APPLY_PREFIX}submit:${core.id}`)
    .setTitle(`Apply to ${core.name}`.slice(0, 45))
    .addComponents(
      input("character", "Character name", "Thrall"),
      input("class", "Class", "Warrior"),
      input("spec", "Specialization", "Protection"),
      input("experience", "Raid experience", "Cleared MC/BWL in Classic"),
      input("availability", "Availability", "Tue/Thu/Sun 8-11pm server time")
    );
}

// A best-effort match to the known class list (case-insensitive); free text
// otherwise, since a modal field can't be a dropdown.
function matchClass(typed: string): string {
  const trimmed = typed.trim();
  return CLASSES.find((name) => name.toLowerCase() === trimmed.toLowerCase()) ?? trimmed;
}

// Approve / Trial / Reject on the applications-channel card: officers click
// instead of typing /application approve|reject|trial. Whoever gets there
// first wins — transition() itself refuses a second decision on the same
// application, so two officers clicking at once can't both "win".
async function handleApplyDecision(interaction: ButtonInteraction, decision: string, id: string): Promise<void> {
  if (!interaction.guild) return;
  if (!interaction.member || !hasPermission(interaction.member as Parameters<typeof hasPermission>[0], "officer")) {
    await interaction.reply({ content: "Only officers, Guild Masters, or administrators can review applications.", ephemeral: true });
    return;
  }
  const status = ({ approve: ApplicationStatus.APPROVED, reject: ApplicationStatus.REJECTED, trial: ApplicationStatus.TRIAL } as const)[decision as "approve" | "reject" | "trial"];
  if (!status) return;
  const guild = await guildService.ensureGuild(interaction.guild.id, interaction.guild.name);
  const application = await applicationService.get(guild.id, id);
  if (!application) {
    await interaction.reply({ content: "That application no longer exists.", ephemeral: true });
    return;
  }
  try {
    const updated = await applicationService.transition(guild.id, id, status, interaction.user.id);
    if (status === ApplicationStatus.APPROVED) await syncApprovedMemberRoles(interaction.guild, guild.id, application.member.discordUserId);
    await interaction.update({
      embeds: [applicationEmbed(application, application.member.discordUserId, { status: updated.status, by: interaction.user.id })],
      components: []
    });
  } catch (error) {
    await interaction.reply({ content: error instanceof Error ? error.message : "Could not update the application.", ephemeral: true }).catch(() => undefined);
  }
}

export async function handleApplyButton(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.guild) return;
  const suffix = interaction.customId.slice(APPLY_PREFIX.length);
  if (suffix.startsWith("decide:")) {
    const [, decision, id] = suffix.split(":");
    if (decision && id) await handleApplyDecision(interaction, decision, id);
    return;
  }
  // The "Apply" button on a core's own roster message: straight to that
  // core's form, no "which core?" picker needed.
  if (suffix.startsWith("roster:")) {
    const coreId = suffix.slice("roster:".length);
    const core = await prisma.raidCore.findUnique({ where: { id: coreId }, select: { id: true, name: true } });
    if (!core) {
      await interaction.reply({ content: "That core no longer exists.", ephemeral: true });
      return;
    }
    await interaction.showModal(applicationModal(core));
    return;
  }
  if (suffix !== "core") return;
  const guild = await guildService.ensureGuild(interaction.guild.id, interaction.guild.name);
  const cores = await prisma.raidCore.findMany({ where: { guildId: guild.id }, select: { id: true, name: true }, orderBy: { name: "asc" }, take: 25 });
  if (cores.length === 0) {
    await interaction.reply({ content: "There are no raid cores yet. Ask an officer to create one with `/core create`.", ephemeral: true });
    return;
  }
  const select = new StringSelectMenuBuilder().setCustomId(`${APPLY_PREFIX}core-pick`).setPlaceholder("Pick a raid core")
    .addOptions(cores.map((c) => ({ label: c.name.slice(0, 100), value: c.id })));
  await interaction.reply({ content: "Which core are you applying to?", components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)], ephemeral: true });
}

export async function handleApplySelect(interaction: StringSelectMenuInteraction): Promise<void> {
  if (interaction.customId !== `${APPLY_PREFIX}core-pick`) return;
  const coreId = interaction.values[0];
  const core = coreId ? await prisma.raidCore.findUnique({ where: { id: coreId }, select: { id: true, name: true } }) : null;
  if (!core) {
    await interaction.update({ content: "That core no longer exists. Press **Apply to a core** again.", components: [] });
    return;
  }
  await interaction.showModal(applicationModal(core));
}

export async function handleApplyModal(interaction: ModalSubmitInteraction): Promise<void> {
  if (!interaction.guild) return;
  await interaction.deferReply({ ephemeral: true });
  try {
    const guild = await guildService.ensureGuild(interaction.guild.id, interaction.guild.name);
    const member = await guildService.ensureMember(guild.id, interaction.user.id, (interaction.member as GuildMember | null)?.displayName ?? interaction.user.username);
    const coreId = interaction.customId.slice(`${APPLY_PREFIX}submit:`.length);
    const core = await coreService.byIdOrName(guild.id, coreId);
    const application = await applicationService.create({
      guildId: guild.id, memberId: member.id,
      character: interaction.fields.getTextInputValue("character"),
      className: matchClass(interaction.fields.getTextInputValue("class")),
      spec: interaction.fields.getTextInputValue("spec"),
      experience: interaction.fields.getTextInputValue("experience"),
      availability: interaction.fields.getTextInputValue("availability"),
      coreId: core.id
    });
    await announceApplication(interaction.guild, interaction.user.id, application);
    await interaction.editReply({ content: `Application submitted for **${core.name}**. Your application ID is \`${application.id}\`. An officer will follow up.` });
  } catch (error) {
    await interaction.editReply({ content: error instanceof Error ? error.message : "Could not submit the application." });
  }
}
