import { ApplicationStatus } from "@prisma/client";
import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, SlashCommandBuilder, StringSelectMenuBuilder, TextInputBuilder, TextInputStyle,
  type ButtonInteraction, type ChatInputCommandInteraction, type Guild as DiscordGuild, type GuildMember,
  type GuildTextBasedChannel, type ModalSubmitInteraction, type StringSelectMenuInteraction
} from "discord.js";
import { prisma } from "../database.js";
import { createApplicationService } from "../services/application.js";
import { createRaidCoreService } from "../services/raid-core.js";
import { syncApprovedMemberRoles } from "../services/housekeeping.js";
import { notify } from "../services/notify.js";
import { hasPermission } from "../permissions.js";
import { requireGuildContext, guildService } from "./context.js";
import { CLASSES } from "../wow-data.js";

export const applicationService = createApplicationService(prisma);
const coreService = createRaidCoreService(prisma);
export const APPLY_PREFIX = "apply-form:";

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

// Posts a short heads-up to the applications channel (falls back to the
// officer log); officers still review with /application list|view|approve.
export async function announceApplication(guild: DiscordGuild | null, applicantId: string, application: { id: string; character: string; className: string; core: { name: string } | null }): Promise<void> {
  const target = application.core ? ` for **${application.core.name}**` : "";
  await notify(guild, `📋 New application from <@${applicantId}> — **${application.character}** (${application.className})${target}. Review with \`/application view id:${application.id}\`.`, "application");
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

export async function handleApplyButton(interaction: ButtonInteraction): Promise<void> {
  if (!interaction.guild) return;
  if (interaction.customId.slice(APPLY_PREFIX.length) !== "core") return;
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
