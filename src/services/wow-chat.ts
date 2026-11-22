import { ChannelType } from "discord.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import { communityChannelNames } from "../setup-names.js";

/**
 * The WoW chat destination (owner request, 21 Nov 2026): where the promotion congratulations and the guild bank donor cards go.
 *  1. the channel an officer chose (`GuildSettings.wowChatChannelId`, /officer bank settings wow_chat);
 *  2. else a text channel named like a WoW or guild chat (chat-wow, wow-chat, guild-chat, chat-guilde, guilde-chat; emoji, separators
 *     and accents ignored), preferring one inside a category whose name says WoW ("💬 Chat WoW" on Québec Gold);
 *  3. else the community chat channel (community-chat / chat-communauté in the Community category);
 *  4. else the public community season's announcements channel, else the hall-of-fame channel.
 */

/** The few channel fields the lookups need; discord.js channels and REST channel objects (parent_id) both reduce to this. */
export interface ChannelLike { id: string; name?: string | null; type: number; parentId?: string | null }

/** Lower case, accents folded, every run of other characters (emoji, "︱", "・", spaces) turned into one dash, no dash at either end. */
export function plainChannelName(name: string | null | undefined): string {
  return (name ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

/** Names in order of preference. */
export const WOW_CHAT_NAMES = ["chat-wow", "wow-chat", "guild-chat", "chat-guilde", "guilde-chat"] as const;
const WOW_CATEGORY = /(^|-)wow($|-)|warcraft/;

/** The best WoW chat text channel by name, or null. A channel inside a WoW category beats one outside it; then the name order decides. */
export function findWowChatChannelId(channels: Iterable<ChannelLike>): string | null {
  const all = [...channels];
  const wowCategories = new Set(all.filter((c) => c.type === ChannelType.GuildCategory && WOW_CATEGORY.test(plainChannelName(c.name))).map((c) => c.id));
  let best: { id: string; score: number } | null = null;
  for (const c of all) {
    if (c.type !== ChannelType.GuildText) continue;
    const index = (WOW_CHAT_NAMES as readonly string[]).indexOf(plainChannelName(c.name));
    if (index < 0) continue;
    const score = (c.parentId && wowCategories.has(c.parentId) ? 0 : 10) + index;
    if (!best || score < best.score) best = { id: c.id, score };
  }
  return best?.id ?? null;
}

const COMMUNITY_CATEGORY = /community|communaut/i;

/**
 * The community chat channel (setup-names.ts COMMUNITY_CHANNEL_SPECS "chat": community-chat / chat-communauté, plus legacy names): the text
 * channel with one of those names inside a Community category, found the same way community-setup.ts finds it. Null when there is none.
 */
export function findCommunityChatChannelId(channels: Iterable<ChannelLike>): string | null {
  const all = [...channels];
  const categories = new Set(all.filter((c) => c.type === ChannelType.GuildCategory && COMMUNITY_CATEGORY.test(c.name ?? "")).map((c) => c.id));
  const names = communityChannelNames("chat");
  return all.find((c) => c.type === ChannelType.GuildText && !!c.parentId && categories.has(c.parentId) && names.includes(c.name ?? ""))?.id ?? null;
}

/** A discord.js guild's cached channels as ChannelLike rows (empty for a partial guild, as in tests). */
export function guildChannelLikes(discordGuild: { channels?: { cache?: { values(): Iterable<{ id: string; name?: string | null; type: number; parentId?: string | null }> } } } | undefined): ChannelLike[] {
  return [...(discordGuild?.channels?.cache?.values() ?? [])].map((c) => ({ id: c.id, name: c.name ?? null, type: c.type, parentId: c.parentId ?? null }));
}

export type WowChatDb = Pick<PrismaClient, "communitySeason" | "communityHonors"> & Partial<Pick<PrismaClient, "guildSettings">>;

/**
 * The channel for promotion and donor cards (order above). `channels` is the server's channel list: an officer's channel that is no longer
 * in a non-empty list (deleted) is passed over; with an empty list (no cache) the officer's choice is trusted.
 */
export async function wowChatChannel(db: WowChatDb, guildId: string, channels: Iterable<ChannelLike> = []): Promise<string | null> {
  const all = [...channels];
  const chosen = (await db.guildSettings?.findUnique({ where: { guildId }, select: { wowChatChannelId: true } }).catch(() => null))?.wowChatChannelId;
  if (chosen && (!all.length || all.some((c) => c.id === chosen))) return chosen;
  const found = findWowChatChannelId(all) ?? findCommunityChatChannelId(all);
  if (found) return found;
  const season = await db.communitySeason.findFirst({ where: { guildId, game: "DISCORD", audienceRoleId: null, announcementChannelId: { not: null } }, orderBy: { createdAt: "desc" }, select: { announcementChannelId: true } });
  if (season?.announcementChannelId) return season.announcementChannelId;
  return (await db.communityHonors.findUnique({ where: { guildId }, select: { channelId: true } }))?.channelId ?? null;
}
