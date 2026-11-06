import { type Client, type GuildMember, type Message, type MessageReaction, type PartialGuildMember, type PartialMessageReaction, type PartialUser, type User } from "discord.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { asLang, t } from "../i18n.js";
import { hasPermission } from "../permissions.js";
import { previewAllows } from "./feature-preview.js";
import { requestInviteRow } from "./invite-request.js";
import { parseInviteAnswers, questionsBlock, storedQuestions } from "./recruiting-kit.js";
import { markInvitedByMessage, markInvitedByName, parseInviteName, recordInviteRequest, SEEN, type InvitedRow } from "./invite-queue.js";

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

/** A player's post in the invite channel: record the full name and react 👀, or send a short hint that deletes itself. */
export async function handleInviteMessage(message: Message, database: Database): Promise<"recorded" | "hinted" | "ignored"> {
  if (!message.guildId || message.author.bot || message.webhookId || !message.content?.trim()) return "ignored";
  if (!previewAllows(message.guildId)) return "ignored";
  const settings = await database.guildSettings.findFirst({ where: { inviteChannelId: message.channelId, inviteQueueEnabled: true }, select: { guildId: true, language: true } });
  if (!settings) return "ignored";
  const parsed = parseInviteName(message.content);
  if (!parsed) {
    if (isOfficer(message.member)) return "ignored"; // officers talk in the channel too
    const hint = await message.reply({ content: t(asLang(settings.language), "invite.hint"), allowedMentions: { parse: [], repliedUser: false } }).catch(() => null);
    if (hint) setTimeout(() => void hint.delete().catch(() => undefined), HINT_LIFETIME_MS).unref?.();
    return "hinted";
  }
  await recordInviteRequest(database, { guildId: settings.guildId, parsed, discordUserId: message.author.id, channelId: message.channelId, messageId: message.id, answers: parseInviteAnswers(message.content) });
  await message.react(SEEN).catch(() => undefined);
  return "recorded";
}

/** ✅ on each original post, and the 👀 taken off. */
export async function markPostsDone(client: Pick<Client, "channels" | "user">, rows: readonly InvitedRow[]): Promise<number> {
  let done = 0;
  for (const row of rows) {
    try {
      const channel = await client.channels.fetch(row.channelId);
      if (!channel?.isTextBased() || !("messages" in channel)) continue;
      const post = await channel.messages.fetch(row.messageId);
      await post.react(DONE);
      const eyes = post.reactions.cache.get(SEEN);
      if (eyes && client.user) await eyes.users.remove(client.user.id).catch(() => undefined);
      done++;
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
  return markPostsDone(client, rows.filter((row) => row.messageId !== message.id).concat(rows.filter((row) => row.messageId === message.id)));
}

/** A roster upload showed these characters in the guild: their waiting posts are done. Automatic, so preview-gated. */
export async function completeInvitesFromRoster(client: Pick<Client, "channels" | "user">, database: Database, guild: { id: string; discordId: string }, names: readonly string[]): Promise<number> {
  if (!previewAllows(guild.discordId) || !names.length) return 0;
  const rows = await markInvitedByName(database, guild.id, names, "roster");
  return rows.length ? markPostsDone(client, rows) : 0;
}

/** Someone got the World of Warcraft role: one DM asking for their full character name in the invite channel. */
export async function handleWowRoleGiven(before: GuildMember | PartialGuildMember, after: GuildMember, database: Database): Promise<boolean> {
  if (after.user.bot || before.partial || !previewAllows(after.guild.id)) return false;
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
