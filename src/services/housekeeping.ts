import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder,
  type ButtonInteraction, type Guild as DiscordGuild, type GuildMember, type PartialGuildMember
} from "discord.js";
import type { GuildSettings } from "@prisma/client";
import { prisma } from "../database.js";
import { createGuildService } from "./guild.js";
import { asLang, t } from "../i18n.js";

const guildService = createGuildService(prisma);
// Exported so tests can stub settings lookups.
export const welcomeGuildService = guildService;

export const DEFAULT_WELCOME_TEMPLATE =
  "Welcome to {guild}, {mention}! Run `/apply` to submit a recruitment application, "
  + "or `/character add` to link a character if you're already a member. "
  + "Get the addon: https://www.curseforge.com/wow/addons/guilded";
export const DEFAULT_FAREWELL_TEMPLATE = "{username} has left {guild}. o7";

interface TemplateVars {
  mention: string;
  username: string;
  guildName: string;
  memberCount: number;
}

export function renderTemplate(template: string, vars: TemplateVars): string {
  return template
    .replace(/\{mention\}/g, vars.mention)
    .replace(/\{username\}/g, vars.username)
    .replace(/\{guild\}/g, vars.guildName)
    .replace(/\{membercount\}/g, String(vars.memberCount));
}

// Posts a plain-text line to the configured log channel, if any. Never pings
// anyone and never throws: logging must not be able to break the action that
// triggered it.
export async function postToLogChannel(discordGuild: DiscordGuild, content: string, kind: "log" | "craft" = "log"): Promise<void> {
  try {
    const guild = await guildService.ensureGuild(discordGuild.id, discordGuild.name);
    const settings = await guildService.getSettings(guild.id);
    // Craft requests go to the craft board when there is one, so crafters see them.
    const channelId = (kind === "craft" ? settings?.craftChannelId : null) ?? settings?.logChannelId;
    if (!channelId) return;
    const channel = await discordGuild.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased()) return;
    await channel.send({ content, allowedMentions: { parse: [] } });
  } catch (error) {
    console.error("Failed to post to log channel", error);
  }
}

export async function handleMemberJoin(discordGuild: DiscordGuild, member: GuildMember): Promise<void> {
  const guild = await guildService.ensureGuild(discordGuild.id, discordGuild.name);
  const settings = await guildService.getSettings(guild.id);
  if (!settings) return;
  await postToLogChannel(discordGuild, `Member joined: ${member.user.tag} (${member.id})`);

  if (settings.applicantRoleId) {
    await member.roles.add(settings.applicantRoleId).catch((error: unknown) => {
      console.error(`Failed to assign applicant role to ${member.id}`, error);
    });
  }

  await sendWelcome(discordGuild, member, settings);
}

export type WelcomeDelivery = "CHANNEL" | "DM" | "BOTH";
export const WELCOME_ROLE_PREFIX = "welcomerole:";
export const DEFAULT_WELCOME_ROLE_PROMPT = "Pick what you're here for (you can pick more than one, click again to remove):";

export function welcomeDelivery(settings: Pick<GuildSettings, "welcomeDelivery">): WelcomeDelivery {
  return settings.welcomeDelivery === "DM" || settings.welcomeDelivery === "BOTH" ? settings.welcomeDelivery : "CHANNEL";
}

// Welcome is on when it has somewhere to go: a channel (CHANNEL/BOTH) or DMs.
export function welcomeEnabled(settings: Pick<GuildSettings, "welcomeDelivery" | "welcomeChannelId">): boolean {
  const delivery = welcomeDelivery(settings);
  return delivery !== "CHANNEL" || !!settings.welcomeChannelId;
}

// The welcome message: text plus up to 5 role buttons ("which game are you
// here for?"). Button ids carry the server id so they also work in DMs.
export function buildWelcomeMessage(
  settings: Pick<GuildSettings, "welcomeMessageTemplate" | "welcomeRoleIds" | "welcomeRolePrompt"> & { language?: string | null },
  discordGuild: Pick<DiscordGuild, "id" | "name" | "memberCount" | "roles">,
  member: { id: string; username: string }
) {
  const lang = asLang(settings.language);
  const text = renderTemplate(settings.welcomeMessageTemplate ?? t(lang, "welcome.default"), {
    mention: `<@${member.id}>`,
    username: member.username,
    guildName: discordGuild.name,
    memberCount: discordGuild.memberCount
  });
  const roles = settings.welcomeRoleIds
    .map((id) => discordGuild.roles.cache.get(id))
    .filter((role): role is NonNullable<typeof role> => !!role)
    .slice(0, 5);
  if (roles.length === 0) return { content: text, components: [] };
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(roles.map((role) =>
    new ButtonBuilder()
      .setCustomId(`${WELCOME_ROLE_PREFIX}${discordGuild.id}:${role.id}`)
      .setLabel(role.name.slice(0, 80))
      .setStyle(ButtonStyle.Primary)));
  return {
    content: text,
    embeds: [new EmbedBuilder().setColor(0xd4af37).setDescription(settings.welcomeRolePrompt ?? t(lang, "welcome.rolePrompt"))],
    components: [row]
  };
}

// Sends the welcome to the channel, the member's DMs, or both. A closed DM
// falls back to the channel when there is one.
export async function sendWelcome(discordGuild: DiscordGuild, member: GuildMember, settings: GuildSettings): Promise<{ channel: boolean; dm: boolean }> {
  const result = { channel: false, dm: false };
  if (!welcomeEnabled(settings)) return result;
  const delivery = welcomeDelivery(settings);
  const message = buildWelcomeMessage(settings, discordGuild, { id: member.id, username: member.user.username });
  if (delivery !== "CHANNEL") {
    result.dm = await member.send(message).then(() => true).catch(() => false);
  }
  if ((delivery !== "DM" || !result.dm) && settings.welcomeChannelId) {
    const channel = await discordGuild.channels.fetch(settings.welcomeChannelId).catch(() => null);
    if (channel?.isTextBased()) {
      result.channel = await channel.send({ ...message, allowedMentions: { users: [member.id] } })
        .then(() => true)
        .catch((error: unknown) => { console.error("Failed to send welcome message", error); return false; });
    }
  }
  return result;
}

// Clicks on the welcome message's role buttons: toggles that role for
// whoever clicked. Only roles still listed in the welcome settings are
// honoured, so an old message can't hand out a role that was removed.
export async function handleWelcomeRoleButton(interaction: ButtonInteraction): Promise<void> {
  const [discordGuildId, roleId] = interaction.customId.slice(WELCOME_ROLE_PREFIX.length).split(":");
  if (!discordGuildId || !roleId) return;
  const discordGuild = await interaction.client.guilds.fetch(discordGuildId).catch(() => null);
  if (!discordGuild) {
    await interaction.reply({ content: "I'm no longer in that server.", ephemeral: true });
    return;
  }
  const guild = await guildService.ensureGuild(discordGuild.id, discordGuild.name);
  const settings = await guildService.getSettings(guild.id);
  const role = await discordGuild.roles.fetch(roleId).catch(() => null);
  if (!settings?.welcomeRoleIds.includes(roleId) || !role) {
    await interaction.reply({ content: "That choice isn't offered anymore. Ask an officer.", ephemeral: true });
    return;
  }
  const member = await discordGuild.members.fetch(interaction.user.id).catch(() => null);
  if (!member) {
    await interaction.reply({ content: `You're not in ${discordGuild.name} anymore.`, ephemeral: true });
    return;
  }
  const had = member.roles.cache.has(role.id);
  try {
    if (had) await member.roles.remove(role, "Welcome role button");
    else await member.roles.add(role, "Welcome role button");
  } catch {
    await interaction.reply({ content: `I couldn't change "${role.name}". An officer needs to move my role above it (Server Settings > Roles).`, ephemeral: true });
    return;
  }
  const lang = asLang(settings.language);
  await interaction.reply({ content: t(lang, had ? "welcome.removed" : "welcome.added", { role: role.name }), ephemeral: true });
}

export async function handleMemberLeave(discordGuild: DiscordGuild, member: GuildMember | PartialGuildMember): Promise<void> {
  const guild = await guildService.ensureGuild(discordGuild.id, discordGuild.name);
  const settings = await guildService.getSettings(guild.id);
  const username = member.user?.username ?? "A member";
  await postToLogChannel(discordGuild, `Member left: ${member.user?.tag ?? username} (${member.id})`);
  if (!settings?.farewellChannelId) return;

  const channel = await discordGuild.channels.fetch(settings.farewellChannelId).catch(() => null);
  if (!channel?.isTextBased()) return;

  const text = renderTemplate(settings.farewellMessageTemplate ?? DEFAULT_FAREWELL_TEMPLATE, {
    mention: username,
    username,
    guildName: discordGuild.name,
    memberCount: discordGuild.memberCount
  });
  await channel.send(text).catch((error: unknown) => console.error("Failed to send farewell message", error));
}

export async function syncApprovedMemberRoles(discordGuild: DiscordGuild, guildId: string, discordUserId: string): Promise<void> {
  const settings = await guildService.getSettings(guildId);
  if (!settings) return;
  const member = await discordGuild.members.fetch(discordUserId).catch(() => null);
  if (!member) return;

  if (settings.memberRoleId) {
    await member.roles.add(settings.memberRoleId).catch((error: unknown) => {
      console.error(`Failed to add member role to ${discordUserId}`, error);
    });
  }
  if (settings.applicantRoleId) {
    await member.roles.remove(settings.applicantRoleId).catch((error: unknown) => {
      console.error(`Failed to remove applicant role from ${discordUserId}`, error);
    });
  }
}
