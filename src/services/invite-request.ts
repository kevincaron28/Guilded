import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle,
  type ButtonInteraction, type Client, type Message, type ModalSubmitInteraction
} from "discord.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { asLang, t, type Lang } from "../i18n.js";
import { parseInviteName, recordInviteRequest, SEEN, type ParsedInviteName } from "./invite-queue.js";
import { hostedPilot } from "../hosted-pilot.js";

// Owner request (9.0): a "Request a guild invite" button in the World of Warcraft role DM and in the onboarding game menu.
// It opens a form for the full character name (First Last, validated). On submit the bot posts the name itself in the
// invite channel ("<@member> -> **First Last**", mentions switched off so nobody is pinged), queues it with an eyes
// reaction and confirms privately. A plain DM reply that looks like a full name works too, but only for members the bot
// already asked (the role DM). One request per member per character; a repeat is ignored.

export const INVITE_REQUEST_PREFIX = "invite:";
const BUTTON = "ask";
const MODAL = "name";
const INPUT = "name";
export const DONE_BUTTON = "done";

type Database = Pick<PrismaClient, "guildSettings" | "inviteRequest" | "inviteDm" | "member">;

const customId = (action: string, discordGuildId: string) => `${INVITE_REQUEST_PREFIX}${action}:${discordGuildId}`;

/** The button row for a server's DM or menu. */
export function requestInviteRow(lang: Lang, discordGuildId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(customId(BUTTON, discordGuildId)).setLabel(t(lang, "invite.button")).setStyle(ButtonStyle.Primary));
}

/** Officer button on a post the bot made itself (player-typed posts keep the officer's ✅ reaction). */
export function inviteDoneRow(lang: Lang, discordGuildId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(customId(DONE_BUTTON, discordGuildId)).setLabel(t(lang, "invite.doneButton")).setStyle(ButtonStyle.Success));
}

export function requestInviteModal(lang: Lang, discordGuildId: string): ModalBuilder {
  return new ModalBuilder().setCustomId(customId(MODAL, discordGuildId)).setTitle(t(lang, "invite.modalTitle")).addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(new TextInputBuilder().setCustomId(INPUT).setLabel(t(lang, "invite.modalLabel"))
      .setPlaceholder("Lebowski Holyroller").setStyle(TextInputStyle.Short).setMinLength(5).setMaxLength(60).setRequired(true)));
}

export type RequestOutcome = { status: "posted"; channelId: string } | { status: "duplicate" } | { status: "unavailable" };

/** Posts the name in the invite channel and queues it. */
export async function submitInviteRequest(client: Pick<Client, "guilds" | "channels">, database: Database,
  input: { discordGuildId: string; discordUserId: string; parsed: ParsedInviteName }): Promise<RequestOutcome & { lang: Lang }> {
  const settings = await database.guildSettings.findFirst({
    where: { guild: { discordId: input.discordGuildId }, inviteChannelId: { not: null }, inviteQueueEnabled: true },
    select: { guildId: true, inviteChannelId: true, language: true }
  });
  const lang = asLang(settings?.language);
  if (!settings?.inviteChannelId || !hostedPilot.allows(input.discordGuildId)) return { status: "unavailable", lang };
  const guild = await client.guilds.fetch(input.discordGuildId).catch(() => null);
  const member = await guild?.members.fetch(input.discordUserId).catch(() => null);
  if (!member) return { status: "unavailable", lang };
  const already = await database.inviteRequest.findFirst({ where: { guildId: settings.guildId, discordUserId: input.discordUserId, nameKey: input.parsed.nameKey }, select: { id: true } });
  if (already) return { status: "duplicate", lang };
  const channel = await client.channels.fetch(settings.inviteChannelId).catch(() => null);
  if (!channel?.isTextBased() || !("send" in channel)) return { status: "unavailable", lang };
  const posted = await channel.send({ content: `<@${input.discordUserId}> → **${input.parsed.displayName}**`, components: [inviteDoneRow(lang, input.discordGuildId)], allowedMentions: { parse: [] } }).catch(() => null);
  if (!posted) return { status: "unavailable", lang };
  await recordInviteRequest(database, { guildId: settings.guildId, parsed: input.parsed, discordUserId: input.discordUserId, channelId: channel.id, messageId: posted.id });
  await posted.react(SEEN).catch(() => undefined);
  // The member row lets the character link to them when it joins (invite-prelink.ts). Best effort.
  try { await database.member.upsert({ where: { guildId_discordUserId: { guildId: settings.guildId, discordUserId: input.discordUserId } }, create: { guildId: settings.guildId, discordUserId: input.discordUserId, displayName: member.displayName }, update: {} }); } catch { /* optional */ }
  return { status: "posted", channelId: channel.id, lang };
}

const say = (lang: Lang, outcome: RequestOutcome): string =>
  outcome.status === "posted" ? t(lang, "invite.confirmed", { channel: outcome.channelId })
    : outcome.status === "duplicate" ? t(lang, "invite.duplicate") : t(lang, "invite.unavailable");

/** The button opens the form; the form submits the request. */
export async function handleInviteRequestInteraction(interaction: ButtonInteraction | ModalSubmitInteraction, database: Database): Promise<void> {
  const [action, discordGuildId] = interaction.customId.slice(INVITE_REQUEST_PREFIX.length).split(":") as [string, string | undefined];
  if (!discordGuildId) return;
  const settings = await database.guildSettings.findFirst({ where: { guild: { discordId: discordGuildId } }, select: { language: true } });
  const lang = asLang(settings?.language);
  if (action === DONE_BUTTON) return; // handled by handleInviteDoneButton (invite-channel.ts)
  if (interaction.isButton() && action === BUTTON) { await interaction.showModal(requestInviteModal(lang, discordGuildId)); return; }
  if (!interaction.isModalSubmit() || action !== MODAL) return;
  const parsed = parseInviteName(interaction.fields.getTextInputValue(INPUT));
  if (!parsed) { await interaction.reply({ content: t(lang, "invite.invalid"), flags: MessageFlags.Ephemeral }); return; }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const outcome = await submitInviteRequest(interaction.client, database, { discordGuildId, discordUserId: interaction.user.id, parsed });
  await interaction.editReply({ content: say(outcome.lang, outcome), allowedMentions: { parse: [] } });
}

/** Fallback: a plain DM that looks like a full name, from a member the bot already asked in the role DM. */
export async function handleInviteDm(message: Message, database: Database): Promise<boolean> {
  if (message.guildId || message.author.bot) return false;
  const parsed = parseInviteName(message.content);
  if (!parsed) return false;
  const asked = await database.inviteDm.findMany({ where: { discordUserId: message.author.id }, select: { guildId: true } });
  if (!asked.length) return false;
  const rows = await database.guildSettings.findMany({ where: { guildId: { in: asked.map((row) => row.guildId) }, inviteChannelId: { not: null } }, select: { guild: { select: { discordId: true } } } });
  for (const row of rows) {
    const outcome = await submitInviteRequest(message.client, database, { discordGuildId: row.guild.discordId, discordUserId: message.author.id, parsed });
    if (outcome.status === "unavailable") continue;
    await message.reply({ content: say(outcome.lang, outcome), allowedMentions: { parse: [] } }).catch(() => undefined);
    return true;
  }
  return false;
}
