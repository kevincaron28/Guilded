import type { Guild as DiscordGuild } from "discord.js";
import type { CraftRequestStatus, PrismaClient } from "../generated/prisma/client.js";
import type { Lang } from "../i18n.js";
import { PROFESSION_FR } from "./profession-style.js";

// 9.1 (owner, 7 November 2026): the crafting category, split so it stays tidy.
//   * #craft-orders: every open request is one short message, edited when a crafter takes it,
//     deleted when it is finished (the craft board forum keeps the full post and its buttons).
//   * #craft-archive: one compact line per finished or cancelled request.
//   * Crafter pings: a member opts in per profession (/craft notify or the board's Crafter pings
//     button). A new request pings only opted-in members whose characters know that exact recipe
//     (from the addon's profession scans), at most MAX_PINGS per request and once per COOLDOWN per
//     member and profession.
// On by default; officers turn the channels or the pings off with /craft notify-setting.

export const MAX_PINGS = 5;
export const PING_COOLDOWN_MS = 30 * 60_000;

type Request = {
  id: string; guildId: string; item: string; quantity: number; profession: string | null; status: CraftRequestStatus;
  threadId: string | null; orderMessageId: string | null; archiveMessageId: string | null; createdAt: Date; doneAt: Date | null;
  requester: { id?: string; discordUserId: string; displayName: string }; crafter: { discordUserId: string; displayName: string } | null;
};

const ICON: Record<CraftRequestStatus, string> = { OPEN: "🟢", CLAIMED: "🟡", DONE: "✅", CANCELLED: "⛔" };
const clean = (text: string) => text.replace(/[*_`~|<>@]/g, "").slice(0, 100);
const professionName = (lang: Lang, profession: string) => lang === "fr" ? PROFESSION_FR[profession] ?? profession : profession;

/** One line in #craft-orders. */
export function orderLine(request: Request, lang: Lang): string {
  const t = (en: string, fr: string) => lang === "fr" ? fr : en;
  return [
    `${ICON[request.status]} ${request.quantity}× **${clean(request.item)}**`,
    request.profession ? professionName(lang, request.profession) : null,
    `${t("for", "pour")} <@${request.requester.discordUserId}>`,
    request.crafter ? `${t("crafter", "artisan")} <@${request.crafter.discordUserId}>` : t("waiting for a crafter", "en attente d'un artisan"),
    request.threadId ? `<#${request.threadId}>` : null,
    `<t:${Math.floor(request.createdAt.getTime() / 1000)}:R>`
  ].filter(Boolean).join(" · ");
}

/** One compact line in #craft-archive. */
export function archiveLine(request: Request, lang: Lang): string {
  const t = (en: string, fr: string) => lang === "fr" ? fr : en;
  const done = request.status === "DONE";
  return [
    `${ICON[request.status]} ${request.quantity}× **${clean(request.item)}**`,
    `${t("for", "pour")} <@${request.requester.discordUserId}>`,
    done ? `${t("by", "par")} ${request.crafter ? `<@${request.crafter.discordUserId}>` : "?"}` : t("cancelled", "annulée"),
    `<t:${Math.floor((request.doneAt ?? new Date()).getTime() / 1000)}:d>`
  ].join(" · ");
}

type Db = Pick<PrismaClient, "guildSettings" | "craftRequest">;

async function textChannel(guild: DiscordGuild, id: string | null | undefined) {
  if (!id) return null;
  const channel = await guild.channels.fetch(id).catch(() => null);
  return channel?.isTextBased() && "messages" in channel && "send" in channel ? channel : null;
}

/**
 * Brings #craft-orders and #craft-archive in line with the request: its order line while open,
 * then one archive line. Never mentions anyone (the lines show names as plain mentions only).
 */
export async function syncCraftChannels(db: Db, guild: DiscordGuild, request: Request, lang: Lang): Promise<string | null> {
  const settings = await db.guildSettings.findUnique({ where: { guildId: request.guildId }, select: { craftOrdersEnabled: true, craftOrdersChannelId: true, craftArchiveChannelId: true } });
  if (!settings || settings.craftOrdersEnabled === false) return request.orderMessageId;
  const quiet = { allowedMentions: { parse: [] as never[] } };
  const orders = await textChannel(guild, settings.craftOrdersChannelId);
  const open = request.status === "OPEN" || request.status === "CLAIMED";
  const existing = orders && request.orderMessageId ? await orders.messages.fetch(request.orderMessageId).catch(() => null) : null;
  if (open && orders) {
    if (existing) { await existing.edit({ content: orderLine(request, lang), ...quiet }).catch(() => undefined); return existing.id; }
    const message = await orders.send({ content: orderLine(request, lang), ...quiet });
    await db.craftRequest.update({ where: { id: request.id }, data: { orderMessageId: message.id } });
    return message.id;
  }
  if (open) return request.orderMessageId;
  if (existing) await existing.delete().catch(() => undefined);
  if (request.orderMessageId) await db.craftRequest.update({ where: { id: request.id }, data: { orderMessageId: null } });
  const archive = await textChannel(guild, settings.craftArchiveChannelId);
  if (archive && !request.archiveMessageId) {
    const message = await archive.send({ content: archiveLine(request, lang), ...quiet });
    await db.craftRequest.update({ where: { id: request.id }, data: { archiveMessageId: message.id } });
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Crafter pings
// ---------------------------------------------------------------------------------------------

export interface PingCandidate { memberId: string; discordUserId: string; profession: string; lastPingAt: Date | null }

/** Who to ping: opted in, knows the recipe, not the requester, not pinged for it lately; at most MAX_PINGS. */
export function pickCraftersToPing(subscribers: readonly PingCandidate[], knowers: ReadonlySet<string>, requesterMemberId: string, now = new Date()): PingCandidate[] {
  const seen = new Set<string>();
  return subscribers.filter((row) => {
    if (seen.has(row.memberId) || row.memberId === requesterMemberId || !knowers.has(row.memberId)) return false;
    if (row.lastPingAt && now.getTime() - row.lastPingAt.getTime() < PING_COOLDOWN_MS) return false;
    seen.add(row.memberId);
    return true;
  }).sort((a, b) => (a.lastPingAt?.getTime() ?? 0) - (b.lastPingAt?.getTime() ?? 0)).slice(0, MAX_PINGS);
}

type PingDb = Pick<PrismaClient, "guildSettings" | "recipeKnown" | "character" | "craftNotify" | "member">;

/** Members (by id) whose characters know this exact recipe, with the recipe's profession. */
export async function recipeKnowers(db: PingDb, guildId: string, item: string): Promise<{ members: Set<string>; profession: string | null }> {
  const text = item.trim();
  const rows = await db.recipeKnown.findMany({ where: { guildId, ...(/^\d+$/.test(text) ? { itemKey: Number(text) } : { itemName: { equals: text, mode: "insensitive" } }) },
    select: { character: true, profession: true }, take: 200 });
  if (!rows.length) return { members: new Set(), profession: null };
  const characters = await db.character.findMany({ where: { member: { guildId, status: "ACTIVE" }, name: { in: [...new Set(rows.map((r) => r.character))], mode: "insensitive" } },
    select: { memberId: true } });
  return { members: new Set(characters.map((c) => c.memberId)), profession: rows[0]!.profession };
}

/** Pings the chosen crafters once in `send`'s channel (the request's post, else #craft-orders). Returns how many. */
export async function pingCrafters(db: PingDb, request: Pick<Request, "guildId" | "item" | "quantity" | "profession" | "requester"> & { requesterId: string },
  send: (content: string, users: string[]) => Promise<unknown>, lang: Lang, now = new Date()): Promise<number> {
  const settings = await db.guildSettings.findUnique({ where: { guildId: request.guildId }, select: { craftPingsEnabled: true } });
  if (settings?.craftPingsEnabled === false) return 0;
  const { members, profession: recipeProfession } = await recipeKnowers(db, request.guildId, request.item);
  const profession = request.profession ?? recipeProfession;
  if (!members.size || !profession) return 0;
  const rows = await db.craftNotify.findMany({ where: { guildId: request.guildId, profession }, select: { memberId: true, profession: true, lastPingAt: true } });
  if (!rows.length) return 0;
  const people = await db.member.findMany({ where: { id: { in: rows.map((r) => r.memberId) }, status: "ACTIVE" }, select: { id: true, discordUserId: true } });
  const discordOf = new Map(people.map((p) => [p.id, p.discordUserId]));
  const chosen = pickCraftersToPing(rows.flatMap((r) => discordOf.has(r.memberId) ? [{ ...r, discordUserId: discordOf.get(r.memberId)! }] : []), members, request.requesterId, now);
  if (!chosen.length) return 0;
  const t = (en: string, fr: string) => lang === "fr" ? fr : en;
  const ids = chosen.map((c) => c.discordUserId);
  await send(`${ids.map((id) => `<@${id}>`).join(" ")} ${t(`your recipe is wanted: ${request.quantity}× **${clean(request.item)}** for ${clean(request.requester.displayName)}. Press **I'll craft it** if you can.`,
    `votre recette est demandée : ${request.quantity}× **${clean(request.item)}** pour ${clean(request.requester.displayName)}. Appuyez sur **Je le fabrique** si vous pouvez.`)}\n-# ${t("You get these because you turned on crafter pings (/craft notify).", "Vous les recevez parce que vous avez activé les alertes d'artisan (/craft notify).")}`, ids);
  await db.craftNotify.updateMany({ where: { guildId: request.guildId, profession, memberId: { in: chosen.map((c) => c.memberId) } }, data: { lastPingAt: now } });
  return chosen.length;
}

/** Turns one profession's pings on or off for a member; returns the member's professions now. */
export async function setCraftNotify(db: Pick<PrismaClient, "craftNotify">, guildId: string, memberId: string, profession: string, on: boolean): Promise<string[]> {
  if (on) await db.craftNotify.upsert({ where: { memberId_profession: { memberId, profession } }, create: { guildId, memberId, profession }, update: {} });
  else await db.craftNotify.deleteMany({ where: { memberId, profession } });
  return craftNotifyList(db, memberId);
}

export async function craftNotifyList(db: Pick<PrismaClient, "craftNotify">, memberId: string): Promise<string[]> {
  return (await db.craftNotify.findMany({ where: { memberId }, select: { profession: true }, orderBy: { profession: "asc" } })).map((r) => r.profession);
}

/** Replaces a member's whole list (the board's Crafter pings menu). */
export async function replaceCraftNotify(db: Pick<PrismaClient, "craftNotify">, guildId: string, memberId: string, professions: readonly string[]): Promise<string[]> {
  await db.craftNotify.deleteMany({ where: { memberId, profession: { notIn: [...professions] } } });
  for (const profession of professions) await db.craftNotify.upsert({ where: { memberId_profession: { memberId, profession } }, create: { guildId, memberId, profession }, update: {} });
  return craftNotifyList(db, memberId);
}
