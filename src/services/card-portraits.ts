import type { PrismaClient } from "../generated/prisma/client.js";
import { findCharacterWowId, withCharacterPortrait, type CharacterPortraits } from "./character-portrait.js";
import type { ScoreCard } from "./score-card.js";

// Armory character pictures on delivered cards (20 Nov 2026), added when a queued card is drawn, never stored in the definition:
//   - a card about one member (`cardMember`: achievement unlocks, the weekly MVP, the rookie of the week) gets the Armory picture of the
//     member's main character as its round portrait; without one the Discord avatar that withDiscordMember added stays;
//   - a dungeon run card gets a small round portrait per guild party member (up to five rows), drawn left of the role emblem.
// Order everywhere: WoW Armory picture -> Discord avatar -> nothing. Member-uploaded pictures were removed on 20 Nov 2026.
// Never blocks delivery: every failure falls through to the card as it was, at most three pictures load at once, and the whole step
// stops waiting after CARD_PORTRAIT_BUDGET_MS (pictures that arrive late are simply not drawn).

type Db = Pick<PrismaClient, "character" | "armoryRosterEntry">;
export const CARD_PORTRAIT_BUDGET_MS = 6000;
export const CARD_PORTRAIT_CONCURRENCY = 3;
const MAX_ROWS = 5;

const bareName = (name: string) => (name.split("-")[0] ?? name).trim();

async function mainCharacter(db: Db, guildId: string, discordUserId: string): Promise<{ name: string; wowId: bigint | null } | null> {
  const row = await db.character.findFirst({
    where: { guildId, member: { discordUserId, status: "ACTIVE" } },
    orderBy: [{ isMain: "desc" }, { updatedAt: "desc" }], select: { name: true, wowId: true }
  });
  return row ?? null;
}

async function armoryFor(portraits: CharacterPortraits, id: bigint | null, name: string): Promise<Buffer | null> {
  return (id ? await portraits.forId(id) : null) ?? (name ? await portraits.forName(name) : null);
}

/** Runs `task` over `items`, at most `limit` at a time, starting nothing new after `deadline`. */
async function pool<T, R>(items: T[], limit: number, deadline: number, now: () => number, task: (item: T) => Promise<R>): Promise<(R | undefined)[]> {
  const results: (R | undefined)[] = new Array(items.length).fill(undefined);
  let next = 0;
  const worker = async () => {
    while (next < items.length && now() < deadline) {
      const index = next++;
      results[index] = await task(items[index]!).catch(() => undefined);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function withPartyPortraits(db: Db, portraits: CharacterPortraits, guildId: string, card: ScoreCard, now: () => number, deadline: number): Promise<ScoreCard> {
  const party = card.dungeon!.party, shown = party.length > MAX_ROWS ? MAX_ROWS - 1 : MAX_ROWS;
  const slots = party.slice(0, shown).flatMap((member, index) => member.guild && member.character ? [{ index, name: bareName(member.character) }] : []);
  if (!slots.length) return card;
  const found = await pool(slots, CARD_PORTRAIT_CONCURRENCY, deadline, now, async (slot) => {
    const id = await findCharacterWowId(db, guildId, slot.name).catch(() => null);
    return armoryFor(portraits, id, slot.name);
  });
  const images = new Map<number, string>();
  slots.forEach((slot, i) => { const image = found[i]; if (image) images.set(slot.index, image.toString("base64")); });
  if (!images.size) return card;
  return { ...card, dungeon: { ...card.dungeon!, party: party.map((member, index) => images.has(index) ? { ...member, portrait: images.get(index)! } : member) } };
}

async function withRecordPortraits(db: Db, portraits: CharacterPortraits, guildId: string, card: ScoreCard, now: () => number, deadline: number): Promise<ScoreCard> {
  const record = card.record!, party = record.party.slice(0, MAX_ROWS);
  const slots = party.flatMap((member, index) => member.guild && member.character ? [{ index, name: bareName(member.character) }] : []);
  const found = await pool(slots, CARD_PORTRAIT_CONCURRENCY, deadline, now, async (slot) => {
    const id = await findCharacterWowId(db, guildId, slot.name).catch(() => null);
    return armoryFor(portraits, id, slot.name);
  });
  const images = new Map<number, string>();
  slots.forEach((slot, i) => { const image = found[i]; if (image) images.set(slot.index, image.toString("base64")); });
  if (!images.size) return card;
  return { ...card, record: { ...record, party: record.party.map((member, index) => images.has(index) ? { ...member, portrait: images.get(index)! } : member) } };
}

/** The card with Armory portraits where they fit; the card itself (unchanged) when nothing applies or anything fails or runs late. */
export async function withArmoryCardPortraits(db: Db, portraits: CharacterPortraits, guildId: string, card: ScoreCard, cardMember?: string, options: { budgetMs?: number; now?: () => number } = {}): Promise<ScoreCard> {
  const now = options.now ?? Date.now, budget = options.budgetMs ?? CARD_PORTRAIT_BUDGET_MS, deadline = now() + budget;
  const wantsParty = Boolean(card.dungeon && !card.dungeon.pvp && card.dungeon.party.some(member => member.guild && member.character));
  // The guild record card (21 Nov 2026) shows its party of up to five as round portraits.
  const wantsRecord = Boolean(card.record?.party.some(member => member.guild && member.character));
  const wantsMember = Boolean(cardMember && !card.dungeon && !card.ladder && !card.roster && !card.promotion);
  if (!wantsParty && !wantsMember && !wantsRecord) return card;
  const work = async (): Promise<ScoreCard> => {
    if (wantsRecord && card.record) return withRecordPortraits(db, portraits, guildId, card, now, deadline);
    if (wantsParty) return withPartyPortraits(db, portraits, guildId, card, now, deadline);
    const main = await mainCharacter(db, guildId, cardMember!);
    if (!main) return card;
    return withCharacterPortrait(card, { armory: () => armoryFor(portraits, main.wowId, main.name), discord: async () => null });
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work(), new Promise<ScoreCard>((resolve) => { timer = setTimeout(() => resolve(card), budget); })]);
  } catch { return card; } finally { if (timer) clearTimeout(timer); }
}
