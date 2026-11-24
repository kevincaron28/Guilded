import { z } from "zod";
import { cardAttachment } from "./card-alt.js";
import { EmbedBuilder, type Guild as DiscordGuild } from "discord.js";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { forEachGuildScope, guildWhere } from "./guild-scope.js";
import { bankItems, lowStock, lowStockLines, type LowItem } from "./guild-bank-member.js";

// 9.0 guild bank ledger (docs/GUILD_BANK_LEDGER.md). Whenever anyone with access opens the guild
// bank with Guilded on, the addon keeps the contents, the gold and the game's item and money logs;
// any member's companion uploads them. Read-only: nothing here changes the bank or EP/GP.
//   * Contents: the newest reading wins.
//   * Gold history: one point per reading; a point within 5 minutes of a stored one is the same.
//   * Logs: the game gives ages in hours, so the same line (kind, type, name, item, count, tab,
//     amount) within 3 hours of a stored one is the same line, whoever uploads it.

export const SAME_LINE_MS = 3 * 3600 * 1000;
const SAME_GOLD_MS = 5 * 60 * 1000;
const FUTURE_SLACK_MS = 10 * 60 * 1000;

const epoch = z.number().int().positive();
const name = z.string().trim().min(1).max(80).refine((value) => !/[|\p{Cc}]/u.test(value));
const word = z.string().regex(/^[A-Za-z]{1,20}$/);
const copper = z.number().int().nonnegative().max(1e13);
const bankSchema = z.object({
  contents: z.object({ at: epoch, money: copper.optional(), tabs: z.array(z.object({ tab: z.number().int().min(1).max(8), name: z.string().max(40),
    items: z.array(z.object({ id: z.number().int().positive(), name: z.string().max(100), count: z.number().int().positive(),
      // 9.1: the item's quality (0 poor … 5 legendary), from its link colour.
      q: z.number().int().min(0).max(7).optional() })).max(200) })).max(8) }).optional(),
  gold: z.array(z.unknown()).max(400).default([]),
  itemLog: z.array(z.unknown()).max(1000).default([]),
  moneyLog: z.array(z.unknown()).max(1000).default([])
});
const goldSchema = z.object({ at: epoch, money: copper });
const itemLineSchema = z.object({ type: word, name, itemId: z.number().int().positive(), itemName: z.string().max(100).optional(), count: z.number().int().positive().max(1_000_000),
  tab: z.number().int().min(1).max(9).optional(), tab2: z.number().int().min(1).max(9).optional(), at: epoch });
const moneyLineSchema = z.object({ type: word, name, amount: copper, at: epoch });

export interface GuildBankResult { contents: boolean; gold: number; items: number; money: number; duplicates: number }

type Tx = Pick<Prisma.TransactionClient, "guildBankContents" | "guildBankGold" | "guildBankTransaction">;
interface Line { kind: string; type: string; actor: string; itemId: number | null; count: number | null; tab: number | null; amount: bigint | null; at: Date }

const sameLine = (a: Line, b: Line) => a.kind === b.kind && a.type === b.type && a.actor.toLowerCase() === b.actor.toLowerCase()
  && a.itemId === b.itemId && a.count === b.count && a.tab === b.tab && a.amount === b.amount && Math.abs(a.at.getTime() - b.at.getTime()) <= SAME_LINE_MS;

/** Stores one upload's guild bank data inside the caller's transaction. */
export async function applyGuildBank(tx: Tx, guildId: string, reportedById: string | null, raw: unknown, now = new Date()): Promise<GuildBankResult> {
  const result: GuildBankResult = { contents: false, gold: 0, items: 0, money: 0, duplicates: 0 };
  const parsed = bankSchema.safeParse(raw);
  if (!parsed.success) return result;
  const bank = parsed.data;
  const ok = (at: Date) => at.getTime() <= now.getTime() + FUTURE_SLACK_MS;

  if (bank.contents) {
    const at = new Date(bank.contents.at * 1000);
    const current = await tx.guildBankContents.findUnique({ where: { guildId }, select: { observedAt: true } });
    if (ok(at) && (!current || current.observedAt < at)) {
      const data = { observedAt: at, money: bank.contents.money !== undefined ? BigInt(bank.contents.money) : null, tabs: bank.contents.tabs as Prisma.InputJsonValue, reportedById };
      await tx.guildBankContents.upsert({ where: { guildId }, create: { guildId, ...data }, update: data });
      result.contents = true;
    }
  }

  const gold = bank.gold.flatMap((p) => { const g = goldSchema.safeParse(p); return g.success ? [{ at: new Date(g.data.at * 1000), money: BigInt(g.data.money) }] : []; }).filter((p) => ok(p.at));
  if (gold.length) {
    const from = new Date(Math.min(...gold.map((p) => p.at.getTime())) - SAME_GOLD_MS);
    const stored = await tx.guildBankGold.findMany({ where: { guildId, at: { gte: from } }, select: { at: true } });
    for (const point of gold) {
      if (stored.some((s) => Math.abs(s.at.getTime() - point.at.getTime()) <= SAME_GOLD_MS)) continue;
      await tx.guildBankGold.create({ data: { guildId, at: point.at, money: point.money } });
      stored.push({ at: point.at });
      result.gold++;
    }
  }

  const lines: (Line & { itemName: string | null; tab2: number | null })[] = [
    ...bank.itemLog.flatMap((l) => { const p = itemLineSchema.safeParse(l); return p.success ? [{ kind: "item", type: p.data.type, actor: p.data.name, itemId: p.data.itemId, itemName: p.data.itemName ?? null,
      count: p.data.count, tab: p.data.tab ?? null, tab2: p.data.tab2 ?? null, amount: null, at: new Date(p.data.at * 1000) }] : []; }),
    ...bank.moneyLog.flatMap((l) => { const p = moneyLineSchema.safeParse(l); return p.success ? [{ kind: "money", type: p.data.type, actor: p.data.name, itemId: null, itemName: null,
      count: null, tab: null, tab2: null, amount: BigInt(p.data.amount), at: new Date(p.data.at * 1000) }] : []; })
  ].filter((l) => ok(l.at));
  if (lines.length) {
    const from = new Date(Math.min(...lines.map((l) => l.at.getTime())) - SAME_LINE_MS);
    const known: Line[] = await tx.guildBankTransaction.findMany({ where: { guildId, at: { gte: from } },
      select: { kind: true, type: true, actor: true, itemId: true, count: true, tab: true, amount: true, at: true } });
    for (const line of lines) {
      if (known.some((stored) => sameLine(stored, line))) { result.duplicates++; continue; }
      await tx.guildBankTransaction.create({ data: { guildId, ...line, reportedById } });
      known.push(line);
      if (line.kind === "item") result.items++; else result.money++;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------------------------
// Reading it back (page and weekly summary)
// ---------------------------------------------------------------------------------------------

export interface BankActivity { actor: string; deposited: bigint; withdrawn: bigint; itemsIn: number; itemsOut: number }

/** Per person over a period: gold in and out (repairs count as out), item units in and out. */
export function summarizeLedger(rows: readonly { kind: string; type: string; actor: string; count: number | null; amount: bigint | null }[]): BankActivity[] {
  const by = new Map<string, BankActivity>();
  for (const row of rows) {
    const entry = by.get(row.actor) ?? { actor: row.actor, deposited: 0n, withdrawn: 0n, itemsIn: 0, itemsOut: 0 };
    const type = row.type.toLowerCase();
    if (row.kind === "money") {
      if (type === "deposit") entry.deposited += row.amount ?? 0n;
      else if (type === "withdraw" || type === "repair" || type === "withdrawfortab") entry.withdrawn += row.amount ?? 0n;
    } else if (type === "deposit") entry.itemsIn += row.count ?? 0;
    else if (type === "withdraw") entry.itemsOut += row.count ?? 0;
    by.set(row.actor, entry);
  }
  return [...by.values()].sort((a, b) => Number((b.deposited + b.withdrawn) - (a.deposited + a.withdrawn)) || (b.itemsIn + b.itemsOut) - (a.itemsIn + a.itemsOut) || a.actor.localeCompare(b.actor));
}

/** 12g 34s 56c, or 12,345g for large amounts. */
export function goldText(copper: bigint | number | null | undefined): string {
  if (copper === null || copper === undefined) return "?";
  const value = BigInt(copper);
  const g = value / 10000n, s = (value / 100n) % 100n, c = value % 100n;
  if (g >= 1000n) return `${g.toLocaleString("en-US")}g`;
  // No empty parts: "125g 40s", "50g", "75s" (owner, 21 Nov 2026 for donor cards; 22 Nov audit: everywhere gold is shown).
  return [g ? `${g}g` : "", s ? `${s}s` : "", c ? `${c}c` : ""].filter(Boolean).join(" ") || "0c";
}

type Db = Pick<PrismaClient, "guildBankContents" | "guildBankGold" | "guildBankTransaction">;
export async function loadGuildBank(db: Db, guildId: string, days = 30, now = new Date()) {
  const since = new Date(now.getTime() - days * 86_400_000);
  const [contents, gold, ledger] = await Promise.all([
    db.guildBankContents.findUnique({ where: { guildId } }),
    db.guildBankGold.findMany({ where: { guildId, at: { gte: since } }, orderBy: { at: "asc" } }),
    db.guildBankTransaction.findMany({ where: { guildId, at: { gte: since } }, orderBy: { at: "desc" }, take: 500 })
  ]);
  return { contents, gold, ledger };
}

/** The weekly officer post: who put in or took out what. Nothing when the bank did not move. */
export function weeklyBankText(rows: Parameters<typeof summarizeLedger>[0], goldBefore: bigint | null, goldNow: bigint | null, lang: "en" | "fr",
  extra: { low?: readonly LowItem[]; openRequests?: number; /** The card carries the gold, the top depositors and the request count: only the per-member lines and the low-stock list stay as text. */ compact?: boolean } = {}): string | null {
  if (!rows.length) return null;
  const t = (en: string, fr: string) => lang === "fr" ? fr : en;
  const people = summarizeLedger(rows).slice(0, 15).map((p) => {
    const parts = [p.deposited ? `+${goldText(p.deposited)}` : "", p.withdrawn ? `−${goldText(p.withdrawn)}` : "",
      p.itemsIn ? t(`${p.itemsIn} item(s) in`, `${p.itemsIn} objet(s) déposé(s)`) : "", p.itemsOut ? t(`${p.itemsOut} item(s) out`, `${p.itemsOut} objet(s) retiré(s)`) : ""].filter(Boolean);
    return `• **${p.actor}**: ${parts.join(" · ")}`;
  });
  const goldLine = goldNow !== null ? `${t("Gold now", "Or actuel")}: **${goldText(goldNow)}**${goldBefore !== null ? ` (${goldNow >= goldBefore ? "+" : "−"}${goldText(goldNow >= goldBefore ? goldNow - goldBefore : goldBefore - goldNow)} ${t("this week", "cette semaine")})` : ""}` : "";
  // 9.1: top depositors, what is below its minimum and how many requests wait.
  const givers = summarizeLedger(rows).filter((p) => p.deposited > 0n || p.itemsIn > 0)
    .sort((a, b) => Number(b.deposited - a.deposited) || b.itemsIn - a.itemsIn).slice(0, 3);
  const extraLines = extra.compact ? [...(extra.low?.length ? [`${t("Below minimum", "Sous le minimum")}:`, ...lowStockLines(extra.low, lang, 8)] : [])] : [
    ...(givers.length ? [`${t("Top depositors", "Meilleurs donateurs")}: ${givers.map((p) => `**${p.actor}**`).join(", ")}`] : []),
    ...(extra.low?.length ? [`${t("Below minimum", "Sous le minimum")}:`, ...lowStockLines(extra.low, lang, 8)] : []),
    ...(extra.openRequests ? [`${t("Open bank requests", "Demandes ouvertes")}: **${extra.openRequests}** (\`/officer bank list\`)`] : [])
  ];
  return [...(extra.compact ? [] : [goldLine]), `${rows.length} ${t("log line(s) this week", "ligne(s) de journal cette semaine")}`, ...(extraLines.length ? ["", ...extraLines] : []), "", ...people].filter((line, i) => line || i > 0).join("\n").slice(0, 3900);
}

/** The weekly card's picture (null when it cannot be drawn). */
async function bankWeekPng(rows: Parameters<typeof summarizeLedger>[0], before: bigint | null, now: bigint | null, lang: "en" | "fr", low: readonly LowItem[], openRequests: number): Promise<Buffer | null> {
  const [{ guildBankWeekCard }, { scoreCardPng }] = await Promise.all([import("./guild-bank-card.js"), import("./score-card.js")]);
  const delta = now !== null && before !== null ? now - before : null;
  const givers = summarizeLedger(rows).filter(p => p.deposited > 0n || p.itemsIn > 0).sort((a, b) => Number(b.deposited - a.deposited) || b.itemsIn - a.itemsIn).slice(0, 3)
    .map(p => ({ name: p.actor, gift: [p.deposited ? `+${goldText(p.deposited)}` : "", p.itemsIn ? (lang === "fr" ? `${p.itemsIn} objet(s)` : `${p.itemsIn} item(s)`) : ""].filter(Boolean).join(" · ") }));
  return scoreCardPng(guildBankWeekCard(lang, { goldNow: now === null ? null : goldText(now), change: delta === null ? "" : `${delta >= 0n ? "+" : "−"}${goldText(delta >= 0n ? delta : -delta)}`, changeTone: delta === null ? null : delta >= 0n ? "green" : "red",
    logLines: rows.length, openRequests, low, givers }));
}

const DAY = 86_400_000;
type WeeklyDb = Db & Pick<PrismaClient, "guild" | "guildSettings" | "guildBankTarget" | "bankRequest">;

/** Weekly summary in the officer log channel. On by default, at most once every 7 days, never when nothing moved. */
export async function postWeeklyGuildBank(db: WeeklyDb, discordGuild: DiscordGuild, now = new Date()): Promise<boolean> {
  const guild = await db.guild.findUnique({ where: guildWhere(discordGuild.id), select: { id: true, settings: true } });
  const settings = guild?.settings;
  if (!guild || !settings || settings.guildBankWeeklyEnabled === false || !settings.logChannelId) return false;
  if (settings.guildBankLastPostAt && now.getTime() - settings.guildBankLastPostAt.getTime() < 7 * DAY - 3_600_000) return false;
  const since = new Date(now.getTime() - 7 * DAY);
  const rows = await db.guildBankTransaction.findMany({ where: { guildId: guild.id, at: { gte: since } }, select: { kind: true, type: true, actor: true, count: true, amount: true } });
  const before = await db.guildBankGold.findFirst({ where: { guildId: guild.id, at: { lte: since } }, orderBy: { at: "desc" } });
  const latest = await db.guildBankGold.findFirst({ where: { guildId: guild.id }, orderBy: { at: "desc" } });
  const lang = settings.language === "fr" ? "fr" : "en";
  const [contents, targets, openRequests] = await Promise.all([db.guildBankContents.findUnique({ where: { guildId: guild.id }, select: { tabs: true } }),
    db.guildBankTarget.findMany({ where: { guildId: guild.id } }), db.bankRequest.count({ where: { guildId: guild.id, status: { in: ["PENDING", "APPROVED"] } } })]);
  const low = contents ? lowStock(bankItems(contents.tabs), targets) : [];
  const text = weeklyBankText(rows, before?.money ?? null, latest?.money ?? null, lang, { low, openRequests });
  if (!text) return false;
  const channel = await discordGuild.channels.fetch(settings.logChannelId).catch(() => null);
  if (!channel?.isTextBased() || !("send" in channel)) return false;
  // 24 Nov 2026: the headline figures are a card; the post keeps the per-member lines and the low-stock list. Best effort: without the picture the whole text goes out as before.
  const png = await bankWeekPng(rows, before?.money ?? null, latest?.money ?? null, lang, low, openRequests).catch(() => null);
  const compact = png ? weeklyBankText(rows, before?.money ?? null, latest?.money ?? null, lang, { low, openRequests, compact: true }) : null;
  const embed = new EmbedBuilder().setColor(0xd4af37).setDescription(compact ?? text);
  if (png) embed.setImage("attachment://bank-week.png"); else embed.setTitle(lang === "fr" ? "🏦 Banque de guilde : la semaine" : "🏦 Guild bank: this week");
  await channel.send({ embeds: [embed], ...(png ? { files: [cardAttachment(png, "bank-week.png")] } : {}), allowedMentions: { parse: [] } });
  await db.guildSettings.update({ where: { guildId: guild.id }, data: { guildBankLastPostAt: now } });
  return true;
}

export async function postAllWeeklyGuildBanks(db: WeeklyDb, guilds: Iterable<DiscordGuild>, report: (error: unknown) => void): Promise<void> {
  for (const guild of guilds) await forEachGuildScope(db as PrismaClient, guild.id, () => postWeeklyGuildBank(db, guild)).catch(report);
}
