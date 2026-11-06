import { z } from "zod";
import { EmbedBuilder, type Guild as DiscordGuild } from "discord.js";
import type { Prisma, PrismaClient } from "../generated/prisma/client.js";
import { forEachGuildScope, guildWhere } from "./guild-scope.js";

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
    items: z.array(z.object({ id: z.number().int().positive(), name: z.string().max(100), count: z.number().int().positive() })).max(200) })).max(8) }).optional(),
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
  return g >= 1000n ? `${g.toLocaleString("en-US")}g` : `${g}g ${s}s ${c}c`;
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
export function weeklyBankText(rows: Parameters<typeof summarizeLedger>[0], goldBefore: bigint | null, goldNow: bigint | null, lang: "en" | "fr"): string | null {
  if (!rows.length) return null;
  const t = (en: string, fr: string) => lang === "fr" ? fr : en;
  const people = summarizeLedger(rows).slice(0, 15).map((p) => {
    const parts = [p.deposited ? `+${goldText(p.deposited)}` : "", p.withdrawn ? `−${goldText(p.withdrawn)}` : "",
      p.itemsIn ? t(`${p.itemsIn} item(s) in`, `${p.itemsIn} objet(s) déposé(s)`) : "", p.itemsOut ? t(`${p.itemsOut} item(s) out`, `${p.itemsOut} objet(s) retiré(s)`) : ""].filter(Boolean);
    return `• **${p.actor}**: ${parts.join(" · ")}`;
  });
  const goldLine = goldNow !== null ? `${t("Gold now", "Or actuel")}: **${goldText(goldNow)}**${goldBefore !== null ? ` (${goldNow >= goldBefore ? "+" : "−"}${goldText(goldNow >= goldBefore ? goldNow - goldBefore : goldBefore - goldNow)} ${t("this week", "cette semaine")})` : ""}` : "";
  return [goldLine, `${rows.length} ${t("log line(s) this week", "ligne(s) de journal cette semaine")}`, "", ...people,
    "", t("Full ledger: the Guild bank page on the guild tools site.", "Registre complet : la page Banque de guilde du site d'outils.")].filter((line, i) => line || i > 0).join("\n").slice(0, 3900);
}

const DAY = 86_400_000;
type WeeklyDb = Db & Pick<PrismaClient, "guild" | "guildSettings">;

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
  const text = weeklyBankText(rows, before?.money ?? null, latest?.money ?? null, lang);
  if (!text) return false;
  const channel = await discordGuild.channels.fetch(settings.logChannelId).catch(() => null);
  if (!channel?.isTextBased() || !("send" in channel)) return false;
  await channel.send({ embeds: [new EmbedBuilder().setColor(0xc9a227).setTitle(lang === "fr" ? "🏦 Banque de guilde : la semaine" : "🏦 Guild bank: this week").setDescription(text)], allowedMentions: { parse: [] } });
  await db.guildSettings.update({ where: { guildId: guild.id }, data: { guildBankLastPostAt: now } });
  return true;
}

export async function postAllWeeklyGuildBanks(db: WeeklyDb, guilds: Iterable<DiscordGuild>, report: (error: unknown) => void): Promise<void> {
  for (const guild of guilds) await forEachGuildScope(db as PrismaClient, guild.id, () => postWeeklyGuildBank(db, guild)).catch(report);
}
