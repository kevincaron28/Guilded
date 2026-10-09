import { pilotGuildScope } from "../hosted-pilot.js";
import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, ModalBuilder, PermissionFlagsBits, TextInputBuilder, TextInputStyle,
  type ButtonInteraction, type ChatInputCommandInteraction, type Client, type Guild as DiscordGuild, type GuildMember, type ModalSubmitInteraction,
  type GuildTextBasedChannel, type OverwriteResolvable, type StringSelectMenuInteraction
} from "discord.js";
import type { DungeonGroup, RaidRole } from "@prisma/client";
import { prisma } from "../database.js";
import { serializeDungeonGroup } from "../services/dungeon-group-queue.js";
import { hasPermission, isPermissionRoleName } from "../permissions.js";
import { asGroupKind, createDungeonGroupService, GROUP_CAPS, GROUP_KINDS, groupSize, shouldDeleteVoice, shouldDeleteClosedPost, shouldExpireOpenGroup, type GroupKind } from "../services/dungeon-group.js";
import { DUNGEON_GUIDE_CREATE_ID, DUNGEON_GUIDE_KIND_ID, LFG_ROLE_NAMES } from "../services/dungeon-guide.js";
import { alertRecipients, dungeonLevelsFromTitle, parseLevelRange, rolesFromTitle, type AlertGroup } from "../services/group-alerts.js";
import { guildService, requireGuildContext } from "./context.js";
import { BRAND } from "../brand.js";
import { asLang, tx, type Lang } from "../i18n.js";

// /dungeon group: a 5-player signup with Tank/Healer/DPS buttons. When it is
// full (or the leader presses Start) the bot creates a private temporary
// voice channel for the group and deletes it once it has been empty a few
// minutes or the group is closed.

const service = createDungeonGroupService(prisma);
export const DUNGEON_GROUP_PREFIX = "dgrp:";

// The form for a new group: what / when / who for every kind, and the group size for the kinds
// that are not a 5-player dungeon. The kind travels in the form's id ("dguide:create:PVP").
function dungeonGroupModal(lang: Lang, kind: GroupKind = "DUNGEON") {
  const info = GROUP_KINDS[kind];
  const input = new TextInputBuilder()
    .setCustomId("title")
    .setLabel(kind === "DUNGEON" ? tx(lang, "Dungeon, time, and roles needed") : tx(lang, "What, when, and who you need"))
    .setPlaceholder(kind === "DUNGEON" ? tx(lang, "e.g. Deadmines tonight, need tank and healer") : tx(lang, "e.g. Warsong Gulch at 9pm, level 60"))
    .setStyle(TextInputStyle.Short)
    .setMinLength(3)
    .setMaxLength(80)
    .setRequired(true);
  const modal = new ModalBuilder()
    .setCustomId(`${DUNGEON_GUIDE_CREATE_ID}:${kind}`)
    .setTitle(`${info.emoji} ${tx(lang, info.label)}`.slice(0, 45))
    .addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
  if (!info.roles) {
    modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder()
      .setCustomId("size").setLabel(tx(lang, "Group size ({min} to {max})", { min: info.minSize, max: info.maxSize }))
      .setPlaceholder(String(info.size)).setStyle(TextInputStyle.Short).setMaxLength(2).setRequired(false)));
  }
  // 5.0: the level range, for group alerts (empty: guessed from the dungeon in the title).
  modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder()
    .setCustomId("levels").setLabel(tx(lang, "Levels (optional)"))
    .setPlaceholder(tx(lang, "e.g. 55-60, or 60. Empty: guessed from the dungeon"))
    .setStyle(TextInputStyle.Short).setMaxLength(9).setRequired(false)));
  return modal;
}

// The pre-4.6 pinned button: a dungeon group.
export async function handleDungeonGuideButton(interaction: ButtonInteraction): Promise<void> {
  if (interaction.customId !== DUNGEON_GUIDE_CREATE_ID || !interaction.guild) return;
  const record = await guildService.ensureGuild(interaction.guild.id, interaction.guild.name);
  await interaction.showModal(dungeonGroupModal(await groupLang(record.id), "DUNGEON"));
}

// The pinned menu: the kind picked, then its form.
export async function handleDungeonGuideSelect(interaction: StringSelectMenuInteraction): Promise<void> {
  if (interaction.customId !== DUNGEON_GUIDE_KIND_ID || !interaction.guild) return;
  if (interaction.values[0] !== "DUNGEON") {
    await interaction.reply({ content: "The bot now forms dungeon groups only. Post PvP and leveling groups in their dedicated channels.", ephemeral: true });
    return;
  }
  const record = await guildService.ensureGuild(interaction.guild.id, interaction.guild.name);
  await interaction.showModal(dungeonGroupModal(await groupLang(record.id), asGroupKind(interaction.values[0])));
}

// The group's level range: the Levels box, else (dungeons and leveling) the dungeon in the title.
function groupLevels(kind: GroupKind, title: string, typed: string): { minLevel: number | null; maxLevel: number | null } {
  const range = parseLevelRange(typed) ?? (kind === "DUNGEON" || kind === "LEVELING" ? dungeonLevelsFromTitle(title) : null);
  return { minLevel: range?.min ?? null, maxLevel: range?.max ?? null };
}

// Posts a new group: the kind's "LFG" role is pinged (as before 5.0), plus the members whose
// group alerts fit it (kind, level, roles still needed), mentioned by name.
async function postGroup(
  guild: DiscordGuild, channel: GuildTextBasedChannel, group: { id: string; guildId: string; kind: string; title: string; status: DungeonGroup["status"]; minLevel: number | null; maxLevel: number | null },
  leaderDiscordId: string, lang: Lang
): Promise<void> {
  const kind = asGroupKind(group.kind);
  const ping = pingRoleId(guild, kind);
  const pingedByRole = new Set(ping ? guild.roles.cache.get(ping)?.members.map((m) => m.id) ?? [] : []);
  const users = await matchingAlertUsers(group.guildId, {
    kind, minLevel: group.minLevel, maxLevel: group.maxLevel, rolesNeeded: rolesFromTitle(group.title), leaderDiscordId
  }, pingedByRole);
  const mentions = [...(ping ? [`<@&${ping}>`] : []), ...users.map((id) => `<@${id}>`)];
  const message = await channel.send({
    ...(mentions.length ? { content: mentions.join(" ") } : {}),
    embeds: [await groupEmbed(group.id)],
    components: buttons(group.id, group.status, lang),
    allowedMentions: { roles: ping ? [ping] : [], users }
  });
  await service.setMessage(group.id, channel.id, message.id);
}

// The Discord ids of members whose alerts fit the group.
async function matchingAlertUsers(guildId: string, group: AlertGroup, alreadyPinged: Set<string>): Promise<string[]> {
  const alerts = await prisma.groupAlert.findMany({
    where: { guildId, kinds: { has: group.kind } },
    include: { member: { select: { discordUserId: true, characters: { select: { level: true } } } } }
  });
  return alertRecipients(group, alerts.map((alert) => ({
    discordUserId: alert.member.discordUserId, kinds: alert.kinds, roles: alert.roles, levels: alert.member.characters.map((c) => c.level)
  })), alreadyPinged);
}

// The role pinged for a kind (a role named e.g. "LFG PvP"), or null.
function pingRoleId(guild: DiscordGuild, kind: GroupKind): string | null {
  const name = LFG_ROLE_NAMES[kind].toLowerCase();
  return guild.roles.cache.find((role) => role.name.toLowerCase() === name)?.id ?? null;
}

export async function handleDungeonGuideModal(interaction: ModalSubmitInteraction): Promise<void> {
  if (!interaction.customId.startsWith(DUNGEON_GUIDE_CREATE_ID) || !interaction.guild) return;
  const kind = asGroupKind(interaction.customId.slice(DUNGEON_GUIDE_CREATE_ID.length + 1));
  const requestedKind = interaction.customId.slice(DUNGEON_GUIDE_CREATE_ID.length + 1);
  if (requestedKind && requestedKind !== "DUNGEON") {
    await interaction.reply({ content: "The bot now forms dungeon groups only. Use the dedicated channels for other groups.", ephemeral: true });
    return;
  }
  const askedSize = GROUP_KINDS[kind].roles ? null : Number(interaction.fields.fields.has("size") ? interaction.fields.getTextInputValue("size") : "") || null;
  await interaction.deferReply({ ephemeral: true });
  const guild = interaction.guild;
  const record = await guildService.ensureGuild(guild.id, guild.name);
  const member = await guildService.ensureMember(record.id, interaction.user.id,
    (interaction.member as GuildMember | null)?.displayName ?? interaction.user.username);
  const settings = await guildService.getSettings(record.id);
  const channel = settings?.dungeonSignupChannelId
    ? await guild.channels.fetch(settings.dungeonSignupChannelId).catch(() => null)
    : null;
  if (!channel?.isTextBased() || !("send" in channel)) {
    throw new Error("I can't post in the configured dungeon signups channel. Check /setup status and channel permissions.");
  }
  const lang = asLang(settings?.language);
  const title = interaction.fields.getTextInputValue("title").trim();
  const levels = groupLevels(kind, title, interaction.fields.fields.has("levels") ? interaction.fields.getTextInputValue("levels") : "");
  const group = await service.create({
    guildId: record.id,
    title,
    leaderId: member.id,
    channelId: channel.id,
    kind,
    size: askedSize,
    ...levels
  });
  await postGroup(guild, channel, group, interaction.user.id, lang);
  await interaction.editReply({
    content: tx(lang, "Posted your group in <#{id}>. You're the leader: pick your role with the buttons, and press **Start now** when ready (or it starts by itself at {size} players).", { id: channel.id, size: group.maxSize })
  });
}

const ROLE_LABELS: Record<Lang, Record<RaidRole, string>> = {
  en: { TANK: "🛡️ Tank", HEALER: "💚 Healer", DPS: "⚔️ DPS" },
  fr: { TANK: "🛡️ Tank", HEALER: "💚 Soigneur", DPS: "⚔️ DPS" }
};

async function groupLang(guildId: string): Promise<Lang> {
  return asLang((await guildService.getSettings(guildId))?.language);
}

async function groupEmbed(groupId: string): Promise<EmbedBuilder> {
  const group = await prisma.dungeonGroup.findUniqueOrThrow({ where: { id: groupId } });
  const lang = await groupLang(group.guildId);
  const T = (english: string, vars: Record<string, string | number> = {}) => tx(lang, english, vars);
  const ROLE_LABEL = ROLE_LABELS[lang];
  const signups = await service.members(groupId);
  const kind = asGroupKind(group.kind);
  const info = GROUP_KINDS[kind];
  const line = (role: RaidRole) => {
    const names = signups.filter((s) => s.role === role && s.status === "SIGNED_UP").map((s) => s.member.displayName);
    return `${names.length}${info.roles ? `/${GROUP_CAPS[role]}` : ""}${names.length ? ` — ${names.join(", ")}` : ""}`;
  };
  const waiting = signups.filter((s) => s.status === "WAITLISTED").map((s) => `${s.member.displayName} (${ROLE_LABEL[s.role]})`);
  const inGroup = signups.filter((s) => s.status === "SIGNED_UP").length;
  const embed = new EmbedBuilder()
    .setColor(group.status === "CLOSED" ? 0x808080 : 0xd4a017)
    .setTitle(`${info.emoji} ${group.title}`)
    .setDescription(tx(lang, info.label))
    .addFields(
      { name: ROLE_LABEL.TANK, value: line("TANK"), inline: true },
      { name: ROLE_LABEL.HEALER, value: line("HEALER"), inline: true },
      { name: ROLE_LABEL.DPS, value: line("DPS"), inline: true },
      { name: T("Status"), value: group.status === "OPEN" ? T("Open — {count}/{size}", { count: inGroup, size: group.maxSize }) : group.status === "STARTED" ? T("Started") : T("Closed"), inline: true },
      { name: T("Leader"), value: `<@${(await prisma.member.findUnique({ where: { id: group.leaderId }, select: { discordUserId: true } }))?.discordUserId ?? "0"}>`, inline: true }
    )
    .setFooter({ text: T("Group {id}", { id: group.id }) });
  if (group.minLevel !== null || group.maxLevel !== null) {
    const min = group.minLevel ?? 1, max = group.maxLevel ?? 80;
    embed.addFields({ name: T("Levels"), value: min === max ? String(min) : max >= 80 ? `${min}+` : `${min}-${max}`, inline: true });
  }
  if (waiting.length) embed.addFields({ name: T("Waitlist"), value: waiting.join(", ").slice(0, 1000) });
  if (group.voiceChannelId) embed.addFields({ name: T("Voice"), value: T("<#{id}> (private to the group; deleted when empty)", { id: group.voiceChannelId }) });
  return embed;
}

function buttons(groupId: string, status: string, lang: Lang) {
  if (status === "CLOSED") return [];
  const T = (english: string) => tx(lang, english);
  const b = (action: string, label: string, style: ButtonStyle) =>
    new ButtonBuilder().setCustomId(`${DUNGEON_GROUP_PREFIX}${groupId}:${action}`).setLabel(label).setStyle(style);
  const roleRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    b("TANK", "Tank", ButtonStyle.Primary), b("HEALER", T("Healer"), ButtonStyle.Success), b("DPS", "DPS", ButtonStyle.Danger),
    b("LEAVE", T("Leave"), ButtonStyle.Secondary)
  );
  const leaderRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    ...(status === "OPEN" ? [b("START", T("Start now (voice)"), ButtonStyle.Success)] : []),
    b("CLOSE", T("Close group"), ButtonStyle.Secondary)
  );
  return [roleRow, leaderRow];
}

export async function syncGroupPost(guild: DiscordGuild, groupId: string): Promise<void> {
  try {
    const group = await prisma.dungeonGroup.findUnique({ where: { id: groupId } });
    if (!group?.signupChannelId || !group.signupMessageId) return;
    const channel = await guild.channels.fetch(group.signupChannelId).catch(() => null);
    if (!channel?.isTextBased()) return;
    const message = await channel.messages.fetch(group.signupMessageId).catch(() => null);
    await message?.edit({ embeds: [await groupEmbed(groupId)], components: buttons(groupId, group.status, await groupLang(group.guildId)), allowedMentions: { parse: [] } });
  } catch (error) {
    console.error("Failed to sync dungeon group post", error);
  }
}

async function dungeonVoiceOverwrites(guild: DiscordGuild, group: DungeonGroup): Promise<OverwriteResolvable[]> {
  const groupId = group.id;
  const signups = await prisma.dungeonGroupSignup.findMany({ where: { groupId, status: "SIGNED_UP" }, include: { member: true } });
  const leader = await prisma.member.findUnique({ where: { id: group.leaderId } });
  await guild.roles.fetch();
  const me = guild.members.me;
  const allow = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak];
  const userIds = new Set([...signups.map((s) => s.member.discordUserId), ...(leader ? [leader.discordUserId] : [])]);
  const leadership = guild.roles.cache.filter((role) => isPermissionRoleName("guildMaster", role.name) || isPermissionRoleName("officer", role.name));
  return [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.Connect] },
    ...[...userIds].map((id) => ({ id, allow })),
    ...leadership.map((role) => ({ id: role.id, allow })),
    ...(me ? [{ id: me.id, allow: [...allow, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.MoveMembers] }] : [])
  ];
}

export async function syncDungeonVoiceAccess(guild: DiscordGuild, groupId: string): Promise<void> {
  const group = await prisma.dungeonGroup.findUnique({ where: { id: groupId } });
  if (!group || group.status !== "STARTED" || !group.voiceChannelId) return;
  const voice = await guild.channels.fetch(group.voiceChannelId);
  if (voice?.type === ChannelType.GuildVoice) {
    await voice.permissionOverwrites.set(await dungeonVoiceOverwrites(guild, group), `${BRAND.name} dungeon roster updated`);
  }
}

// Creates the group's private voice channel: only signed-up players, the
// leader, and leadership roles can join. Needs Manage Channels.
async function createVoice(guild: DiscordGuild, groupId: string): Promise<string | null> {
  const group = await prisma.dungeonGroup.findUniqueOrThrow({ where: { id: groupId } });
  const overwrites = await dungeonVoiceOverwrites(guild, group);
  const settings = await guildService.getSettings(group.guildId);
  // Same category as the dungeon signups channel, when there is one.
  const signupChannel = settings?.dungeonSignupChannelId ? await guild.channels.fetch(settings.dungeonSignupChannelId).catch(() => null) : null;
  const parent = signupChannel && "parentId" in signupChannel ? signupChannel.parentId : null;
  const channel = await guild.channels.create({
    name: `🎧 ${group.title}`.slice(0, 100), type: ChannelType.GuildVoice, userLimit: Math.min(99, group.maxSize),
    ...(parent ? { parent } : {}), permissionOverwrites: overwrites, reason: `${BRAND.name} dungeon group ${group.id}`
  });
  return channel.id;
}

// Starts the group: creates the voice channel and updates the post. Shared
// by the Start button and by the group filling up.
export async function startGroup(guild: DiscordGuild, groupId: string): Promise<string | null> {
  const current = await prisma.dungeonGroup.findUnique({ where: { id: groupId } });
  if (!current || current.status === "CLOSED") return null;
  if (current.status === "STARTED") return current.voiceChannelId;
  let voiceId: string | null = null;
  try {
    voiceId = await createVoice(guild, groupId);
  } catch (error) {
    console.warn(`Could not create the dungeon voice channel: ${error instanceof Error ? error.message : String(error)}`);
  }
  await service.markStarted(groupId, voiceId);
  await syncGroupPost(guild, groupId);
  return voiceId;
}

async function closeGroup(guild: DiscordGuild, groupId: string): Promise<void> {
  const group = await prisma.dungeonGroup.findUnique({ where: { id: groupId } });
  if (group?.voiceChannelId) {
    const channel = await guild.channels.fetch(group.voiceChannelId).catch(() => null);
    await channel?.delete(`${BRAND.name} dungeon group closed`).catch(() => undefined);
  }
  await service.close(groupId);
  await syncGroupPost(guild, groupId);
}

// /dungeon group title:<text>
export async function executeDungeonGroup(interaction: ChatInputCommandInteraction): Promise<void> {
  const context = await requireGuildContext(interaction);
  if (!context || !interaction.guild) return;
  const settings = await guildService.getSettings(context.guildId);
  const channel = (settings?.dungeonSignupChannelId ? await interaction.guild.channels.fetch(settings.dungeonSignupChannelId).catch(() => null) : null) ?? interaction.channel;
  if (!channel?.isTextBased() || !("send" in channel)) throw new Error("I can't post in that channel. Set a dungeon signups channel in /setup.");
  const lang = asLang(settings?.language);
  const title = interaction.options.getString("title", true);
  const group = await service.create({
    guildId: context.guildId, title, leaderId: context.memberId, channelId: channel.id, kind: "DUNGEON", size: groupSize("DUNGEON"),
    ...groupLevels("DUNGEON", title, "")
  });
  await postGroup(interaction.guild, channel as GuildTextBasedChannel, group, interaction.user.id, lang);
  await interaction.reply({ content: tx(lang, "Posted your group in <#{id}>. You're the leader: pick your role with the buttons, and press **Start now** when ready (or it starts by itself at {size} players).", { id: channel.id, size: group.maxSize }), ephemeral: true });
}

const isLeadership = (member: GuildMember | null) => !!member && hasPermission(member, "raidLeader");

// Creating a voice channel can take longer than Discord's 3 second window,
// so acknowledge first and answer with editReply; errors are shown to the clicker.
export async function handleDungeonGroupButton(interaction: ButtonInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });
  try {
    const groupId = interaction.customId.slice(DUNGEON_GROUP_PREFIX.length).split(":")[0] ?? "";
    await serializeDungeonGroup(groupId, () => handleDungeonGroupAction(interaction));
  } catch (error) {
    const text = error instanceof Error && error.message.length < 200 ? error.message : tx(await groupLang((await guildService.ensureGuild(interaction.guildId ?? "", interaction.guild?.name ?? "")).id).catch(() => "en" as Lang), "Could not update the group.");
    await interaction.editReply({ content: text }).catch(() => undefined);
  }
}

async function handleDungeonGroupAction(interaction: ButtonInteraction): Promise<void> {
  const [groupId, action] = interaction.customId.slice(DUNGEON_GROUP_PREFIX.length).split(":");
  if (!interaction.guild || !groupId || !action) return;
  const guild = interaction.guild;
  const record = await guildService.ensureGuild(guild.id, guild.name);
  const member = await guildService.ensureMember(record.id, interaction.user.id,
    (interaction.member as GuildMember | null)?.displayName ?? interaction.user.username);
  const lang = await groupLang(record.id);
  const T = (english: string, vars: Record<string, string | number> = {}) => tx(lang, english, vars);
  const ROLE_LABEL = ROLE_LABELS[lang];
  const group = await prisma.dungeonGroup.findFirst({ where: { id: groupId, guildId: record.id } });
  if (!group || group.status === "CLOSED") {
    await interaction.editReply({ content: T("That group is closed.") });
    return;
  }
  const canManage = group.leaderId === member.id || isLeadership(interaction.member as GuildMember | null);
  let content = "";

  if (action === "TANK" || action === "HEALER" || action === "DPS") {
    const { signup } = await service.join(groupId, record.id, member.id, action);
    content = signup.status === "SIGNED_UP" ? T("You're in as {role}.", { role: ROLE_LABEL[action] }) : T("{role} is full: you're on the waitlist and will move up if a slot opens.", { role: ROLE_LABEL[action] });
    // Someone joining a started group gets into its voice channel.
    if (group.status === "STARTED" && group.voiceChannelId && signup.status === "SIGNED_UP") {
      const voice = await guild.channels.fetch(group.voiceChannelId).catch(() => null);
      if (voice?.type === ChannelType.GuildVoice) {
        await voice.permissionOverwrites.edit(interaction.user.id, { ViewChannel: true, Connect: true, Speak: true }).catch(() => undefined);
        content += ` ${T("Voice: <#{id}>", { id: voice.id })}`;
      }
    }
  } else if (action === "LEAVE") {
    const { promoted } = await service.leave(groupId, record.id, member.id);
    content = T("You left the group.");
    for (const signup of promoted) {
      await interaction.client.users.send(signup.member.discordUserId, T("A {role} slot opened in **{title}**: you're in.", { role: ROLE_LABEL[signup.role], title: group.title })).catch(() => undefined);
    }
  } else if (action === "START") {
    if (!canManage) throw new Error(T("Only the group leader or a raid leader can start the group."));
    if (group.status !== "OPEN") throw new Error(T("This group has already started."));
    const voiceId = await startGroup(guild, groupId);
    content = voiceId ? T("Started. Voice channel: <#{id}> (private, deleted when empty).", { id: voiceId }) : T("Started, but I couldn't create a voice channel (I need the Manage Channels permission).");
  } else if (action === "CLOSE") {
    if (!canManage) throw new Error(T("Only the group leader or a raid leader can close the group."));
    await closeGroup(guild, groupId);
    content = T("Group closed.");
  }

  if (["TANK", "HEALER", "DPS", "LEAVE"].includes(action)) {
    await syncDungeonVoiceAccess(guild, groupId).catch((error: unknown) => {
      console.warn("Dungeon voice access update failed", error);
      content += ` ${T("Your signup was saved, but voice access could not be updated. Ask an officer.")}`;
    });
  }
  await interaction.editReply({ content: content || T("Done.") });
  if (action !== "START" && action !== "CLOSE") await syncGroupPost(guild, groupId);
  // A full open group starts by itself.
  if ((action === "TANK" || action === "HEALER" || action === "DPS") && group.status === "OPEN" && (await service.isFull(groupId))) {
    await startGroup(guild, groupId);
    await interaction.followUp({ content: T("The group is full: I created its voice channel. Check the post."), ephemeral: true }).catch(() => undefined);
  }
}

// Runs every couple of minutes: deletes group voice channels that have been
// empty a while, and closes groups that were never finished.
export async function cleanupDungeonGroups(client: Client): Promise<void> {
  const now = new Date();
  const groups = await prisma.dungeonGroup.findMany({ where: { ...pilotGuildScope, OR: [{ status: { in: ["OPEN", "STARTED"] } }, { status: "CLOSED", signupMessageId: { not: null } }] } });
  for (const candidate of groups) {
    await serializeDungeonGroup(candidate.id, async () => {
      try {
        const group = await prisma.dungeonGroup.findUnique({ where: { id: candidate.id } });
        if (!group) return;
        const guildRow = await prisma.guild.findUnique({ where: { id: group.guildId }, select: { discordId: true } });
        const guild = guildRow ? client.guilds.cache.get(guildRow.discordId) : undefined;
        if (!guild) return;
        if (group.status === "CLOSED") {
          if (!shouldDeleteClosedPost(group.closedAt, now) || !group.signupChannelId || !group.signupMessageId) return;
          const channel = await guild.channels.fetch(group.signupChannelId);
          if (!channel?.isTextBased() || !("messages" in channel)) return;
          try { await channel.messages.delete(group.signupMessageId); }
          catch (error) { if (!(error && typeof error === "object" && "code" in error && error.code === 10008)) throw error; }
          await prisma.dungeonGroup.update({ where: { id: group.id }, data: { signupMessageId: null } });
          return;
        }
        if (group.status === "OPEN" && shouldExpireOpenGroup(group.createdAt, now)) {
          await closeGroup(guild, group.id);
          return;
        }
        if (group.status !== "STARTED" || !group.voiceChannelId) return;
        const voice = await guild.channels.fetch(group.voiceChannelId).catch(() => null);
        if (!voice || voice.type !== ChannelType.GuildVoice) {
          await service.close(group.id);
          await syncGroupPost(guild, group.id);
          return;
        }
        if (voice.members.size > 0) {
          if (group.voiceEmptySince) await prisma.dungeonGroup.update({ where: { id: group.id }, data: { voiceEmptySince: null } });
          return;
        }
        if (!group.voiceEmptySince) {
          await prisma.dungeonGroup.update({ where: { id: group.id }, data: { voiceEmptySince: now } });
        } else if (shouldDeleteVoice(group.voiceEmptySince, now)) {
          await closeGroup(guild, group.id);
        }
      } catch (error) {
        console.warn(`Dungeon group cleanup failed for ${candidate.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
  }
}
