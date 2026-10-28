import { ChannelType, PermissionFlagsBits, type Guild, type GuildBasedChannel, type GuildMember } from "discord.js";
import type { ParticipationRules } from "./participation-rules.js";

// Forum/media messages arrive as threads, not as messages on the parent itself.
export function supportsParticipationMessages(type: ChannelType): boolean {
  return [ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildVoice,
    ChannelType.GuildStageVoice, ChannelType.PublicThread, ChannelType.PrivateThread,
    ChannelType.AnnouncementThread].includes(type);
}

export function participationChannelEnabled(channel: { id: string; type: ChannelType }, rules: ParticipationRules): boolean {
  return supportsParticipationMessages(channel.type) && (rules.allText || rules.textChannels.includes(channel.id));
}

export async function canViewParticipationChannel(channel: GuildBasedChannel, member: GuildMember): Promise<boolean> {
  const permissions = channel.permissionsFor(member);
  if (!permissions?.has(PermissionFlagsBits.ViewChannel)) return false;
  // discord.js returns parent permissions for threads. ViewChannel alone is not
  // proof of private-thread membership; do not reveal or award based on it.
  if (channel.type !== ChannelType.PrivateThread || permissions.has(PermissionFlagsBits.ManageThreads)) return true;
  try { await channel.members.fetch(member.id); return true; } catch { return false; }
}

export async function participationChannelCoverage(guild: Guild, actor: GuildMember, rules: ParticipationRules, earning: boolean) {
  const fetched = await guild.channels.fetch();
  const channels = new Map<string, GuildBasedChannel>();
  for (const channel of fetched.values()) if (channel) channels.set(channel.id, channel);
  // A restricted list may explicitly name a thread, which the guild-channel
  // endpoint does not return. Fetch only those configured IDs, never join them.
  for (const id of rules.textChannels) if (!channels.has(id)) {
    const channel = await guild.channels.fetch(id).catch(() => null);
    if (channel) channels.set(id, channel);
  }
  const bot = guild.members.me ?? await guild.members.fetchMe();
  const result: { id: string; posts: boolean; state: "paused" | "excluded" | "unavailable" | "enabled"; history: boolean }[] = [];
  for (const channel of channels.values()) {
    if (!channel) continue;
    const posts = channel.type === ChannelType.GuildForum || channel.type === ChannelType.GuildMedia;
    if ((!posts && !supportsParticipationMessages(channel.type)) || !await canViewParticipationChannel(channel, actor)) continue;
    const permissions = channel.permissionsFor(bot);
    const included = posts ? rules.allText : participationChannelEnabled(channel, rules);
    const accessible = await canViewParticipationChannel(channel, bot);
    result.push({ id: channel.id, posts, history: !!permissions?.has(PermissionFlagsBits.ReadMessageHistory),
      state: !accessible ? "unavailable" : !included ? "excluded" : !earning ? "paused" : "enabled" });
  }
  return result;
}
