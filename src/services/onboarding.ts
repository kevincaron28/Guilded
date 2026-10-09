import { hostedPilot } from "../hosted-pilot.js";
import { PILOT_DENIED } from "./pilot-policy.js";
import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, StringSelectMenuBuilder,
  type ButtonInteraction, type Client, type Guild as DiscordGuild, type GuildMember, type GuildTextBasedChannel,
  type Role, type StringSelectMenuInteraction
} from "discord.js";
import type { GuildSettings } from "@prisma/client";
import { prisma } from "../database.js";
import { createGuildService } from "./guild.js";
import { issueCharacterPairingCode } from "./character-pairing.js";
import { selfRoleProblem } from "./selfrole.js";
import { asLang, t, type Lang } from "../i18n.js";

// Onboarding: the buttons a new member gets on the welcome message and on the pinned panel of
// the welcome channel. Every answer is private (ephemeral), so nothing depends on open DMs:
//   rules   where the rules are, and "I have read them" (recorded in MemberOnboarding)
//   games   a menu of the roles picked in /setup (one role per game opens that game's section)
//   pair    a companion pairing code, the same one /character pair gives
//   steps   a personal checklist of the three above
// With the rules gate on, games and pairing wait until the rules are accepted, and the applicant
// role is given at that moment instead of on join. Button ids carry the server id so the same
// buttons work in a private message.

const guildService = createGuildService(prisma);
// Exported so tests can stub settings lookups.
export const onboardingGuildService = guildService;

export const ONBOARD_PREFIX = "onboard:";
export const MAX_ONBOARDING_ROLES = 25;
const NUDGE_AFTER_MS = 24 * 60 * 60 * 1000;
// Someone who joined long before the reminder was turned on is left alone.
const NUDGE_UNTIL_MS = 72 * 60 * 60 * 1000;
const NUDGES_PER_RUN = 25;

type Action = "rules" | "accept" | "games" | "pick" | "pair" | "steps";
const customId = (action: Action, discordGuildId: string) => `${ONBOARD_PREFIX}${action}:${discordGuildId}`;

type StepSettings = Pick<GuildSettings, "welcomeRoleIds" | "rulesChannelId">;

// Each step: done, not done, or null when this server does not use it.
export interface OnboardingProgress { rules: boolean | null; games: boolean | null; character: boolean }

export function rulesGateActive(settings: Pick<GuildSettings, "rulesGate" | "rulesChannelId">): boolean {
  return settings.rulesGate && !!settings.rulesChannelId;
}

// A server with no game roles is a WoW guild: there, linking a character is the step to finish.
// With game roles, the bot cannot tell who plays WoW, so the character step stays optional.
export function onboardingIncomplete(progress: OnboardingProgress): boolean {
  return progress.rules === false || progress.games === false || (progress.games === null && !progress.character);
}

export function onboardingButtons(settings: StepSettings, discordGuildId: string, lang: Lang): ActionRowBuilder<ButtonBuilder> {
  const row = new ActionRowBuilder<ButtonBuilder>();
  const add = (action: Action, key: Parameters<typeof t>[1], style: ButtonStyle) =>
    row.addComponents(new ButtonBuilder().setCustomId(customId(action, discordGuildId)).setLabel(t(lang, key)).setStyle(style));
  if (settings.rulesChannelId) add("rules", "onboard.button.rules", ButtonStyle.Primary);
  if (settings.welcomeRoleIds.length > 0) add("games", "onboard.button.games", ButtonStyle.Primary);
  add("pair", "onboard.button.pair", ButtonStyle.Secondary);
  add("steps", "onboard.button.steps", ButtonStyle.Success);
  return row;
}

export function checklistText(progress: OnboardingProgress, lang: Lang, guildName: string): string {
  const mark = (done: boolean) => (done ? "✅" : "⬜");
  const lines = [t(lang, "onboard.steps.title", { guild: guildName })];
  if (progress.rules !== null) lines.push(`${mark(progress.rules)} ${t(lang, "onboard.steps.rules")}`);
  if (progress.games !== null) lines.push(`${mark(progress.games)} ${t(lang, "onboard.steps.games")}`);
  lines.push(`${mark(progress.character)} ${t(lang, progress.games === null ? "onboard.steps.character" : "onboard.steps.characterOptional")}`);
  lines.push("", t(lang, onboardingIncomplete(progress) ? "onboard.steps.next" : "onboard.steps.done"));
  return lines.join("\n");
}

// The pinned panel of the welcome channel.
export function welcomePanel(settings: StepSettings, discordGuild: Pick<DiscordGuild, "id" | "name">, lang: Lang) {
  const lines = [t(lang, "onboard.panel.intro", { guild: discordGuild.name }), ""];
  if (settings.rulesChannelId) lines.push(t(lang, "onboard.panel.rules", { channel: `<#${settings.rulesChannelId}>` }));
  if (settings.welcomeRoleIds.length > 0) lines.push(t(lang, "onboard.panel.games"));
  lines.push(t(lang, "onboard.panel.pair"), t(lang, "onboard.panel.steps"));
  return {
    embeds: [new EmbedBuilder().setTitle(t(lang, "onboard.panel.title")).setColor(0xd4af37).setDescription(lines.join("\n"))],
    components: [onboardingButtons(settings, discordGuild.id, lang)]
  };
}

const PANEL_TITLES = new Set([t("en", "onboard.panel.title"), t("fr", "onboard.panel.title")]);
type PanelMessage = { embeds: { title: string | null; description: string | null }[]; components: unknown[] };
const buttonCount = (row: unknown) => (row as { components?: unknown[] } | undefined)?.components?.length;
const isPanel = (message: PanelMessage) => message.embeds.some((embed) => !!embed.title && PANEL_TITLES.has(embed.title));
function panelIsCurrent(message: PanelMessage, panel: ReturnType<typeof welcomePanel>): boolean {
  return message.embeds[0]?.title === panel.embeds[0]?.data.title
    && message.embeds[0]?.description === panel.embeds[0]?.data.description
    && buttonCount(message.components[0]) === panel.components[0]?.components.length;
}

export async function welcomePanelState(channel: GuildTextBasedChannel, settings: StepSettings, lang: Lang): Promise<"current" | "outdated" | "missing"> {
  const pins = await channel.messages.fetchPinned().catch(() => null);
  const existing = pins?.find((message) => isPanel(message));
  if (!existing) return "missing";
  return panelIsCurrent(existing, welcomePanel(settings, channel.guild, lang)) ? "current" : "outdated";
}

// Pins the panel, or brings the pinned one up to date. Safe to call again.
export async function ensureWelcomePanel(channel: GuildTextBasedChannel, settings: StepSettings, lang: Lang): Promise<void> {
  const panel = welcomePanel(settings, channel.guild, lang);
  const pins = await channel.messages.fetchPinned().catch(() => null);
  const existing = pins?.find((message) => isPanel(message));
  if (existing) {
    if (existing.editable && !panelIsCurrent(existing, panel)) await existing.edit(panel);
    return;
  }
  const message = await channel.send(panel);
  await message.pin().catch(() => undefined);
}

// Roles a member may give themselves: still listed in the settings, still existing, and harmless.
function offeredRoles(settings: Pick<GuildSettings, "welcomeRoleIds">, discordGuild: DiscordGuild): Role[] {
  return settings.welcomeRoleIds
    .map((id) => discordGuild.roles.cache.get(id))
    .filter((role): role is Role => !!role && !selfRoleProblem({ id: role.id, managed: role.managed, permissions: role.permissions.bitfield }, discordGuild.id))
    .slice(0, MAX_ONBOARDING_ROLES);
}

export async function rulesAccepted(guildId: string, discordUserId: string): Promise<boolean> {
  const state = await prisma.memberOnboarding.findUnique({ where: { guildId_discordUserId: { guildId, discordUserId } } });
  return !!state?.rulesAcceptedAt;
}

// True when this member must accept the rules before doing anything else.
export async function rulesPending(guildId: string, settings: Pick<GuildSettings, "rulesGate" | "rulesChannelId">, discordUserId: string): Promise<boolean> {
  return rulesGateActive(settings) && !(await rulesAccepted(guildId, discordUserId));
}

async function loadProgress(guildId: string, settings: GuildSettings, member: GuildMember): Promise<OnboardingProgress> {
  const roles = offeredRoles(settings, member.guild);
  return {
    rules: settings.rulesChannelId ? await rulesAccepted(guildId, member.id) : null,
    games: roles.length > 0 ? roles.some((role) => member.roles.cache.has(role.id)) : null,
    character: (await prisma.character.count({ where: { member: { guildId, discordUserId: member.id } } })) > 0
  };
}

export function rulesPrompt(settings: Pick<GuildSettings, "rulesChannelId">, discordGuildId: string, lang: Lang, first = false) {
  return {
    content: `${first ? `${t(lang, "onboard.rules.first")}\n` : ""}${t(lang, "onboard.rules.prompt", { channel: `<#${settings.rulesChannelId}>` })}`,
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(customId("accept", discordGuildId)).setLabel(t(lang, "onboard.button.accept")).setStyle(ButtonStyle.Success))]
  };
}

// Clicks on the onboarding buttons and the game menu.
export async function handleOnboardingInteraction(interaction: ButtonInteraction | StringSelectMenuInteraction): Promise<void> {
  const [action, discordGuildId] = interaction.customId.slice(ONBOARD_PREFIX.length).split(":") as [Action, string | undefined];
  if (!discordGuildId) return;
  if (!hostedPilot.allows(discordGuildId)) { await interaction.reply({ content: PILOT_DENIED, ephemeral: true }); return; }
  const discordGuild = interaction.guild?.id === discordGuildId
    ? interaction.guild
    : await interaction.client.guilds.fetch(discordGuildId).catch(() => null);
  if (!discordGuild) {
    await interaction.reply({ content: "I'm no longer in that server.", ephemeral: true });
    return;
  }
  const member = await discordGuild.members.fetch(interaction.user.id).catch(() => null);
  if (!member) {
    await interaction.reply({ content: `You're not in ${discordGuild.name} anymore.`, ephemeral: true });
    return;
  }
  const guild = await guildService.ensureGuild(discordGuild.id, discordGuild.name);
  const settings = await guildService.getSettings(guild.id);
  if (!settings) return;
  const lang = asLang(settings.language);
  const buttons = () => onboardingButtons(settings, discordGuild.id, lang);
  const checklist = async (progress?: OnboardingProgress) =>
    checklistText(progress ?? await loadProgress(guild.id, settings, member), lang, discordGuild.name);

  if (action === "steps") {
    await interaction.reply({ content: await checklist(), components: [buttons()], ephemeral: true });
    return;
  }

  if (action === "rules") {
    if (!settings.rulesChannelId) {
      await interaction.reply({ content: t(lang, "onboard.gone"), ephemeral: true });
    } else if (await rulesAccepted(guild.id, member.id)) {
      await interaction.reply({ content: `${t(lang, "onboard.rules.already", { channel: `<#${settings.rulesChannelId}>` })}\n\n${await checklist()}`, components: [buttons()], ephemeral: true });
    } else {
      await interaction.reply({ ...rulesPrompt(settings, discordGuild.id, lang), ephemeral: true });
    }
    return;
  }

  if (action === "accept") {
    const key = { guildId_discordUserId: { guildId: guild.id, discordUserId: member.id } };
    const state = await prisma.memberOnboarding.findUnique({ where: key });
    if (!state?.rulesAcceptedAt) {
      await prisma.memberOnboarding.upsert({
        where: key,
        create: { guildId: guild.id, discordUserId: member.id, rulesAcceptedAt: new Date() },
        update: { rulesAcceptedAt: new Date() }
      });
    }
    // With the gate on, the applicant role was held back on join: it comes now. Someone who is
    // already a member of the guild does not go back to applicant.
    let roleNote = "";
    if (rulesGateActive(settings) && settings.applicantRoleId && !member.roles.cache.has(settings.applicantRoleId)
      && !(settings.memberRoleId && member.roles.cache.has(settings.memberRoleId))) {
      await member.roles.add(settings.applicantRoleId, "Rules accepted").catch((error: unknown) => {
        console.error(`Failed to assign applicant role to ${member.id}`, error);
        roleNote = `\n${t(lang, "onboard.roleFailed")}`;
      });
    }
    const progress = { ...await loadProgress(guild.id, settings, member), rules: true };
    await interaction.reply({ content: `${t(lang, "onboard.rules.thanks")}${roleNote}\n\n${await checklist(progress)}`, components: [buttons()], ephemeral: true });
    return;
  }

  if (await rulesPending(guild.id, settings, member.id)) {
    await interaction.reply({ ...rulesPrompt(settings, discordGuild.id, lang, true), ephemeral: true });
    return;
  }

  if (action === "games") {
    const roles = offeredRoles(settings, discordGuild);
    if (roles.length === 0) {
      await interaction.reply({ content: t(lang, "onboard.gone"), ephemeral: true });
      return;
    }
    const menu = new StringSelectMenuBuilder().setCustomId(customId("pick", discordGuild.id))
      .setPlaceholder(t(lang, "onboard.games.placeholder")).setMinValues(0).setMaxValues(roles.length)
      .addOptions(roles.map((role) => ({ label: role.name.slice(0, 100), value: role.id, default: member.roles.cache.has(role.id) })));
    await interaction.reply({
      content: settings.welcomeRolePrompt ?? t(lang, "onboard.games.prompt"),
      components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(menu)],
      ephemeral: true
    });
    return;
  }

  if (action === "pick" && interaction.isStringSelectMenu()) {
    const roles = offeredRoles(settings, discordGuild);
    const wanted = new Set(interaction.values);
    const failed: string[] = [];
    for (const role of roles) {
      const had = member.roles.cache.has(role.id);
      if (had === wanted.has(role.id)) continue;
      try {
        if (had) await member.roles.remove(role, "Onboarding game menu");
        else await member.roles.add(role, "Onboarding game menu");
      } catch {
        failed.push(role.name);
      }
    }
    const picked = roles.filter((role) => wanted.has(role.id) && !failed.includes(role.name));
    const progress = { ...await loadProgress(guild.id, settings, member), games: picked.length > 0 };
    const lines = [picked.length ? t(lang, "onboard.games.saved", { roles: picked.map((role) => `**${role.name}**`).join(", ") }) : t(lang, "onboard.games.none")];
    if (failed.length) lines.push(t(lang, "onboard.games.failed", { roles: failed.join(", ") }));
    await interaction.update({ content: `${lines.join("\n")}\n\n${await checklist(progress)}`, components: [buttons()] });
    return;
  }

  if (action === "pair") {
    const record = await guildService.ensureMember(guild.id, member.id, member.user.username);
    const pairing = await issueCharacterPairingCode(prisma, guild.id, record.id);
    await interaction.reply({
      content: t(lang, "onboard.pair", { code: pairing.code, expires: `<t:${Math.floor(pairing.expiresAt.getTime() / 1000)}:R>` }),
      ephemeral: true
    });
  }
}

// One private reminder, a day after joining, to someone who has not finished. Marked before it
// is sent, so a closed DM or a crash never makes it repeat.
export async function runOnboardingNudges(client: Client, now = new Date()): Promise<number> {
  let sent = 0;
  for (const discordGuild of client.guilds.cache.values()) {
    if (!hostedPilot.allows(discordGuild.id)) continue;
    const guild = await guildService.ensureGuild(discordGuild.id, discordGuild.name);
    const settings = await guildService.getSettings(guild.id);
    if (!settings?.onboardingNudge) continue;
    const lang = asLang(settings.language);
    // The member cache is kept current by the GuildMembers intent; fetch only when incomplete.
    const members = discordGuild.members.cache.size >= discordGuild.memberCount ? discordGuild.members.cache : await discordGuild.members.fetch().catch(() => null);
    if (!members) continue;
    const due = [...members.values()].filter((member) => {
      const age = member.joinedTimestamp ? now.getTime() - member.joinedTimestamp : 0;
      return !member.user.bot && age >= NUDGE_AFTER_MS && age < NUDGE_UNTIL_MS;
    });
    let inGuild = 0;
    for (const member of due) {
      if (inGuild >= NUDGES_PER_RUN) break;
      const key = { guildId_discordUserId: { guildId: guild.id, discordUserId: member.id } };
      const state = await prisma.memberOnboarding.findUnique({ where: key });
      if (state?.nudgedAt) continue;
      const progress = await loadProgress(guild.id, settings, member);
      if (!onboardingIncomplete(progress)) continue;
      await prisma.memberOnboarding.upsert({ where: key, create: { guildId: guild.id, discordUserId: member.id, nudgedAt: now }, update: { nudgedAt: now } });
      inGuild += 1;
      const delivered = await member.send({
        content: `${t(lang, "onboard.nudge", { guild: discordGuild.name })}\n\n${checklistText(progress, lang, discordGuild.name)}`,
        components: [onboardingButtons(settings, discordGuild.id, lang)]
      }).then(() => true).catch(() => false);
      if (delivered) sent += 1;
    }
  }
  return sent;
}
