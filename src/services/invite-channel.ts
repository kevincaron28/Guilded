import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, type ButtonInteraction, type Client, type GuildMember, type Message, type MessageReaction, type PartialGuildMember, type PartialMessageReaction, type PartialUser, type User } from "discord.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { asLang, t, type Lang } from "../i18n.js";
import { hasPermission } from "../permissions.js";
import { notifyInviters } from "./invite-notify.js";
import { DONE_BUTTON, requestInviteRow, submitInviteRequest, withWhoTip } from "./invite-request.js";
import { extractInviteName, isFiller } from "./invite-name.js";
import { INVITE_REQUEST_PREFIX } from "./invite-request.js";
import { warnDoNotInvite } from "./do-not-invite.js";
import { parseInviteAnswers, questionsBlock, storedQuestions } from "./recruiting-kit.js";
import { foldKey, knownRealms, stripRealm, markInvitedByMessage, markInvitedByName, parseInviteName, recordInviteRequest, SEEN, type InvitedRow, type ParsedInviteName } from "./invite-queue.js";

// 8.5 batch 3 (#13/#14): the Discord half of the guild-invite channel. On by default; an officer's off switch is
// `/mod invites settings queue:false` (and `dm:false` for the WoW-role DM). Reading names needs the Message Content
// intent (MESSAGE_CONTENT_INTENT=true): without it the channel is simply not watched.

const DOUBLE_BREAK = String.fromCharCode(10, 10);
export { SEEN };
export const DONE = "✅";
const HINT_LIFETIME_MS = 45_000;
const WOW_ROLE_NAME = /world\s*of\s*warcraft|^@?wow$|wow forever/i;

type Database = Pick<PrismaClient, "guildSettings" | "inviteRequest" | "inviteDm" | "member" | "character">;

/** The server's World of Warcraft role: the one chosen in settings, else the first role named like it. */
export function findWowRoleId(roles: Iterable<{ id: string; name: string }>, chosen: string | null | undefined): string | null {
  const list = [...roles];
  if (chosen && list.some((role) => role.id === chosen)) return chosen;
  return list.find((role) => WOW_ROLE_NAME.test(role.name))?.id ?? null;
}

function isOfficer(member: GuildMember | null | undefined): boolean {
  try { return Boolean(member && hasPermission(member, "officer")); } catch { return false; }
}

/**
 * A request whose full first+last name is in the CURRENT in-guild roster (a row the game still shows in the guild) is handled
 * right away: no tag. Nothing looser: not a first name alone, not a linked character who may have left. Best effort; the
 * hourly back-check still runs.
 */
export async function settleIfAlreadyIn(client: Pick<Client, "channels" | "user">, database: unknown, guild: { id: string; discordId: string }, nameKey: string): Promise<void> {
  try {
    const wanted = foldKey(nameKey);
    if (!wanted.includes(" ")) return;
    const roster = await (database as Pick<PrismaClient, "guildRosterEntry">).guildRosterEntry.findMany({ where: { guildId: guild.id, inGuild: true }, select: { name: true } });
    const realms = knownRealms(roster.map((row) => row.name));
    const target = stripRealm(wanted, realms);
    // Realm-free names go on, so the matcher cannot cut anything else.
    const names = roster.map((row) => stripRealm(foldKey(row.name), realms)).filter((name) => name === target);
    if (names.length) await completeInvitesFromRoster(client, database as never, guild, names);
  } catch { /* the hourly back-check still runs */ }
}

export const CONFIRM_NAME_PREFIX = "invite:ok:";
export const FIX_NAME_PREFIX = "invite:fix:";
const QUESTION_LIFETIME_MS = 5 * 60_000;
const BRIEF_LIFETIME_MS = 60_000;
interface AskedName { userId: string; discordGuildId: string; channelId: string; typedMessageId: string; parsed: ParsedInviteName; answers: string | null; lang: Lang }
/** Names found in a sentence, waiting for the member's Yes (by the id of the typed message). Lost on a restart: the member types again. */
const askedNames = new Map<string, AskedName>();
const forget = (message: { delete: () => Promise<unknown> } | null | undefined, after: number) => { if (message) setTimeout(() => void message.delete().catch(() => undefined), after).unref?.(); };

/**
 * A player's post in the invite channel. A bare full name is recorded at once (the post itself is the open request and the
 * clean-up removes it when the request closes). A sentence is read for a name (invite-name.ts) and the member confirms it with a
 * button before anything is recorded; a first name alone, or no name, gets a short answer that deletes itself.
 */
export async function handleInviteMessage(message: Message, database: Database): Promise<"recorded" | "hinted" | "asked" | "ignored"> {
  if (!message.guildId || message.author.bot || message.webhookId || !message.content?.trim()) return "ignored";
  const settings = await database.guildSettings.findFirst({ where: { inviteChannelId: message.channelId, inviteQueueEnabled: true }, select: { guildId: true, language: true } });
  if (!settings) return "ignored";
  const lang = asLang(settings.language);
  const exact = parseInviteName(message.content);
  // Two filler words ("thank you", "bonjour guilde") are not a name.
  const parsed = exact && !exact.displayName.split(" ").some((word) => isFiller(word)) ? exact : null;
  if (!parsed) {
    if (isOfficer(message.member)) return "ignored"; // officers talk in the channel too
    const found = extractInviteName(message.content);
    const send = (content: string, components?: ActionRowBuilder<ButtonBuilder>[]) => message.reply({ content, ...(components ? { components } : {}), allowedMentions: { parse: [], repliedUser: false } }).catch(() => null);
    if (found.kind === "name") {
      const question = await send(t(lang, "invite.confirmName", { name: found.displayName }), [new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(`${CONFIRM_NAME_PREFIX}${message.id}`).setLabel(t(lang, "invite.yesButton")).setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`${FIX_NAME_PREFIX}${message.id}`).setLabel(t(lang, "invite.fixButton")).setStyle(ButtonStyle.Secondary))]);
      if (question) {
        // The buttons carry the typed message's id; the name waits here.
        askedNames.set(message.id, { userId: message.author.id, discordGuildId: message.guildId, channelId: message.channelId, typedMessageId: message.id, parsed: { displayName: found.displayName, nameKey: found.nameKey }, answers: parseInviteAnswers(message.content), lang });
        forget(question, QUESTION_LIFETIME_MS);
        setTimeout(() => askedNames.delete(message.id), QUESTION_LIFETIME_MS + 5_000).unref?.();
        return "asked";
      }
      return "hinted";
    }
    const hint = await send(found.kind === "first" ? t(lang, "invite.needLast", { first: found.first }) : t(lang, "invite.hint"));
    forget(hint, HINT_LIFETIME_MS);
    return "hinted";
  }
  await recordInviteRequest(database, { guildId: settings.guildId, parsed, discordUserId: message.author.id, channelId: message.channelId, messageId: message.id, answers: parseInviteAnswers(message.content) });
  await message.react(SEEN).catch(() => undefined);
  // Officers only (the officer log): never in the public request.
  await warnDoNotInvite(message.guild, { discordUserId: message.author.id, names: [parsed.displayName] }, `<@${message.author.id}> (${parsed.displayName})`, "invite", database as never);
  // Someone already in the guild is done at once: no tag, no wait for the hourly back-check.
  await settleIfAlreadyIn(message.client, database, { id: settings.guildId, discordId: message.guildId }, parsed.nameKey);
  if (message.channel && "send" in message.channel) await notifyInviters(database as never, { guildId: settings.guildId, discordGuild: message.guild, channel: message.channel as never, requestMessageId: message.id, requesterId: message.author.id, displayName: parsed.displayName });
  // The member row lets the character link to them when it joins (invite-prelink.ts). Best effort.
  try { await database.member.upsert({ where: { guildId_discordUserId: { guildId: settings.guildId, discordUserId: message.author.id } }, create: { guildId: settings.guildId, discordUserId: message.author.id, displayName: message.member?.displayName ?? message.author.username }, update: {} }); } catch { /* optional */ }
  return "recorded";
}

/** The Yes / "No, let me fix it" buttons under the bot's question about a name read from a sentence. */
export async function handleInviteNameButton(interaction: ButtonInteraction, database: Database): Promise<void> {
  const yes = interaction.customId.startsWith(CONFIRM_NAME_PREFIX);
  const typedId = interaction.customId.slice((yes ? CONFIRM_NAME_PREFIX : FIX_NAME_PREFIX).length);
  const asked = askedNames.get(typedId);
  if (!asked) { await interaction.update({ content: `${t("en", "invite.questionExpired")} / ${t("fr", "invite.questionExpired")}`, components: [] }).catch(() => undefined); forget(interaction.message, BRIEF_LIFETIME_MS); return; }
  if (asked.userId !== interaction.user.id) { await interaction.reply({ content: t(asked.lang, "invite.notYours"), flags: MessageFlags.Ephemeral }); return; }
  askedNames.delete(typedId);
  const typed = async () => {
    const channel = await interaction.client.channels.fetch(asked.channelId).catch(() => null);
    const original = channel?.isTextBased() && "messages" in channel ? await channel.messages.fetch(asked.typedMessageId).catch(() => null) : null;
    await original?.delete().catch(() => undefined);
  };
  if (!yes) {
    await interaction.update({ content: t(asked.lang, "invite.fixPrompt"), components: [] }).catch(() => undefined);
    await typed();
    forget(interaction.message, BRIEF_LIFETIME_MS);
    return;
  }
  const outcome = await submitInviteRequest(interaction.client, database, { discordGuildId: asked.discordGuildId, discordUserId: asked.userId, parsed: asked.parsed, answers: asked.answers });
  const content = outcome.status === "posted" ? withWhoTip(asked.lang, t(asked.lang, "invite.recorded", { name: asked.parsed.displayName }), outcome.guildName) : outcome.status === "duplicate" ? t(asked.lang, "invite.duplicate") : t(asked.lang, "invite.unavailable");
  await interaction.update({ content, components: [], allowedMentions: { parse: [] } }).catch(() => undefined);
  await typed(); // the bot's own request post now stands for it
  forget(interaction.message, BRIEF_LIFETIME_MS);
}

/**
 * Check mark on each original post, the eyes taken off, the bot's own post and the tag message edited to say
 * it is done (an edit never pings), and a short thank-you under a member's own post. `lang` is the server's language.
 */
export async function markPostsDone(client: Pick<Client, "channels" | "user">, rows: readonly InvitedRow[], lang: Lang = "en", database?: Pick<PrismaClient, "inviteRequest">): Promise<number> {
  let done = 0;
  for (const row of rows) {
    try {
      const channel = await client.channels.fetch(row.channelId);
      if (!channel?.isTextBased() || !("messages" in channel)) continue;
      const post = await channel.messages.fetch(row.messageId);
      await post.react(DONE);
      done++;
      const own = post.author?.id === client.user?.id;
      // The bot's own post carries the officer button; it is not needed once the name is done.
      if (own && post.components?.length) await post.edit({ content: `${post.content ?? ""} ${DONE}`.trim(), components: [], allowedMentions: { parse: [] } }).catch(() => undefined);
      const eyes = post.reactions.cache.get(SEEN);
      if (eyes && client.user) await eyes.users.remove(client.user.id).catch(() => undefined);
      // Tags stop: the message that asked people to invite becomes a plain done note.
      let noted = false;
      if (row.notifyMessageId) {
        const note = await channel.messages.fetch(row.notifyMessageId).catch(() => null);
        if (note && note.author?.id === client.user?.id) { await note.edit({ content: t(lang, "invite.done.note", { name: row.displayName }), allowedMentions: { parse: [] } }).catch(() => undefined); noted = true; }
      }
      if (!own && !noted) {
        const thanks = await post.reply({ content: t(lang, "invite.done.note", { name: row.displayName }), allowedMentions: { parse: [], repliedUser: false } }).catch(() => null);
        // Remembered so the clean-up (invite-cleanup.ts) removes it by id.
        if (thanks && database) await database.inviteRequest.updateMany({ where: { id: row.id }, data: { doneNoteMessageId: thanks.id } }).catch(() => undefined);
      }
    } catch { /* message deleted or no access: the queue row is still done */ }
  }
  return done;
}

/** An officer reacts ✅ on a post: that name is done. */
export async function handleInviteReaction(client: Client, database: Database, reaction: MessageReaction | PartialMessageReaction, user: User | PartialUser): Promise<number> {
  if (user.bot || reaction.emoji.name !== DONE || !reaction.message.guildId) return 0;
  const message = reaction.message;
  const settings = await database.guildSettings.findFirst({ where: { inviteChannelId: message.channelId }, select: { guildId: true } });
  if (!settings) return 0;
  const guild = client.guilds.cache.get(message.guildId!);
  const member = await guild?.members.fetch(user.id).catch(() => null);
  if (!member || !isOfficer(member)) return 0;
  const rows = await markInvitedByMessage(database, settings.guildId, message.id, user.id);
  // The officer's own ✅ is on the post; other waiting posts of the same name get the bot's.
  return markPostsDone(client, rows.filter((row) => row.messageId !== message.id).concat(rows.filter((row) => row.messageId === message.id)), "en", database);
}

/** A roster upload showed these characters in the guild: their waiting posts are done. Automatic, so preview-gated. */
export async function completeInvitesFromRoster(client: Pick<Client, "channels" | "user">, database: Pick<PrismaClient, "inviteRequest"> & Partial<Pick<PrismaClient, "guildSettings">>, guild: { id: string; discordId: string }, names: readonly string[]): Promise<number> {
  if (!names.length) return 0;
  const rows = await markInvitedByName(database, guild.id, names, "roster");
  if (!rows.length) return 0;
  const settings = await Promise.resolve().then(() => database.guildSettings?.findUnique({ where: { guildId: guild.id }, select: { language: true } })).catch(() => null);
  return markPostsDone(client, rows, asLang(settings?.language), database);
}

/** Every waiting post whose character is in the stored guild roster (or is a linked character) is done. Safe to repeat. */
export async function backCheckInvites(client: Pick<Client, "channels" | "user">, database: Pick<PrismaClient, "inviteRequest" | "guildRosterEntry" | "character"> & Partial<Pick<PrismaClient, "guildSettings">>, guild: { id: string; discordId: string }): Promise<number> {
  if (!await database.inviteRequest.count({ where: { guildId: guild.id, status: "PENDING" } })) return 0;
  const [roster, linked] = await Promise.all([
    database.guildRosterEntry.findMany({ where: { guildId: guild.id, inGuild: true }, select: { name: true } }),
    database.character.findMany({ where: { member: { guildId: guild.id } }, select: { name: true, displayName: true } })
  ]);
  const names = [...roster.map((row) => row.name), ...linked.flatMap((row) => [row.name, ...(row.displayName ? [row.displayName] : [])])];
  return completeInvitesFromRoster(client, database, guild, names);
}

/** Start-up and hourly: back-check the waiting requests of every server that runs the queue. */
export async function backCheckAllInvites(client: Pick<Client, "channels" | "user">, database: Pick<PrismaClient, "guildSettings" | "inviteRequest" | "guildRosterEntry" | "character">): Promise<number> {
  const rows = await database.guildSettings.findMany({ where: { inviteQueueEnabled: true, inviteChannelId: { not: null } }, select: { guild: { select: { id: true, discordId: true } } } });
  let done = 0;
  for (const row of rows) {
    done += await backCheckInvites(client, database, row.guild).catch(() => 0);
  }
  return done;
}

/** An officer clicks "Invited / joined" on a post the bot made: that name is done. */
export async function handleInviteDoneButton(interaction: ButtonInteraction, database: Database): Promise<void> {
  const [, action, discordGuildId] = interaction.customId.split(":");
  if (!interaction.customId.startsWith(INVITE_REQUEST_PREFIX) || action !== DONE_BUTTON || !discordGuildId) return;
  const settings = await database.guildSettings.findFirst({ where: { guild: { discordId: discordGuildId } }, select: { guildId: true, language: true } });
  const member = interaction.member && "roles" in interaction.member && "permissions" in interaction.member ? interaction.member as GuildMember : null;
  if (!settings || !isOfficer(member)) {
    await interaction.reply({ content: t(asLang(settings?.language), "invite.doneOfficers"), flags: MessageFlags.Ephemeral });
    return;
  }
  const rows = await markInvitedByMessage(database, settings.guildId, interaction.message.id, interaction.user.id);
  await interaction.update({ components: [] }).catch(() => undefined);
  await markPostsDone(interaction.client, rows.filter((row) => row.messageId !== interaction.message.id).concat(rows.filter((row) => row.messageId === interaction.message.id)), "en", database);
}

/** Someone got the World of Warcraft role: one DM asking for their full character name in the invite channel. */
export async function handleWowRoleGiven(before: GuildMember | PartialGuildMember, after: GuildMember, database: Database): Promise<boolean> {
  if (after.user.bot || before.partial) return false;
  const added = after.roles.cache.filter((role) => !before.roles.cache.has(role.id));
  if (!added.size) return false;
  const all = await database.guildSettings.findMany({ where: { guild: { discordId: after.guild.id }, inviteChannelId: { not: null }, inviteDmEnabled: true, inviteQueueEnabled: true },
    select: { guildId: true, inviteChannelId: true, inviteWowRoleId: true, inviteQuestions: true, language: true } });
  for (const settings of all) {
    const roleId = findWowRoleId(after.guild.roles.cache.values(), settings.inviteWowRoleId);
    if (!roleId || !added.has(roleId)) continue;
    // Already asked, already posted, or already linked to a character: nothing to ask.
    if (await database.inviteDm.findUnique({ where: { guildId_discordUserId: { guildId: settings.guildId, discordUserId: after.id } } })) continue;
    if (await database.inviteRequest.count({ where: { guildId: settings.guildId, discordUserId: after.id } })) continue;
    const member = await database.member.findFirst({ where: { guildId: settings.guildId, discordUserId: after.id }, select: { id: true } });
    if (member && await database.character.count({ where: { memberId: member.id } })) continue;
    await database.inviteDm.create({ data: { guildId: settings.guildId, discordUserId: after.id } }).catch(() => undefined);
    try {
      await after.send({ content: [t(asLang(settings.language), "invite.dm", { server: after.guild.name, channel: settings.inviteChannelId! }), questionsBlock(asLang(settings.language), storedQuestions(settings.inviteQuestions))].filter(Boolean).join(DOUBLE_BREAK), components: [requestInviteRow(asLang(settings.language), after.guild.id)], allowedMentions: { parse: [] } });
      return true;
    } catch { return false; } // DMs closed: skipped quietly, never repeated
  }
  return false;
}
