import { welcomeCardFile } from "./welcome-card.js";
import { hostedPilot } from "../hosted-pilot.js";
import { PILOT_DENIED } from "./pilot-policy.js";
import { type ButtonInteraction, type Guild as DiscordGuild, type GuildMember, type PartialGuildMember, MessageFlags } from "discord.js";
import type { GuildSettings } from "../generated/prisma/client.js";
import { prisma } from "../database.js";
import { createGuildService } from "./guild.js";
import { isPermissionRole, type Permission } from "../permissions.js";
import { currentGuildScope } from "./guild-scope.js";
import { asLang, t } from "../i18n.js";
import { linkedCharactersRow } from "./companion-link-dm.js";
import { onboardingButtons, rulesGateActive, rulesPending, rulesPrompt } from "./onboarding.js";
import { findWowRoleId } from "./invite-channel.js";
import { selfRoleProblem } from "./selfrole.js";

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

// The officer log only follows the WoW guild's people, not everyone who joins the Discord
// server: someone counts once they hold the Member role or a leadership role (Guild Master,
// Officer, Raid Leader, DKP Officer, Loot Leader, Class Leader, a per-class leader). A new
// arrival has no roles yet, so their line comes when they *get* one (handleMemberRolesChange),
// and a leave is logged only for someone who held one. Returns that role's name, or null.
const GUILD_PERMISSIONS: Permission[] = ["guildMaster", "officer", "raidLeader", "dkpOfficer", "lootLeader", "classLeader"];
export function guildRoleOf(roles: { id: string; name: string }[], memberRoleId: string | null | undefined): string | null {
  memberRoleId = currentGuildScope()?.memberRoleId ?? memberRoleId;
  const found = roles.find((role) => (memberRoleId && role.id === memberRoleId)
    || GUILD_PERMISSIONS.some((permission) => isPermissionRole(permission, role)));
  return found?.name ?? null;
}

const rolesOf = (member: GuildMember | PartialGuildMember) => [...member.roles.cache.values()].map((role) => ({ id: role.id, name: role.name }));

// Someone just received their first guild role (Member or leadership): log them joining the roster.
export async function handleMemberRolesChange(discordGuild: DiscordGuild, before: GuildMember | PartialGuildMember, after: GuildMember): Promise<void> {
  const settings = await guildService.getSettings((await guildService.ensureGuild(discordGuild.id, discordGuild.name)).id);
  // Without the "before" roles (not cached) there is no way to tell what is new: say nothing.
  if (before.partial) return;
  const had = guildRoleOf(rolesOf(before), settings?.memberRoleId);
  const has = guildRoleOf(rolesOf(after), settings?.memberRoleId);
  if (!had && has) await postToLogChannel(discordGuild, `Joined the guild: ${after.user.tag} (${after.id}) got the ${has} role.`);
  if (had && !has) await postToLogChannel(discordGuild, `Left the guild roles: ${after.user.tag} (${after.id}) no longer has ${had}.`);
}

export async function handleMemberJoin(discordGuild: DiscordGuild, member: GuildMember): Promise<void> {
  const guild = await guildService.ensureGuild(discordGuild.id, discordGuild.name);
  const settings = await guildService.getSettings(guild.id);
  if (!settings) return;
  // Not logged here: a new arrival has no guild role yet (see guildRoleOf).

  // With the rules gate on, the applicant role waits until the rules are accepted (onboarding.ts).
  if (settings.applicantRoleId && !rulesGateActive(settings)) {
    await member.roles.add(settings.applicantRoleId).catch((error: unknown) => {
      console.error(`Failed to assign applicant role to ${member.id}`, error);
    });
  }

  await sendWelcome(discordGuild, member, settings);
}

export type WelcomeDelivery = "CHANNEL" | "DM" | "BOTH";
export const WELCOME_ROLE_PREFIX = "welcomerole:";

export function welcomeDelivery(settings: Pick<GuildSettings, "welcomeDelivery">): WelcomeDelivery {
  return settings.welcomeDelivery === "DM" || settings.welcomeDelivery === "BOTH" ? settings.welcomeDelivery : "CHANNEL";
}

// Welcome is on when it has somewhere to go: a channel (CHANNEL/BOTH) or DMs.
export function welcomeEnabled(settings: Pick<GuildSettings, "welcomeDelivery" | "welcomeChannelId">): boolean {
  const delivery = welcomeDelivery(settings);
  return delivery !== "CHANNEL" || !!settings.welcomeChannelId;
}

// The welcome message: text plus the onboarding buttons (rules, games, pairing, first steps).
// Button ids carry the server id so they also work in DMs.
export function buildWelcomeMessage(
  settings: Pick<GuildSettings, "welcomeMessageTemplate" | "welcomeRoleIds" | "rulesChannelId"> & { language?: string | null },
  discordGuild: Pick<DiscordGuild, "id" | "name" | "memberCount">,
  member: { id: string; username: string }
) {
  const lang = asLang(settings.language);
  const text = renderTemplate(settings.welcomeMessageTemplate ?? t(lang, "welcome.default"), {
    mention: `<@${member.id}>`,
    username: member.username,
    guildName: discordGuild.name,
    memberCount: discordGuild.memberCount
  });
  return { content: text, components: [onboardingButtons(settings, discordGuild.id, lang)] };
}

// Sends the welcome to the channel, the member's DMs, or both. A closed DM
// falls back to the channel when there is one.
export async function sendWelcome(discordGuild: DiscordGuild, member: GuildMember, settings: GuildSettings): Promise<{ channel: boolean; dm: boolean }> {
  const result = { channel: false, dm: false };
  if (!welcomeEnabled(settings)) return result;
  const delivery = welcomeDelivery(settings);
  const message = buildWelcomeMessage(settings, discordGuild, { id: member.id, username: member.user.username });
  // 9.3: the same welcome, with a card picture (avatar, role, first steps) when one can be drawn.
  const card = await welcomeCardFile(discordGuild, member, settings.language);
  const files = card ? [card] : [];
  if (delivery !== "CHANNEL") {
    result.dm = await member.send({ ...message, ...(files.length ? { files } : {}), components: [...message.components, linkedCharactersRow(asLang(settings.language))] }).then(() => true).catch(() => false);
  }
  if ((delivery !== "DM" || !result.dm) && settings.welcomeChannelId) {
    const channel = await discordGuild.channels.fetch(settings.welcomeChannelId).catch(() => null);
    if (channel?.isTextBased()) {
      result.channel = await channel.send({ ...message, ...(files.length ? { files } : {}), allowedMentions: { users: [member.id] } })
        .then(() => true)
        .catch((error: unknown) => { console.error("Failed to send welcome message", error); return false; });
    }
  }
  return result;
}

// Clicks on the role buttons of a welcome message sent before the game menu existed: toggles that role for
// whoever clicked. Only roles still listed in the welcome settings are
// honoured, so an old message can't hand out a role that was removed.
// The click is acknowledged before any Discord or database call: answering after them could miss Discord's
// 3-second window ("This interaction failed", error 10062) even though the role was given, and members then
// clicked again, which toggled the game role straight back off (owner report, 7 November 2026).
export async function handleWelcomeRoleButton(interaction: ButtonInteraction): Promise<void> {
  const [discordGuildId, roleId] = interaction.customId.slice(WELCOME_ROLE_PREFIX.length).split(":");
  if (!discordGuildId || !roleId) return;
  if (!hostedPilot.allows(discordGuildId)) { await interaction.reply({ content: PILOT_DENIED, flags: MessageFlags.Ephemeral }); return; }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const discordGuild = await interaction.client.guilds.fetch(discordGuildId).catch(() => null);
  if (!discordGuild) {
    await interaction.editReply({ content: "I'm no longer in that server." });
    return;
  }
  // A slow or failing database must not cost a member their game role: the role checks below still apply.
  const loaded = await (async () => {
    const guild = await guildService.ensureGuild(discordGuild.id, discordGuild.name);
    return { guild, settings: await guildService.getSettings(guild.id) };
  })().catch((error: unknown) => { console.error("Welcome role button: settings unavailable", error); return null; });
  const settings = loaded?.settings ?? null;
  const role = await discordGuild.roles.fetch(roleId).catch(() => null);
  if (!role || !welcomeRoleOffered(settings, discordGuild, role)) {
    await interaction.editReply({ content: "That choice isn't offered anymore. Ask an officer." });
    return;
  }
  const member = await discordGuild.members.fetch(interaction.user.id).catch(() => null);
  if (!member) {
    await interaction.editReply({ content: `You're not in ${discordGuild.name} anymore.` });
    return;
  }
  if (loaded && settings && await rulesPending(loaded.guild.id, settings, member.id).catch(() => false)) {
    await interaction.editReply(rulesPrompt(settings, discordGuild.id, asLang(settings.language), true));
    return;
  }
  const had = member.roles.cache.has(role.id);
  try {
    if (had) await member.roles.remove(role, "Welcome role button");
    else await member.roles.add(role, "Welcome role button");
  } catch {
    await interaction.editReply({ content: `I couldn't change "${role.name}". An officer needs to move my role above it (Server Settings > Roles).` });
    return;
  }
  const lang = asLang(settings?.language);
  await interaction.editReply({ content: t(lang, had ? "welcome.removed" : "welcome.added", { role: role.name }) });
}

// A welcome button's role is honoured when the settings still offer it, or when it is the server's World of Warcraft
// role (owner report, 7 November 2026: WoW picks failed). Either way the role must be harmless to self-assign.
export function welcomeRoleOffered(
  settings: Pick<GuildSettings, "welcomeRoleIds" | "inviteWowRoleId"> | null,
  discordGuild: Pick<DiscordGuild, "id"> & { roles: { cache: { values(): Iterable<{ id: string; name: string }> } } },
  role: { id: string; name: string; managed: boolean; permissions: { bitfield: bigint } }
): boolean {
  if (selfRoleProblem({ id: role.id, managed: role.managed, permissions: role.permissions.bitfield }, discordGuild.id)) return false;
  if (settings?.welcomeRoleIds.includes(role.id)) return true;
  return findWowRoleId(discordGuild.roles.cache.values(), settings?.inviteWowRoleId) === role.id;
}

export async function handleMemberLeave(discordGuild: DiscordGuild, member: GuildMember | PartialGuildMember): Promise<void> {
  const guild = await guildService.ensureGuild(discordGuild.id, discordGuild.name);
  const settings = await guildService.getSettings(guild.id);
  const username = member.user?.username ?? "A member";
  // Only guild people are logged. When Discord did not keep their roles (not cached), a linked
  // WoW character in the database stands in for "was in the guild".
  let guildRole = guildRoleOf(rolesOf(member), settings?.memberRoleId);
  if (!guildRole && member.partial) {
    const linked = await prisma.member.findFirst({ where: { guildId: guild.id, discordUserId: member.id, characters: { some: {} } }, select: { id: true } });
    if (linked) guildRole = "a linked character";
  }
  if (guildRole) await postToLogChannel(discordGuild, `Member left: ${member.user?.tag ?? username} (${member.id}), had ${guildRole}.`);
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
