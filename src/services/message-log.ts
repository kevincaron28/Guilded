import type { Guild, Message, PartialMessage } from "discord.js";
import { prisma } from "../database.js";

// Edited/deleted message log (/config message-log): off by default, posted in the officer log.
// The text of a message needs the Message Content intent; without it, edits can't be compared
// and only deletions whose author Discord still had in memory are logged. Bots, the officer log
// itself and bulk deletions are skipped.
const clip = (text: string) => text.length > 700 ? `${text.slice(0, 700)}…` : text;
const quote = (text: string) => text ? clip(text).split("\n").map((line) => `> ${line}`).join("\n") : "> *(no text)*";

export function editLine(input: { authorId: string; channelId: string; url: string; before: string; after: string }): string {
  return `✏️ Message edited by <@${input.authorId}> in <#${input.channelId}> · [jump](${input.url})\n**Before**\n${quote(input.before)}\n**After**\n${quote(input.after)}`;
}

export function deleteLine(input: { authorId: string; channelId: string; text: string; attachments: string[] }): string {
  return `🗑️ Message by <@${input.authorId}> deleted in <#${input.channelId}>\n${quote(input.text)}`
    + (input.attachments.length ? `\n📎 ${input.attachments.slice(0, 5).join(", ")}` : "");
}

async function logChannel(guild: Guild, sourceChannelId: string) {
  const settings = await prisma.guildSettings.findFirst({ where: { guild: { discordId: guild.id }, messageLogEnabled: true, logChannelId: { not: null } }, select: { logChannelId: true } });
  if (!settings?.logChannelId || settings.logChannelId === sourceChannelId) return null;
  const channel = await guild.channels.fetch(settings.logChannelId).catch(() => null);
  return channel?.isSendable() ? channel : null;
}

export async function logMessageEdit(before: Message | PartialMessage, after: Message | PartialMessage): Promise<void> {
  // Without the earlier text (not cached, or no Message Content intent) there is nothing to compare.
  if (!after.guild || before.partial || !after.author || after.author.bot || !before.content || before.content === after.content) return;
  const channel = await logChannel(after.guild, after.channelId);
  if (!channel) return;
  await channel.send({ content: editLine({ authorId: after.author.id, channelId: after.channelId, url: after.url, before: before.content, after: after.content ?? "" }).slice(0, 2000), allowedMentions: { parse: [] } });
}

export async function logMessageDelete(message: Message | PartialMessage): Promise<void> {
  if (!message.guild || !message.author || message.author.bot) return;
  const channel = await logChannel(message.guild, message.channelId);
  if (!channel) return;
  await channel.send({ content: deleteLine({ authorId: message.author.id, channelId: message.channelId, text: message.content ?? "", attachments: [...message.attachments.values()].map((file) => file.name) }).slice(0, 2000), allowedMentions: { parse: [] } });
}
