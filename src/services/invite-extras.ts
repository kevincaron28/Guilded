import { ChannelType, type Guild, type GuildBasedChannel } from "discord.js";
import { channelNames, categoryNames } from "../setup-names.js";
import { parseInviteName } from "./invite-queue.js";

// Roadmap 16: the guild-invite channel lives in the WoW (raid) category and a server keeps only one. These helpers pick the
// channel setup keeps and list the names still waiting in any extra one, so an officer can repost them before deleting it by
// hand. Nothing here deletes or moves a channel by itself.

export interface InviteChannelCandidate { id: string; name: string; parentName: string | undefined; position: number }

const WOW_CATEGORIES = new Set(categoryNames("raid"));

/** The channel setup keeps: the one already in the WoW category, else the first by position. Null when there is none. */
export function pickInviteChannel<T extends InviteChannelCandidate>(candidates: readonly T[]): T | null {
  const named = candidates.filter((channel) => channelNames("inviteChannelId").includes(channel.name));
  return [...named].sort((a, b) => Number(WOW_CATEGORIES.has(b.parentName ?? "")) - Number(WOW_CATEGORIES.has(a.parentName ?? "")) || a.position - b.position)[0] ?? null;
}

/** Every text channel with an invite-channel name (either language), as candidates. */
export function inviteChannelCandidates(guild: Guild): (InviteChannelCandidate & { channel: GuildBasedChannel })[] {
  return [...guild.channels.cache.values()]
    .filter((channel) => channel.type === ChannelType.GuildText && channelNames("inviteChannelId").includes(channel.name))
    .map((channel) => ({ id: channel.id, name: channel.name, parentName: channel.parentId ? guild.channels.cache.get(channel.parentId)?.name : undefined, position: "position" in channel ? channel.position : 0, channel }));
}

export interface ScannedPost { id: string; authorId: string; bot: boolean; content: string; reactions: readonly string[]; url: string }

/** Posts that still need an invite: a player's post with a readable "First Last", and no ✅ yet. Newest names once each. */
export function openInvitePosts(posts: readonly ScannedPost[]): { name: string; authorId: string; url: string }[] {
  const seen = new Set<string>();
  const open: { name: string; authorId: string; url: string }[] = [];
  for (const post of posts) {
    if (post.bot || post.reactions.includes("✅")) continue;
    const parsed = parseInviteName(post.content);
    if (!parsed || seen.has(parsed.nameKey)) continue;
    seen.add(parsed.nameKey);
    open.push({ name: parsed.displayName, authorId: post.authorId, url: post.url });
  }
  return open;
}

export function formatOpenInvitePosts(open: readonly { name: string; authorId: string; url: string }[], channelId: string, kept: string | null): string {
  if (!open.length) return `Nothing waiting in <#${channelId}>: every name there has a ✅.`;
  const lines = open.slice(0, 25).map((post) => `• **${post.name}** (<@${post.authorId}>) ${post.url}`);
  return `**${open.length} name(s) still waiting in <#${channelId}>** (no ✅). Repost them in ${kept ? `<#${kept}>` : "the kept invite channel"}, then delete the extra channel yourself; I never delete channels.\n${lines.join("\n")}${open.length > 25 ? `\n…and ${open.length - 25} more.` : ""}`;
}

/** Reads up to 300 recent posts of a channel (newest first). */
export async function scanInviteChannel(guild: Guild, channelId: string): Promise<ScannedPost[]> {
  const channel = guild.channels.cache.get(channelId);
  if (!channel?.isTextBased() || !("messages" in channel)) return [];
  const posts: ScannedPost[] = [];
  let before: string | undefined;
  for (let page = 0; page < 3; page++) {
    const batch = await channel.messages.fetch({ limit: 100, ...(before ? { before } : {}) });
    if (!batch.size) break;
    for (const message of batch.values()) posts.push({ id: message.id, authorId: message.author.id, bot: message.author.bot, content: message.content, reactions: message.reactions.cache.map((reaction) => reaction.emoji.name ?? ""), url: message.url });
    before = batch.last()?.id;
    if (batch.size < 100) break;
  }
  return posts;
}
