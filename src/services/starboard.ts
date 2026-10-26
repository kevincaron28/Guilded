import { EmbedBuilder, PermissionFlagsBits, type Guild, type GuildBasedChannel, type Message, type MessageReaction, type PartialMessage, type PartialMessageReaction } from "discord.js";
import { prisma } from "../database.js";

// Starboard (/config starboard): a message that gets enough ⭐ is reposted in the starboard
// channel, and its count kept up to date. Off by default. Never reposts a message from a channel
// some starboard reader could not see (or from an age-restricted one), bots, or the starboard itself.
export const STAR = "⭐";

// Every role that can read the starboard must also be able to read the source channel.
export function visibleEnough(roles: { readsStarboard: boolean; readsSource: boolean }[]): boolean {
  return roles.every((role) => !role.readsStarboard || role.readsSource);
}

export function starboardPayload(input: { stars: number; authorId: string; guildId: string; channelId: string; messageId: string; text: string; image: string | null; lang?: "en" | "fr" }) {
  const url = `https://discord.com/channels/${input.guildId}/${input.channelId}/${input.messageId}`;
  const embed = new EmbedBuilder().setColor(0xd4af37)
    .setDescription(`${input.text ? `${input.text.slice(0, 1500)}\n\n` : ""}[${input.lang === "fr" ? "Aller au message" : "Jump to message"}](${url})`);
  if (input.image) embed.setImage(input.image);
  return { content: `${STAR} **${input.stars}** · <#${input.channelId}> · <@${input.authorId}>`, embeds: [embed], allowedMentions: { parse: [] as [] } };
}

const reads = (channel: GuildBasedChannel, roleId: string) => channel.permissionsFor(roleId)?.has(PermissionFlagsBits.ViewChannel) ?? false;

// One update at a time per message, so two quick stars never create two reposts.
const pending = new Map<string, Promise<void>>();

export async function handleStarReaction(reaction: MessageReaction | PartialMessageReaction): Promise<void> {
  if (reaction.emoji.name !== STAR) return;
  const id = reaction.message.id;
  const previous = pending.get(id) ?? Promise.resolve();
  const next = previous.then(() => updateStarboard(reaction)).finally(() => { if (pending.get(id) === next) pending.delete(id); });
  pending.set(id, next);
  await next;
}

async function updateStarboard(raw: MessageReaction | PartialMessageReaction): Promise<void> {
  const reaction = raw.partial ? await raw.fetch() : raw;
  const message: Message | PartialMessage = reaction.message.partial ? await reaction.message.fetch() : reaction.message;
  const guild: Guild | null = message.guild;
  if (!guild || !message.author || message.author.bot) return;
  const settings = await prisma.guildSettings.findFirst({ where: { guild: { discordId: guild.id }, starboardChannelId: { not: null } }, select: { guildId: true, starboardChannelId: true, starboardThreshold: true, language: true } });
  if (!settings?.starboardChannelId || message.channelId === settings.starboardChannelId) return;
  const stars = reaction.count ?? 0;
  const existing = await prisma.starboardPost.findUnique({ where: { sourceMessageId: message.id } });
  const starboard = await guild.channels.fetch(existing?.starboardChannelId ?? settings.starboardChannelId).catch(() => null);
  if (!starboard?.isSendable()) return;
  if (existing) {
    if (existing.stars === stars) return;
    const post = await starboard.messages.fetch(existing.starboardMessageId).catch(() => null);
    if (post) await post.edit({ content: `${STAR} **${stars}** · <#${message.channelId}> · <@${message.author.id}>`, allowedMentions: { parse: [] } });
    await prisma.starboardPost.update({ where: { id: existing.id }, data: { stars } });
    return;
  }
  if (stars < settings.starboardThreshold) return;
  const source = message.channel;
  if (!("permissionsFor" in source) || (("nsfw" in source && source.nsfw) && !("nsfw" in starboard && starboard.nsfw))) return;
  if (!visibleEnough([...guild.roles.cache.values()].map((role) => ({ readsStarboard: reads(starboard, role.id), readsSource: reads(source as GuildBasedChannel, role.id) })))) return;
  const image = message.attachments.find((file) => file.contentType?.startsWith("image/"))?.url ?? null;
  const post = await starboard.send(starboardPayload({ stars, authorId: message.author.id, guildId: guild.id, channelId: message.channelId, messageId: message.id, text: message.content ?? "", image, lang: settings.language === "fr" ? "fr" : "en" }));
  await prisma.starboardPost.create({ data: { guildId: settings.guildId, sourceChannelId: message.channelId, sourceMessageId: message.id, starboardChannelId: starboard.id, starboardMessageId: post.id, stars } });
}
