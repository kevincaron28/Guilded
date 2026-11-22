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
 * A channel the bot cannot post in is passed over (22 Nov 2026): Québec Gold's chat-wow and chat-guilde are Discord channels linked to the
 * game's guild chat (`linked_lobby`, application authorization required), and Discord refuses every bot message there (error 20062).
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
  return findWowChatChannelIds(channels)[0] ?? null;
}

/** Every WoW chat text channel by name, best first (same order as findWowChatChannelId). */
export function findWowChatChannelIds(channels: Iterable<ChannelLike>): string[] {
  const all = [...channels];
  const wowCategories = new Set(all.filter((c) => c.type === ChannelType.GuildCategory && WOW_CATEGORY.test(plainChannelName(c.name))).map((c) => c.id));
  const found: { id: string; score: number }[] = [];
  for (const c of all) {
    if (c.type !== ChannelType.GuildText) continue;
    const index = (WOW_CHAT_NAMES as readonly string[]).indexOf(plainChannelName(c.name));
    if (index < 0) continue;
    found.push({ id: c.id, score: (c.parentId && wowCategories.has(c.parentId) ? 0 : 10) + index });
  }
  return found.sort((a, b) => a.score - b.score).map((c) => c.id);
}

/** Whether the bot may post in a channel; a check that fails to answer counts as yes (delivery then reports the real error). */
export type Postable = (channelId: string) => Promise<boolean>;
const linkedCache = new Map<string, { postable: boolean; at: number }>();

/**
 * Postable check through Discord's REST API: a channel linked to a game lobby that requires the application's authorization refuses bot
 * messages. discord.js does not keep `linked_lobby` on its channel objects, so the raw channel is read (cached for an hour per channel).
 */
export function restPostable(rest: { get(route: `/${string}`): Promise<unknown> } | undefined, now = () => Date.now()): Postable {
  return async (channelId) => {
    if (!rest) return true;
    const hit = linkedCache.get(channelId);
    if (hit && now() - hit.at < 3_600_000) return hit.postable;
    const raw = await rest.get(`/channels/${channelId}`).catch(() => null) as { linked_lobby?: { require_application_authorization?: boolean } | null } | null;
    if (!raw) return true;
    const postable = !(raw.linked_lobby && raw.linked_lobby.require_application_authorization !== false);
    linkedCache.set(channelId, { postable, at: now() });
    return postable;
  };
}

/** The REST client of a discord.js guild, when it has one (tests pass partial guilds). */
export function guildPostable(discordGuild: { client?: { rest?: { get(route: `/${string}`): Promise<unknown> } } } | undefined): Postable {
  return restPostable(discordGuild?.client?.rest);
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
export async function wowChatChannel(db: WowChatDb, guildId: string, channels: Iterable<ChannelLike> = [], postable: Postable = async () => true): Promise<string | null> {
  const all = [...channels];
  const chosen = (await db.guildSettings?.findUnique({ where: { guildId }, select: { wowChatChannelId: true } }).catch(() => null))?.wowChatChannelId;
  const candidates: string[] = [];
  if (chosen && (!all.length || all.some((c) => c.id === chosen))) candidates.push(chosen);
  candidates.push(...findWowChatChannelIds(all));
  const community = findCommunityChatChannelId(all);
  if (community) candidates.push(community);
  for (const id of new Set(candidates)) if (await postable(id)) return id;
  const season = await db.communitySeason.findFirst({ where: { guildId, game: "DISCORD", audienceRoleId: null, announcementChannelId: { not: null } }, orderBy: { createdAt: "desc" }, select: { announcementChannelId: true } });
  if (season?.announcementChannelId && await postable(season.announcementChannelId)) return season.announcementChannelId;
  return (await db.communityHonors.findUnique({ where: { guildId }, select: { channelId: true } }))?.channelId ?? null;
}
