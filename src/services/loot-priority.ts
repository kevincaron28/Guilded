import type { PrismaClient } from "@prisma/client";
import { priority } from "./epgp.js";
import { createItemValueService } from "./item-values.js";
import { itemKey } from "./wishlist.js";

// EPGP priority loot: every item has a set GP price; it goes to the highest PR of the players
// who want it, and they pay that price. On Discord "wants it" means the item is on their
// wishlist (in game, raiders answer a popup instead). Ties go to the higher wishlist priority,
// then to whoever wished for it first.

export interface PriorityCandidate {
  memberId: string;
  displayName: string;
  character: string;
  wishPriority: number; // 1 = high
  wishedAt: Date;
  ep: number;
  gp: number;
  pr: number;
}

// Players with at least `minEp` EP come first (EPGP's minimum EP: newcomers can't jump the queue
// with a tiny GP); inside each group, the higher PR.
export function rankCandidates(candidates: PriorityCandidate[], minEp = 0): PriorityCandidate[] {
  const eligible = (candidate: PriorityCandidate) => (candidate.ep >= minEp ? 0 : 1);
  return [...candidates].sort((a, b) =>
    eligible(a) - eligible(b) || b.pr - a.pr || a.wishPriority - b.wishPriority || a.wishedAt.getTime() - b.wishedAt.getTime() || a.displayName.localeCompare(b.displayName));
}

type Db = Pick<PrismaClient, "wishlistEntry" | "epgpTransaction" | "raidCoreMember" | "coreItemValue">;

export interface PriorityResult {
  price: number | null;
  ranking: PriorityCandidate[];
  /** Wishers left out because they are not in the core's roster. */
  outsideCore: number;
}

export async function priorityFor(
  database: Db, guildId: string, itemName: string,
  options: { coreId: string | null; separatePool: boolean; baseGp: number; minEp?: number }
): Promise<PriorityResult> {
  const price = await createItemValueService(database).priceOf(guildId, options.coreId, { name: itemName });
  const wishes = await database.wishlistEntry.findMany({
    where: { itemKey: itemKey(itemName), character: { member: { guildId, status: "ACTIVE" } } },
    include: { character: { include: { member: true } } }
  });
  const rosterIds = options.coreId
    ? new Set((await database.raidCoreMember.findMany({ where: { coreId: options.coreId }, select: { memberId: true } })).map((row) => row.memberId))
    : null;
  const pool = options.separatePool ? options.coreId : null;
  const best = new Map<string, PriorityCandidate>();
  let outsideCore = 0;
  for (const wish of wishes) {
    const member = wish.character.member;
    if (rosterIds && !rosterIds.has(member.id)) { outsideCore++; continue; }
    const sums = await database.epgpTransaction.aggregate({ where: { memberId: member.id, coreId: pool }, _sum: { epAmount: true, gpAmount: true } });
    const ep = sums._sum.epAmount ?? 0;
    const gp = sums._sum.gpAmount ?? 0;
    const candidate: PriorityCandidate = {
      memberId: member.id, displayName: member.displayName, character: wish.character.name,
      wishPriority: wish.priority, wishedAt: wish.createdAt, ep, gp, pr: priority(ep, gp, options.baseGp)
    };
    // A player with several characters wishing for it counts once, with their better wish.
    const existing = best.get(member.id);
    if (!existing || candidate.wishPriority < existing.wishPriority) best.set(member.id, candidate);
  }
  return { price, ranking: rankCandidates([...best.values()], options.minEp ?? 0), outsideCore };
}

export function describePriority(itemName: string, coreName: string | null, result: PriorityResult): string {
  const head = `**${itemName}** — ${result.price === null ? "no price set (`/core items`)" : `${result.price} GP`}${coreName ? ` · ${coreName}` : ""}`;
  if (result.ranking.length === 0) {
    return `${head}\nNobody eligible wants it yet. Players add it with \`/character wishlist add\`.${result.outsideCore ? ` (${result.outsideCore} wisher(s) are not in this core.)` : ""}`;
  }
  const lines = result.ranking.slice(0, 10).map((row, index) =>
    `${index + 1}. **${row.character}** (${row.displayName}) — PR ${row.pr.toFixed(2)} (EP ${row.ep} / GP ${row.gp})`);
  const winner = result.ranking[0]!;
  return [
    head, ...lines,
    result.ranking.length > 10 ? `…and ${result.ranking.length - 10} more.` : "",
    `Goes to **${winner.character}**${result.price === null ? "" : ` for ${result.price} GP`}: \`/loot award\` with that player${result.price === null ? " and a gp" : " charges the set price"}.`,
    result.outsideCore ? `(${result.outsideCore} wisher(s) are not in this core and were left out.)` : ""
  ].filter(Boolean).join("\n");
}
