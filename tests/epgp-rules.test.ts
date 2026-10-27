// Guilded's EPGP follows the original rules (EPGP 5.5, EPGP Classic, CEPGP): GP counts as at least 1,
// decay rounds up and reaches every balance, no balance goes below zero, minimum EP ranks first,
// bench players get the raid's EP (27 October 2026 loot review).
import type { PrismaClient } from "../src/generated/prisma/client.js";
import { describe, expect, it, vi } from "vitest";
import { createEpgpService, decayAmount, priority } from "../src/services/epgp.js";
import { rankCandidates, type PriorityCandidate } from "../src/services/loot-priority.js";
import { rankBids } from "../src/services/loot.js";

const candidate = (character: string, ep: number, gp: number, baseGp: number): PriorityCandidate =>
  ({ memberId: character, displayName: character, character, wishPriority: 1, wishedAt: new Date(0), ep, gp, pr: priority(ep, gp, baseGp) });

describe("priority", () => {
  it("ranks a raider with EP and no gear yet by their EP, not last (base GP 0)", () => {
    const order = rankCandidates([candidate("Geared", 50, 100, 0), candidate("NoGearYet", 500, 0, 0)]).map((row) => row.character);
    expect(order).toEqual(["NoGearYet", "Geared"]);
  });
});

describe("decay amount", () => {
  it("rounds up, never past zero, without floating-point surprises", () => {
    expect(decayAmount(9, 0.1)).toBe(-1);
    expect(decayAmount(90, 0.1)).toBe(-9); // 90 × 0.1 is 9.000000000000002
    expect(decayAmount(1000, 0.07)).toBe(-70);
    expect(decayAmount(1, 0.1)).toBe(-1);
    expect(decayAmount(1, 1)).toBe(-1);
    expect(decayAmount(-15, 0.1)).toBe(2); // a negative balance moves back towards zero
    expect(decayAmount(0, 0.1)).toBe(0);
    expect(Object.is(decayAmount(0, 0.1), -0)).toBe(false);
  });
});

describe("GP bids", () => {
  const at = (minutes: number) => new Date(minutes * 60_000);
  const standings = new Map([["vet", { ep: 200, gp: 100 }], ["new", { ep: 20, gp: 0 }], ["mid", { ep: 300, gp: 50 }]]);

  it("puts bidders under the minimum EP after the others, then the highest bid", () => {
    const bids = [{ memberId: "new", amount: 80, createdAt: at(1) }, { memberId: "vet", amount: 40, createdAt: at(2) }];
    expect(rankBids(bids, standings, 50, 0).map((bid) => bid.memberId)).toEqual(["vet", "new"]);
    expect(rankBids(bids, standings, 0, 0).map((bid) => bid.memberId)).toEqual(["new", "vet"]);
  });

  it("breaks a tie on the bid with the higher PR, then the earlier bid", () => {
    const bids = [{ memberId: "vet", amount: 40, createdAt: at(1) }, { memberId: "mid", amount: 40, createdAt: at(2) }];
    expect(rankBids(bids, standings, 0, 0).map((bid) => bid.memberId)).toEqual(["mid", "vet"]);
  });
});

// A small in-memory ledger: enough of Prisma for applyDecay and reverseTransaction.
function ledger() {
  const rows: { id: string; memberId: string; epAmount: number; gpAmount: number; coreId: string | null; sourceRef: string | null }[] = [];
  const total = (memberId: string) => rows.filter((row) => row.memberId === memberId)
    .reduce((sum, row) => ({ epAmount: sum.epAmount + row.epAmount, gpAmount: sum.gpAmount + row.gpAmount }), { epAmount: 0, gpAmount: 0 });
  const save = (data: Omit<(typeof rows)[number], "id">) => { const row = { ...data, id: `t${rows.length + 1}` }; rows.push(row); return row; };
  const epgpTransaction = {
    create: vi.fn(async ({ data }: { data: Omit<(typeof rows)[number], "id"> }) => save(data)),
    createManyAndReturn: vi.fn(async ({ data }: { data: Omit<(typeof rows)[number], "id">[] }) => data.map(save)),
    groupBy: vi.fn(async () => [...new Set(rows.map((row) => row.memberId))].map((memberId) => ({ memberId, _sum: total(memberId) }))),
    aggregate: vi.fn(async ({ where }: { where: { memberId: string } }) => ({ _sum: total(where.memberId) })),
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => rows.find((row) => row.id === where.id) ?? null),
    findFirst: vi.fn(async ({ where }: { where: { sourceRef: string } }) => rows.find((row) => row.sourceRef === where.sourceRef) ?? null)
  };
  const database = {
    guildSettings: { findUnique: vi.fn(async () => null) },
    epgpTransaction,
    $transaction: async (fn: (tx: unknown) => unknown) => fn({ epgpTransaction, $executeRaw: async () => 0 })
  } as unknown as PrismaClient;
  return { epgp: createEpgpService(database), total };
}

describe("EPGP ledger", () => {
  it("reversing an item after a decay takes back only what is left, so GP never goes negative", async () => {
    const { epgp, total } = ledger();
    const item = await epgp.awardItem({ guildId: "g", memberId: "m1", gp: 100, reason: "Loot: helm", createdBy: "o" });
    await epgp.applyDecay("g", 0.1, "o");
    const reversal = await epgp.reverseTransaction(item.id, "o", "Reversal: wrong player", "g");
    expect(reversal).toMatchObject({ gpAmount: -90, reason: "Reversal: wrong player (limited to the current balance)" });
    expect(total("m1").gpAmount).toBe(0);
  });

  it("refuses a reversal when decay already removed everything", async () => {
    const { epgp } = ledger();
    const item = await epgp.awardItem({ guildId: "g", memberId: "m1", gp: 1, reason: "Loot: ring", createdBy: "o" });
    await epgp.applyDecay("g", 1, "o");
    await expect(epgp.reverseTransaction(item.id, "o", "Reversal: x", "g")).rejects.toThrow("Nothing is left to take back");
  });

  it("small balances keep decaying (9 GP at 10% becomes 8)", async () => {
    const { epgp, total } = ledger();
    await epgp.awardItem({ guildId: "g", memberId: "m1", gp: 9, reason: "Loot: ring", createdBy: "o" });
    await epgp.applyDecay("g", 0.1, "o");
    expect(total("m1").gpAmount).toBe(8);
  });

  it("decay reaches every balance, also of members who left, so nobody returns with undecayed EP", async () => {
    const { epgp, total } = ledger();
    await epgp.awardEP({ guildId: "g", memberId: "left-guild", amount: 1000, reason: "Raid", createdBy: "o" });
    await epgp.applyDecay("g", 0.1, "o");
    expect(total("left-guild").epAmount).toBe(900);
  });
});
