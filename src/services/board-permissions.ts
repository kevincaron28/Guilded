import { ChannelType, PermissionFlagsBits, type Guild as DiscordGuild, type GuildBasedChannel } from "discord.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import type { Lang } from "../i18n.js";

/** What members must not do in a board channel: write, react, or start threads. The bot keeps full posting rights. */
export const BOARD_LOCK = PermissionFlagsBits.SendMessages | PermissionFlagsBits.AddReactions | PermissionFlagsBits.CreatePublicThreads
  | PermissionFlagsBits.CreatePrivateThreads | PermissionFlagsBits.SendMessagesInThreads;
const BOT_NEEDS = PermissionFlagsBits.ViewChannel | PermissionFlagsBits.ReadMessageHistory | PermissionFlagsBits.SendMessages
  | PermissionFlagsBits.EmbedLinks | PermissionFlagsBits.AttachFiles;

export interface OverwriteBits { id: string; allow: bigint; deny: bigint }
export interface OverwriteEdit { id: string; allow: bigint; deny: bigint }

/**
 * Pure: the overwrite changes that make a channel read-only for members. @everyone and the member role get the lock denied;
 * every other role or member overwrite that grants any locked permission loses that grant (a role-level allow beats the
 * @everyone deny, which is how a "read-only" channel stays writable). The bot gets what it needs to post. Returns only the
 * overwrites that actually change, so a channel that is already locked costs no Discord calls.
 */
export function planBoardLock(overwrites: readonly OverwriteBits[], everyoneId: string, memberRoleId: string | null, botId: string): OverwriteEdit[] {
  const byId = new Map(overwrites.map(o => [o.id, o]));
  const edits: OverwriteEdit[] = [];
  const locked = new Set([everyoneId, ...(memberRoleId ? [memberRoleId] : [])]);
  for (const id of [...locked, ...overwrites.map(o => o.id)]) {
    if (id === botId || edits.some(e => e.id === id)) continue;
    const have = byId.get(id) ?? { id, allow: 0n, deny: 0n };
    const mustDeny = locked.has(id);
    const allow = have.allow & ~BOARD_LOCK;
    const deny = mustDeny ? have.deny | BOARD_LOCK : have.deny;
    if (allow !== have.allow || deny !== have.deny) edits.push({ id, allow, deny });
  }
  const bot = byId.get(botId) ?? { id: botId, allow: 0n, deny: 0n };
  const botAllow = bot.allow | BOT_NEEDS, botDeny = bot.deny & ~BOT_NEEDS;
  if (botAllow !== bot.allow || botDeny !== bot.deny) edits.push({ id: botId, allow: botAllow, deny: botDeny });
  return edits;
}

/** The board channels a server has saved, never including the member-facing groups channel or the shared bot-guide channel. */
export function boardChannelIds(settings: Record<string, unknown> | null): string[] {
  if (!settings) return [];
  const id = (key: string) => typeof settings[key] === "string" ? settings[key] as string : null;
  const never = new Set([id("bgGroupsChannelId"), id("guideChannelId"), id("dungeonSignupChannelId")].filter((v): v is string => Boolean(v)));
  const ids = [id("raceBoardChannelId"), id("duelBoardChannelId"), id("bgStatsChannelId"), id("bgResultsChannelId")];
  return [...new Set(ids.filter((v): v is string => Boolean(v) && !never.has(v!)))];
}

/**
 * `/setup` repair: makes every saved board channel (race to 60, duel ladder, battleground ladder and results) read-only for members. Touches only those channels' own overwrites, never another channel or a category.
 * Returns "" when nothing needed fixing; otherwise a short note (what was fixed, or what I could not).
 */
export async function repairBoardPermissions(guild: DiscordGuild, db: PrismaClient, guildId: string, lang: Lang): Promise<string> {
  const settings = await db.guildSettings.findUnique({ where: { guildId } });
  const ids = boardChannelIds(settings as unknown as Record<string, unknown> | null);
  const me = guild.members.me;
  if (!ids.length || !me) return "";
  const fixed: string[] = [], failed: string[] = [];
  for (const id of ids) {
    const channel = await guild.channels.fetch(id).catch(() => null) as GuildBasedChannel | null;
    if (!channel || channel.type !== ChannelType.GuildText) continue;
    const edits = planBoardLock([...channel.permissionOverwrites.cache.values()].map(o => ({ id: o.id, allow: o.allow.bitfield, deny: o.deny.bitfield })), guild.id, settings?.memberRoleId ?? null, me.id);
    if (!edits.length) continue;
    try {
      const changed = new Map(edits.map(e => [e.id, e]));
      const current = [...channel.permissionOverwrites.cache.values()].map(o => ({ id: o.id, type: o.type, allow: changed.get(o.id)?.allow ?? o.allow.bitfield, deny: changed.get(o.id)?.deny ?? o.deny.bitfield }));
      const added = edits.filter(e => !current.some(o => o.id === e.id)).map(e => ({ id: e.id, type: e.id === me.id ? 1 : 0, allow: e.allow, deny: e.deny }));
      await channel.permissionOverwrites.set([...current, ...added], "Guilded board channel read-only for members");
      fixed.push(`<#${id}>`);
    } catch { failed.push(`<#${id}>`); }
  }
  const fr = lang === "fr";
  return [
    fixed.length ? (fr ? `Salons de tableaux en lecture seule pour les membres : ${fixed.join(", ")}.` : `Board channels made read-only for members: ${fixed.join(", ")}.`) : "",
    failed.length ? `⚠️ ${fr ? `Je n'ai pas pu verrouiller ${failed.join(", ")} (il me faut Gérer les rôles / permissions dans ces salons).` : `I could not lock ${failed.join(", ")} (I need Manage Roles / Manage Permissions there).`}` : ""
  ].filter(Boolean).join("\n");
}
