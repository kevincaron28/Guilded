import type { Guild as DiscordGuild } from "discord.js";
import type { PrismaClient } from "../generated/prisma/client.js";
import type { Lang } from "../i18n.js";
import { enqueueDiscordJob } from "./discord-jobs.js";
import { goldText } from "./guild-bank.js";

/** Gold on a donor card without empty parts: "125g 40s", "50g", "75s" (owner review 22 Nov 2026: "0c" read as noise). */
export function donationGold(copper: bigint): string {
  if (copper >= 10_000_000n) return goldText(copper);
  const g = copper / 10000n, s = (copper / 100n) % 100n, c = copper % 100n;
  return [g ? `${g}g` : "", s ? `${s}s` : "", c ? `${c}c` : ""].filter(Boolean).join(" ") || "0c";
}
import { bankItems } from "./guild-bank-member.js";
import { displayCharacterName, loadFullNameBook } from "./character-display.js";
import { guildChannelLikes, guildPostable, wowChatChannel, type WowChatDb } from "./wow-chat.js";
import { combinedDonationCard, combinedDonationText, donationCard, donationText, type DonorTotal } from "./card-donation.js";
import { textlessEmbed } from "./card-only.js";
import { withGuildScope } from "./guild-scope.js";

/**
 * Guild bank donor cards (owner request, 21 Nov 2026): a thank-you card in the WoW chat channel (wow-chat.ts, shared with the promotion
 * cards) for each member who deposits items or gold in the guild bank. On by default; officers switch it off with
 * `/officer bank settings donation_cards:false`.
 *
 * Rules:
 *  - Only DEPOSIT lines (items and gold), never withdrawals, moves, repairs or tab purchases.
 *  - Never the backlog: the migration stamped every stored line `donationSeenAt`; a new line counts only when its game time is at most
 *    DONATION_MAX_AGE_MS before it was first received (a new officer's first upload of an old log announces nothing).
 *  - Once per deposit: the ingest (guild-bank.ts) already stores the same log line once whoever uploads it; a line is claimed by setting
 *    `donationSeenAt` before its card is queued, and a line matching an already seen one (same donor, item, count or amount within
 *    DONATION_SAME_LINE_MS) is passed over, in case two uploads' coarse game times fell further apart than the ingest window.
 *  - One card per donor per visit: a donor's new lines wait until nothing new from them arrived for DONATION_SETTLE_MS, then share a card.
 *  - Gold-only deposits under DONATION_MIN_COPPER are passed over (items always count).
 *  - At most DONATION_CARDS_PER_HOUR cards per server; when more donors are ready, the last card thanks the rest together, and with no
 *    card left this hour the donors wait for the next sweep (and fold into one combined card then).
 */
export const DONATION_MIN_COPPER = 10 * 10_000;
export const DONATION_MAX_AGE_MS = 24 * 3_600_000;
export const DONATION_SETTLE_MS = 15 * 60_000;
export const DONATION_SAME_LINE_MS = 6 * 3_600_000;
export const DONATION_CARDS_PER_HOUR = 3;
export const DONATION_JOB_PREFIX = "bank-donation:";

export interface DonationRow { id: string; kind: string; type: string; actor: string; itemId: number | null; itemName: string | null; count: number | null; amount: bigint | null; at: Date; createdAt: Date }
export interface DonorGroup { actor: string; rows: DonationRow[]; copper: bigint; items: { itemId: number | null; name: string; count: number }[] }
export interface DonationPlan {
  /** Lines to stamp now (announced, or passed over for good). */ seen: string[];
  /** Donors that get their own card. */ single: DonorGroup[];
  /** Donors thanked together on one card (empty, or two and more). */ combined: DonorGroup[];
}

const isDeposit = (row: Pick<DonationRow, "type">) => row.type.toLowerCase() === "deposit";
const key = (name: string) => name.trim().normalize("NFC").toLowerCase();
const sameLine = (a: DonationRow, b: DonationRow) => a.kind === b.kind && key(a.actor) === key(b.actor) && a.itemId === b.itemId && a.count === b.count
  && a.amount === b.amount && Math.abs(a.at.getTime() - b.at.getTime()) <= DONATION_SAME_LINE_MS;

/** Pure: one donor's lines summed (gold, and each item's count). */
export function donorGroup(rows: DonationRow[]): DonorGroup {
  const items = new Map<string, { itemId: number | null; name: string; count: number }>();
  let copper = 0n;
  for (const r of rows) {
    if (r.kind === "money") { copper += r.amount ?? 0n; continue; }
    const k = r.itemId !== null ? `#${r.itemId}` : `n:${key(r.itemName ?? "")}`;
    const entry = items.get(k) ?? { itemId: r.itemId, name: r.itemName?.trim() || (r.itemId ? `Item ${r.itemId}` : "?"), count: 0 };
    entry.count += r.count ?? 1;
    items.set(k, entry);
  }
  return { actor: rows[0]!.actor, rows, copper, items: [...items.values()] };
}

/** Pure: what to announce from a server's unseen lines. `seenBefore` are already stamped lines near them (duplicate check). */
export function planDonations(pending: readonly DonationRow[], seenBefore: readonly DonationRow[], options: { now: Date; enabled: boolean; cardsLeft: number }): DonationPlan {
  const seen: string[] = [], waiting = new Map<string, DonationRow[]>();
  for (const row of pending) {
    if (!isDeposit(row) || (row.kind !== "item" && row.kind !== "money")) { seen.push(row.id); continue; }
    if (row.createdAt.getTime() - row.at.getTime() > DONATION_MAX_AGE_MS) { seen.push(row.id); continue; }
    if (seenBefore.some((old) => old.id !== row.id && sameLine(old, row))) { seen.push(row.id); continue; }
    const list = waiting.get(key(row.actor)) ?? [];
    list.push(row);
    waiting.set(key(row.actor), list);
  }
  const ready: DonorGroup[] = [];
  for (const rows of waiting.values()) {
    const newest = Math.max(...rows.map((r) => r.createdAt.getTime()));
    if (options.now.getTime() - newest < DONATION_SETTLE_MS) continue; // still depositing: wait for the visit to end
    const group = donorGroup(rows);
    if (!group.items.length && group.copper < BigInt(DONATION_MIN_COPPER)) { seen.push(...rows.map((r) => r.id)); continue; }
    ready.push(group);
  }
  if (!options.enabled) return { seen: [...seen, ...ready.flatMap((g) => g.rows.map((r) => r.id))], single: [], combined: [] };
  if (options.cardsLeft <= 0 || !ready.length) return { seen, single: [], combined: [] };
  ready.sort((a, b) => Math.min(...a.rows.map((r) => r.at.getTime())) - Math.min(...b.rows.map((r) => r.at.getTime())) || a.actor.localeCompare(b.actor));
  const single = ready.length <= options.cardsLeft ? ready : ready.slice(0, options.cardsLeft - 1);
  const combined = ready.length <= options.cardsLeft ? [] : ready.slice(options.cardsLeft - 1);
  return { seen: [...seen, ...ready.flatMap((g) => g.rows.map((r) => r.id))], single, combined };
}

type DonationDb = WowChatDb & Pick<PrismaClient, "guildSettings" | "guildBankTransaction" | "guildBankContents" | "discordJob" | "character"> & Parameters<typeof loadFullNameBook>[0];

/** Announces one server's ready donors. Returns the number of cards queued. */
export async function announceBankDonations(db: DonationDb, discordGuild: Parameters<typeof guildChannelLikes>[0], guildId: string, now = new Date()): Promise<number> {
  const pending: DonationRow[] = await db.guildBankTransaction.findMany({ where: { guildId, donationSeenAt: null }, orderBy: { at: "asc" }, take: 500,
    select: { id: true, kind: true, type: true, actor: true, itemId: true, itemName: true, count: true, amount: true, at: true, createdAt: true } });
  if (!pending.length) return 0;
  const settings = await db.guildSettings.findUnique({ where: { guildId }, select: { language: true, guildBankDonationCards: true } });
  const enabled = settings?.guildBankDonationCards !== false;
  const channelId = enabled ? await wowChatChannel(db, guildId, guildChannelLikes(discordGuild), guildPostable(discordGuild as never)) : null;
  const from = new Date(Math.min(...pending.map((r) => r.at.getTime())) - DONATION_SAME_LINE_MS);
  const seenBefore: DonationRow[] = await db.guildBankTransaction.findMany({ where: { guildId, type: { in: ["deposit", "Deposit", "DEPOSIT"] }, donationSeenAt: { not: null }, at: { gte: from } }, take: 2_000,
    select: { id: true, kind: true, type: true, actor: true, itemId: true, itemName: true, count: true, amount: true, at: true, createdAt: true } });
  const recent = enabled && channelId ? await db.discordJob.count({ where: { guildId, key: { startsWith: DONATION_JOB_PREFIX }, createdAt: { gte: new Date(now.getTime() - 3_600_000) } } }) : 0;
  const plan = planDonations(pending, seenBefore, { now, enabled: enabled && !!channelId, cardsLeft: DONATION_CARDS_PER_HOUR - recent });
  if (!plan.seen.length) return 0;
  // Claim first: a line is stamped before its card is queued, so a crash or a second sweep never announces it twice.
  const claimed = await db.guildBankTransaction.updateMany({ where: { id: { in: plan.seen }, donationSeenAt: null }, data: { donationSeenAt: now } });
  if (claimed.count !== plan.seen.length || !channelId || (!plan.single.length && !plan.combined.length)) return 0;
  const lang: Lang = settings?.language === "fr" ? "fr" : "en";
  const donors = await donorTotals(db, guildId, [...plan.single, ...plan.combined]);
  let queued = 0;
  for (const group of plan.single) {
    const donor = donors.get(group)!;
    const who = donor.userId ? `<@${donor.userId}>` : `**${donor.total.name}**`;
    const text = donationText(who, lang);
    // The mention shows the member without pinging anyone (mentionUsers is empty).
    await enqueueDiscordJob(db, guildId, `${DONATION_JOB_PREFIX}${group.rows[0]!.id}`, "MESSAGE", { channelId, message: { content: text },
      card: JSON.parse(JSON.stringify(donationCard(lang, donor.total))), ...(donor.userId ? { donorUserId: donor.userId } : {}),
      cardOnly: { content: text, embeds: [textlessEmbed(0xd4af37)] } });
    queued++;
  }
  if (plan.combined.length) {
    const totals = plan.combined.map((g) => donors.get(g)!.total);
    const text = combinedDonationText(totals.map((d) => `**${d.name}**`), lang);
    await enqueueDiscordJob(db, guildId, `${DONATION_JOB_PREFIX}group:${plan.combined[0]!.rows[0]!.id}`, "MESSAGE", { channelId, message: { content: text },
      card: JSON.parse(JSON.stringify(combinedDonationCard(lang, totals))), cardOnly: { content: text, embeds: [textlessEmbed(0xd4af37)] } });
    queued++;
  }
  return queued;
}

export const BACKFILL_JOB_PREFIX = `${DONATION_JOB_PREFIX}backfill:`;
export const BACKFILL_GAP_MS = 20 * 60_000;

/**
 * The backfill (owner, 22 Nov 2026: "give one to everybody who deposited since we created the guild"): every deposit stored before the
 * donor cards existed was flagged `donationBackfill` by its migration. Each sweep thanks at most one past donor, oldest first, with one
 * card for everything they gave (all their characters together when they are linked to one member), at most one card every
 * BACKFILL_GAP_MS and inside the hourly DONATION_CARDS_PER_HOUR budget it shares with new donors, who always go first. A donor's lines are
 * claimed before the card is queued, so nobody is thanked twice. Switched off: the backlog is dropped. Returns the number of cards queued.
 */
export async function backfillBankDonations(db: DonationDb, discordGuild: Parameters<typeof guildChannelLikes>[0], guildId: string, now = new Date()): Promise<number> {
  const settings = await db.guildSettings.findUnique({ where: { guildId }, select: { language: true, guildBankDonationCards: true } });
  if (settings?.guildBankDonationCards === false) {
    await db.guildBankTransaction.updateMany({ where: { guildId, donationBackfill: true }, data: { donationBackfill: false } });
    return 0;
  }
  if (await db.guildBankTransaction.findFirst({ where: { guildId, donationSeenAt: null }, select: { id: true } })) return 0; // new donors first
  const channelId = await wowChatChannel(db, guildId, guildChannelLikes(discordGuild), guildPostable(discordGuild as never));
  if (!channelId) return 0;
  const hour = await db.discordJob.count({ where: { guildId, key: { startsWith: DONATION_JOB_PREFIX }, createdAt: { gte: new Date(now.getTime() - 3_600_000) } } });
  const gap = await db.discordJob.count({ where: { guildId, key: { startsWith: BACKFILL_JOB_PREFIX }, createdAt: { gte: new Date(now.getTime() - BACKFILL_GAP_MS) } } });
  if (hour >= DONATION_CARDS_PER_HOUR || gap > 0) return 0;
  const rows: DonationRow[] = await db.guildBankTransaction.findMany({ where: { guildId, donationBackfill: true }, orderBy: { at: "asc" }, take: 20_000,
    select: { id: true, kind: true, type: true, actor: true, itemId: true, itemName: true, count: true, amount: true, at: true, createdAt: true } });
  if (!rows.length) return 0;
  const byActor = new Map<string, DonationRow[]>();
  for (const r of rows) byActor.set(key(r.actor), [...(byActor.get(key(r.actor)) ?? []), r]);
  // Oldest donor first; their linked member's other characters join the same card.
  const firstAt = (g: DonorGroup) => Math.min(...g.rows.map((r) => r.at.getTime()));
  const groups = [...byActor.values()].map(donorGroup).sort((a, b) => firstAt(a) - firstAt(b) || a.actor.localeCompare(b.actor));
  const facts = await donorTotals(db, guildId, groups);
  const first = groups[0]!, userId = facts.get(first)!.userId;
  const mine = userId ? groups.filter((g) => facts.get(g)!.userId === userId) : [first];
  const group = mine.length === 1 ? first : donorGroup(mine.flatMap((g) => g.rows).sort((a, b) => a.at.getTime() - b.at.getTime()));
  const ids = group.rows.map((r) => r.id);
  const claimed = await db.guildBankTransaction.updateMany({ where: { id: { in: ids }, donationBackfill: true }, data: { donationBackfill: false } });
  if (claimed.count !== ids.length) return 0;
  const lang: Lang = settings?.language === "fr" ? "fr" : "en";
  const total = { ...facts.get(first)!.total, gold: group.copper > 0n ? donationGold(group.copper) : null,
    items: mine.length === 1 ? facts.get(first)!.total.items : mine.flatMap((g) => facts.get(g)!.total.items).reduce<DonorTotal["items"]>((all, item) => {
      const same = all.find((i) => (i.itemId !== null ? i.itemId === item.itemId : i.name === item.name));
      if (same) same.count += item.count; else all.push({ ...item });
      return all;
    }, []) };
  const who = userId ? `<@${userId}>` : `**${total.name}**`;
  const text = donationText(who, lang, true);
  await enqueueDiscordJob(db, guildId, `${BACKFILL_JOB_PREFIX}${group.rows[0]!.id}`, "MESSAGE", { channelId, message: { content: text },
    card: JSON.parse(JSON.stringify(donationCard(lang, total, true))), ...(userId ? { donorUserId: userId } : {}),
    cardOnly: { content: text, embeds: [textlessEmbed(0xd4af37)] } });
  return 1;
}

/** Each donor's card facts: the full Forever name, the linked member (for the avatar), gold text and items with their quality. */
async function donorTotals(db: DonationDb, guildId: string, groups: readonly DonorGroup[]): Promise<Map<DonorGroup, { total: DonorTotal; userId: string | null }>> {
  const book = await loadFullNameBook(db, guildId, groups.map((g) => g.actor));
  const contents = await db.guildBankContents.findUnique({ where: { guildId }, select: { tabs: true } }).catch(() => null);
  const quality = new Map(bankItems(contents?.tabs).filter((i) => i.quality !== undefined).map((i) => [i.id, i.quality!]));
  const out = new Map<DonorGroup, { total: DonorTotal; userId: string | null }>();
  for (const group of groups) {
    const name = displayCharacterName(group.actor.trim(), book);
    const first = group.actor.trim().split(" ")[0]!;
    const linked = await db.character.findMany({ where: { guildId, OR: [{ name: { equals: group.actor.trim(), mode: "insensitive" } }, { displayName: { equals: name, mode: "insensitive" } }, { name: { equals: first, mode: "insensitive" } }] },
      select: { name: true, displayName: true, member: { select: { discordUserId: true } } }, take: 5 }).catch(() => []);
    const owners = [...new Set(linked.map((c) => c.member?.discordUserId).filter((id): id is string => !!id && /^\d{17,20}$/.test(id)))];
    out.set(group, { userId: owners.length === 1 ? owners[0]! : null, total: { name, character: name, gold: group.copper > 0n ? donationGold(group.copper) : null,
      items: group.items.map((i) => ({ ...i, ...(i.itemId !== null && quality.has(i.itemId) ? { quality: quality.get(i.itemId) } : {}) })) } });
  }
  return out;
}

let running = false;
/** The sweep (every few minutes from main.ts): every server with unseen bank lines. */
export async function sweepBankDonations(db: DonationDb & Pick<PrismaClient, "guild">, guilds: { get(id: string): DiscordGuild | undefined }, report: (error: unknown) => void, now = new Date()): Promise<void> {
  if (running) return;
  running = true;
  try {
    const fresh = await db.guildBankTransaction.findMany({ where: { donationSeenAt: null }, distinct: ["guildId"], select: { guildId: true }, take: 200 });
    const backlog = await db.guildBankTransaction.findMany({ where: { donationBackfill: true }, distinct: ["guildId"], select: { guildId: true }, take: 200 });
    for (const guildId of new Set([...fresh, ...backlog].map((r) => r.guildId))) {
      const guild = await db.guild.findUnique({ where: { id: guildId }, select: { discordId: true } }).catch(() => null);
      const discordGuild = guild ? guilds.get(guild.discordId) : undefined;
      if (!discordGuild) continue;
      await withGuildScope(db, guildId, () => announceBankDonations(db, discordGuild, guildId, now)).catch(report);
      if (backlog.some((r) => r.guildId === guildId)) await withGuildScope(db, guildId, () => backfillBankDonations(db, discordGuild, guildId, now)).catch(report);
    }
  } finally { running = false; }
}
