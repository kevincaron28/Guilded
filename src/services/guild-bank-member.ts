import { z } from "zod";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, type Client, type Guild as DiscordGuild } from "discord.js";
import type { BankRequest, BankRequestStatus, Member, PrismaClient } from "../generated/prisma/client.js";
import { guildWhere } from "./guild-scope.js";

// 9.1 guild bank additions (docs/plans/GUILD_BANK.md), on top of the 9.0 ledger (guild-bank.ts):
//   1. Member search: what the bank held when someone last opened it, by item, with its tabs.
//      Contents only: who deposited or withdrew what stays officer-only.
//   5. Item links: every item name links to its Wowhead page; the addon sends the item's quality.
//   2. Requests: a card with Approve / Fulfilled / Deny buttons for officers, a DM to the member.
//   3. Minimum stock: officers set a target per item; one alert when an upload shows less.
// Everything is on by default with an officer off switch (/bank settings, ROADMAP rule 5).

export type Lang = "en" | "fr";
const say = (lang: Lang) => (en: string, fr: string) => lang === "fr" ? fr : en;

export interface BankItem { id: number; name: string; count: number; quality?: number; tabs: { tab: number; name: string; count: number }[] }
export interface LowItem { itemId: number; itemName: string; have: number; min: number }

const QUALITY_HEX = ["#9d9d9d", "#ffffff", "#1eff00", "#0070dd", "#a335ee", "#ff8000", "#e6cc80", "#e6cc80"];
/** Common (white) items keep the page's own colour, so they stay readable on a light page. */
export const qualityColor = (quality?: number) => quality !== undefined && quality !== 1 ? QUALITY_HEX[quality] : undefined;
export const itemUrl = (id: number) => `https://www.wowhead.com/classic/item=${id}`;

/** Markdown for Discord: the name in brackets, linked to Wowhead, never a mention or a broken link. */
export function itemMarkdown(id: number, name: string): string {
  const clean = name.replace(/[[\]()<>@*_`~|\\]/g, "").trim().slice(0, 80) || `Item ${id}`;
  return `[${clean}](<${itemUrl(id)}>)`;
}

/** The stored contents (GuildBankContents.tabs) as one row per item, counts summed over tabs. */
export function bankItems(tabs: unknown): BankItem[] {
  const by = new Map<number, BankItem>();
  for (const tab of Array.isArray(tabs) ? tabs : []) {
    if (!tab || typeof tab !== "object") continue;
    const { tab: index, name: tabName, items } = tab as { tab?: unknown; name?: unknown; items?: unknown };
    if (typeof index !== "number" || !Array.isArray(items)) continue;
    for (const raw of items) {
      const item = raw as { id?: unknown; name?: unknown; count?: unknown; q?: unknown };
      if (typeof item?.id !== "number" || typeof item.count !== "number" || item.count < 1) continue;
      const entry = by.get(item.id) ?? { id: item.id, name: typeof item.name === "string" ? item.name : `Item ${item.id}`, count: 0, tabs: [] };
      if (typeof item.q === "number" && Number.isInteger(item.q) && item.q >= 0 && item.q <= 7) entry.quality = item.q;
      entry.count += item.count;
      entry.tabs.push({ tab: index, name: typeof tabName === "string" ? tabName : `Tab ${index}`, count: item.count });
      by.set(item.id, entry);
    }
  }
  return [...by.values()].sort((a, b) => a.name.localeCompare(b.name));
}

const fold = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();

/** Items whose name has every word of the query; an exact name or item id first. */
export function searchBankItems(items: readonly BankItem[], query: string): BankItem[] {
  const q = fold(query);
  if (!q) return [...items];
  const id = /^#?(\d+)$/.exec(q)?.[1];
  const words = q.split(/\s+/);
  const hits = items.filter((item) => (id && item.id === Number(id)) || words.every((w) => fold(item.name).includes(w)));
  return hits.sort((a, b) => Number(fold(b.name) === q) - Number(fold(a.name) === q) || a.name.localeCompare(b.name));
}

/** The one item a typed name or id means, if exactly one matches (an exact name wins). */
export function resolveBankItem(items: readonly BankItem[], query: string): BankItem | null {
  const exact = items.find((item) => fold(item.name) === fold(query) || `#${item.id}` === query.trim() || String(item.id) === query.trim());
  if (exact) return exact;
  const hits = searchBankItems(items, query);
  return hits.length === 1 ? hits[0]! : null;
}

export function lowStock(items: readonly BankItem[], targets: readonly { itemId: number; itemName: string; minCount: number }[]): LowItem[] {
  const have = new Map(items.map((item) => [item.id, item.count]));
  return targets.map((t) => ({ itemId: t.itemId, itemName: t.itemName, have: have.get(t.itemId) ?? 0, min: t.minCount }))
    .filter((row) => row.have < row.min).sort((a, b) => a.have / a.min - b.have / b.min || a.itemName.localeCompare(b.itemName));
}

export function lowStockLines(rows: readonly LowItem[], lang: Lang, max = 15): string[] {
  const t = say(lang);
  const lines = rows.slice(0, max).map((row) => `• ${itemMarkdown(row.itemId, row.itemName)}: ${row.have} / ${row.min}`);
  if (rows.length > max) lines.push(t(`…and ${rows.length - max} more.`, `…et ${rows.length - max} de plus.`));
  return lines;
}

/** The /bank search answer. */
export function searchReplyText(items: readonly BankItem[], query: string, observedAt: Date | null, lang: Lang): string {
  const t = say(lang);
  if (!observedAt) return t("No guild bank contents yet. They arrive when someone with access opens the guild bank with Guilded on and a companion syncs.",
    "Pas encore de contenu de banque de guilde. Il arrive quand quelqu'un ayant accès ouvre la banque avec Guilded et qu'un compagnon synchronise.");
  const hits = searchBankItems(items, query);
  const seen = t(`As of <t:${Math.floor(observedAt.getTime() / 1000)}:R> (when the bank was last opened with Guilded).`,
    `Au <t:${Math.floor(observedAt.getTime() / 1000)}:R> (dernière ouverture de la banque avec Guilded).`);
  if (!hits.length) return `${t(`Not in the guild bank: **${query.replace(/[*_`~|]/g, "").slice(0, 80)}**.`, `Pas dans la banque de guilde : **${query.replace(/[*_`~|]/g, "").slice(0, 80)}**.`)}\n${seen}`;
  const lines = hits.slice(0, 15).map((item) => `• ${itemMarkdown(item.id, item.name)} ×${item.count} — ${item.tabs.map((tab) => `${tab.name.replace(/[*_`~|]/g, "")}${item.tabs.length > 1 ? ` ×${tab.count}` : ""}`).join(", ")}`);
  if (hits.length > 15) lines.push(t(`…and ${hits.length - 15} more. Type more of the name.`, `…et ${hits.length - 15} de plus. Précisez le nom.`));
  return [...lines, "", seen, t("Ask for one with `/bank request`.", "Demandez-en avec `/bank request`.")].join("\n").slice(0, 1990);
}

// ---------------------------------------------------------------------------------------------
// Minimum stock
// ---------------------------------------------------------------------------------------------

type StockDb = Pick<PrismaClient, "guildBankContents" | "guildBankTarget">;

/** After new contents: marks targets that went low (returned, for one alert) and clears those back above. */
export async function updateStockState(db: StockDb, guildId: string, now = new Date()): Promise<LowItem[]> {
  const [contents, targets] = await Promise.all([db.guildBankContents.findUnique({ where: { guildId }, select: { tabs: true } }),
    db.guildBankTarget.findMany({ where: { guildId } })]);
  if (!contents || !targets.length) return [];
  const low = lowStock(bankItems(contents.tabs), targets);
  const lowIds = new Set(low.map((row) => row.itemId));
  const fresh: LowItem[] = [];
  for (const target of targets) {
    if (lowIds.has(target.itemId) && !target.lowSince) {
      await db.guildBankTarget.update({ where: { id: target.id }, data: { lowSince: now } });
      fresh.push(low.find((row) => row.itemId === target.itemId)!);
    } else if (!lowIds.has(target.itemId) && target.lowSince) {
      await db.guildBankTarget.update({ where: { id: target.id }, data: { lowSince: null } });
    }
  }
  return fresh;
}

type AlertDb = StockDb & Pick<PrismaClient, "guild">;

/** One post in the officer log channel for items that just went below their target. Officer off switch: /bank settings stock_alerts:False. */
export async function alertLowStock(client: Client, db: AlertDb, guildId: string, now = new Date()): Promise<boolean> {
  const guild = await db.guild.findUnique({ where: { id: guildId }, select: { discordId: true, settings: { select: { guildBankStockAlerts: true, logChannelId: true, language: true } } } });
  const settings = guild?.settings;
  if (!guild || !settings) return false;
  const fresh = await updateStockState(db, guildId, now);
  if (!fresh.length || settings.guildBankStockAlerts === false || !settings.logChannelId) return false;
  const lang: Lang = settings.language === "fr" ? "fr" : "en";
  const t = say(lang);
  const channel = await client.channels.fetch(settings.logChannelId).catch(() => null);
  if (!channel?.isTextBased() || !("send" in channel)) return false;
  await channel.send({ embeds: [new EmbedBuilder().setColor(0xc9a227).setTitle(t("🏦 Guild bank: running low", "🏦 Banque de guilde : stock bas"))
    .setDescription([...lowStockLines(fresh, lang), "", t("Have / target. Change targets with `/bank stock`; turn these off with `/bank settings stock_alerts:False`.",
      "Disponible / cible. Modifiez les cibles avec `/bank stock`; désactivez avec `/bank settings stock_alerts:False`.")].join("\n").slice(0, 3900))],
    allowedMentions: { parse: [] } });
  return true;
}

// ---------------------------------------------------------------------------------------------
// Request cards (officer queue) and the requester's DM
// ---------------------------------------------------------------------------------------------

export const BANK_REQUEST_PREFIX = "bankreq:";
const ICON: Record<BankRequestStatus, string> = { PENDING: "⏳", APPROVED: "👍", FULFILLED: "✅", DENIED: "❌", CANCELLED: "🚫" };
const WORD: Record<BankRequestStatus, [string, string]> = {
  PENDING: ["pending", "en attente"], APPROVED: ["approved", "approuvée"], FULFILLED: ["fulfilled", "remise"], DENIED: ["denied", "refusée"], CANCELLED: ["cancelled", "annulée"]
};
export const statusWord = (status: BankRequestStatus, lang: Lang) => WORD[status][lang === "fr" ? 1 : 0];
export const statusIcon = (status: BankRequestStatus) => ICON[status];

type RequestWithMember = BankRequest & { member: Pick<Member, "displayName" | "discordUserId"> };

const requestItem = (r: Pick<BankRequest, "item" | "itemId">) => r.itemId ? itemMarkdown(r.itemId, r.item) : `**${r.item.replace(/[*_`~|]/g, "")}**`;

export function requestCard(request: RequestWithMember, lang: Lang, have?: number) {
  const t = say(lang);
  const open = request.status === "PENDING" || request.status === "APPROVED";
  const lines = [
    `${request.quantity} × ${requestItem(request)} — ${t("for", "pour")} <@${request.member.discordUserId}>`,
    ...(request.note ? [`> ${request.note.replace(/\n/g, " ").slice(0, 300)}`] : []),
    ...(have !== undefined ? [t(`In the bank: ${have}`, `En banque : ${have}`)] : []),
    `${ICON[request.status]} ${statusWord(request.status, lang)}${request.handledBy ? ` · <@${request.handledBy}>` : ""}${request.reply ? ` · "${request.reply.slice(0, 200)}"` : ""}`,
    request.source === "addon" ? t("Asked in game.", "Demandé en jeu.") : ""
  ].filter(Boolean);
  const embed = new EmbedBuilder().setColor(open ? 0xc9a227 : request.status === "FULFILLED" ? 0x2e7d32 : 0x777777)
    .setTitle(t("📦 Guild bank request", "📦 Demande à la banque de guilde")).setDescription(lines.join("\n")).setFooter({ text: request.id });
  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    ...(request.status === "PENDING" ? [new ButtonBuilder().setCustomId(`${BANK_REQUEST_PREFIX}${request.id}:APPROVED`).setLabel(t("Approve", "Approuver")).setStyle(ButtonStyle.Secondary)] : []),
    new ButtonBuilder().setCustomId(`${BANK_REQUEST_PREFIX}${request.id}:FULFILLED`).setLabel(t("Fulfilled", "Remise")).setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`${BANK_REQUEST_PREFIX}${request.id}:DENIED`).setLabel(t("Deny", "Refuser")).setStyle(ButtonStyle.Danger));
  return { embeds: [embed], components: open ? [buttons] : [], allowedMentions: { parse: [] as never[] } };
}

type CardDb = Pick<PrismaClient, "guild" | "bankRequest" | "guildBankContents">;

async function cardContext(db: CardDb, guildId: string) {
  const guild = await db.guild.findUnique({ where: { id: guildId }, select: { discordId: true, settings: { select: { guildBankRequestPosts: true, bankRequestChannelId: true, logChannelId: true, language: true } } } });
  const lang: Lang = guild?.settings?.language === "fr" ? "fr" : "en";
  return { guild, lang };
}

async function haveCount(db: CardDb, guildId: string, itemId: number | null): Promise<number | undefined> {
  if (!itemId) return undefined;
  const contents = await db.guildBankContents.findUnique({ where: { guildId }, select: { tabs: true } });
  return contents ? bankItems(contents.tabs).find((item) => item.id === itemId)?.count ?? 0 : undefined;
}

/** Posts the officer card for a new request (request channel, else the log channel). Off switch: /bank settings request_posts:False. */
export async function postRequestCard(client: Client, db: CardDb, request: RequestWithMember): Promise<boolean> {
  const { guild, lang } = await cardContext(db, request.guildId);
  const settings = guild?.settings;
  if (!settings || settings.guildBankRequestPosts === false) return false;
  const channelId = settings.bankRequestChannelId ?? settings.logChannelId;
  if (!channelId) return false;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased() || !("send" in channel)) return false;
  const message = await channel.send(requestCard(request, lang, await haveCount(db, request.guildId, request.itemId)));
  await db.bankRequest.update({ where: { id: request.id }, data: { channelId: channel.id, messageId: message.id } });
  return true;
}

/** Brings the card up to date after a change (buttons go away once the request is closed). */
export async function refreshRequestCard(client: Client, db: CardDb, request: RequestWithMember): Promise<void> {
  if (!request.channelId || !request.messageId) return;
  const { lang } = await cardContext(db, request.guildId);
  const channel = await client.channels.fetch(request.channelId).catch(() => null);
  if (!channel?.isTextBased() || !("messages" in channel)) return;
  const message = await channel.messages.fetch(request.messageId).catch(() => null);
  await message?.edit(requestCard(request, lang, await haveCount(db, request.guildId, request.itemId))).catch(() => undefined);
}

/** The requester's DM when an officer handles it. Closed DMs are fine: /bank mine and the addon show it too. */
export async function dmRequester(client: Client, request: RequestWithMember, lang: Lang): Promise<void> {
  const t = say(lang);
  await client.users.send(request.member.discordUserId, {
    content: `${ICON[request.status]} ${t(`Your guild bank request for ${request.quantity} × ${requestItem(request)} was ${statusWord(request.status, lang)}`,
      `Votre demande de ${request.quantity} × ${requestItem(request)} à la banque de guilde a été ${statusWord(request.status, lang)}`)}${request.reply ? `: "${request.reply}"` : "."}`,
    allowedMentions: { parse: [] }
  }).catch(() => undefined);
}

export async function guildLang(db: Pick<PrismaClient, "guildSettings">, guildId: string): Promise<Lang> {
  return (await db.guildSettings.findUnique({ where: { guildId }, select: { language: true } }))?.language === "fr" ? "fr" : "en";
}

export async function guildIdForDiscord(db: Pick<PrismaClient, "guild">, discordGuild: DiscordGuild): Promise<string | null> {
  return (await db.guild.findUnique({ where: guildWhere(discordGuild.id), select: { id: true } }))?.id ?? null;
}

// ---------------------------------------------------------------------------------------------
// What the addon gets back (standings feed, `bank`): contents for members who never opened the
// bank, the low list, and this member's own requests, so the addon stops re-sending them.
// ---------------------------------------------------------------------------------------------

type FeedDb = Pick<PrismaClient, "guildBankContents" | "guildBankTarget" | "bankRequest" | "guildSettings">;

export async function bankForAddon(db: FeedDb, guildId: string, memberId: string, officer: boolean) {
  const settings = await db.guildSettings.findUnique({ where: { guildId }, select: { guildBankMemberSearch: true } });
  const canSearch = officer || settings?.guildBankMemberSearch !== false;
  const [contents, targets, requests, open] = await Promise.all([
    canSearch ? db.guildBankContents.findUnique({ where: { guildId }, select: { observedAt: true, money: true, tabs: true } }) : null,
    canSearch ? db.guildBankTarget.findMany({ where: { guildId } }) : [],
    db.bankRequest.findMany({ where: { guildId, memberId }, orderBy: { createdAt: "desc" }, take: 15, select: { clientRef: true, item: true, quantity: true, status: true, createdAt: true } }),
    officer ? db.bankRequest.count({ where: { guildId, status: { in: ["PENDING", "APPROVED"] } } }) : Promise.resolve(null)
  ]);
  const items = contents ? bankItems(contents.tabs) : [];
  return {
    ...(contents ? { at: Math.floor(contents.observedAt.getTime() / 1000), money: contents.money !== null ? Number(contents.money) : null,
      items: items.slice(0, 400).map((item) => ({ id: item.id, name: item.name, count: item.count, tab: item.tabs[0]?.name ?? "", ...(item.quality !== undefined ? { q: item.quality } : {}) })) } : {}),
    low: lowStock(items, targets).slice(0, 30),
    requests: requests.map((r) => ({ ref: r.clientRef ?? "", item: r.item, count: r.quantity, status: r.status, at: Math.floor(r.createdAt.getTime() / 1000) })),
    ...(open !== null ? { open } : {})
  };
}

// ---------------------------------------------------------------------------------------------
// Requests made in game: db.bankRequests in the addon, uploaded by the member's own companion.
// ---------------------------------------------------------------------------------------------

const addonRequestSchema = z.object({
  ref: z.string().regex(/^[A-Za-z0-9-]{6,40}$/),
  item: z.string().trim().min(2).max(100).refine((value) => !/[|\p{Cc}]/u.test(value)),
  itemId: z.number().int().positive().optional(),
  count: z.number().int().min(1).max(1000),
  note: z.string().max(300).optional()
});
export type AddonBankRequest = z.infer<typeof addonRequestSchema>;

export function parseAddonBankRequests(rows: readonly unknown[]): AddonBankRequest[] {
  return rows.flatMap((row) => { const parsed = addonRequestSchema.safeParse(row); return parsed.success ? [parsed.data] : []; }).slice(0, 10);
}
